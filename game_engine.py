"""
game_engine.py
The referee. Owns all game state. Reacts to Arduino button events, drives
Arduino outputs (wheel servo, LEDs, Maveli/Mahabali servos), asks the
AdaptiveAI for difficulty, and produces challenges for the VR website.

State machine (per game, single "current_player" turn at a time):

  WAITING_ROLL
      -> (BUTTON,ROLL) -> rolls dice, moves player, updates LEDs
      -> if landed on snake/ladder square: phase = WAITING_FOR_VR
      -> else: advance turn, phase stays WAITING_ROLL

  WAITING_FOR_VR
      -> (BUTTON,VR_READY) -> ask Gemma for difficulty -> emit challenge to VR site
      -> phase = IN_VR

  IN_VR
      -> (VR result posted via REST) -> apply outcome, update Maveli, check win
      -> phase = WAITING_ROLL (next player) or GAME_OVER
"""

import random
import logging
from dataclasses import dataclass, field
from typing import Optional, Callable

import config
from gemma_adaptive import AdaptiveAI
from serial_handler import SerialHandler
import trivia_parser

logger = logging.getLogger("game_engine")


@dataclass
class Player:
    id: int
    position: int = 1
    difficulty: str = config.DEFAULT_DIFFICULTY
    vr_results: list = field(default_factory=list)   # list[bool]
    trivia_results: list = field(default_factory=list)  # list[bool]
    response_times: list = field(default_factory=list)  # list[float]

    @property
    def vr_success_rate(self) -> float:
        if not self.vr_results:
            return 0.5  # neutral prior
        return sum(self.vr_results) / len(self.vr_results)

    @property
    def trivia_accuracy(self) -> float:
        if not self.trivia_results:
            return 0.5
        return sum(self.trivia_results) / len(self.trivia_results)

    @property
    def avg_response_time(self) -> float:
        if not self.response_times:
            return 6.0
        return sum(self.response_times) / len(self.response_times)

    def stats_for_gemma(self) -> dict:
        return {
            "player": self.id,
            "recent_vr_success": round(self.vr_success_rate, 2),
            "trivia_accuracy": round(self.trivia_accuracy, 2),
            "average_response_time": round(self.avg_response_time, 2),
            "current_difficulty": self.difficulty,
        }


class GameEngine:
    def __init__(self, serial_handler: SerialHandler, num_players: int = config.NUM_PLAYERS):
        self.serial = serial_handler
        self.serial.on_event = self._on_arduino_event

        self.ai = AdaptiveAI()

        self.trivia_questions = trivia_parser.parse_questions()

        self.players = {i: Player(id=i, position=1) for i in range(1, num_players + 1)}
        self.current_player_id = 1
        self.phase = "WAITING_ROLL"
        self.maaveli_state = config.MAVELI_START_STATE
        self.winner: Optional[int] = None
        self.pending_challenge_reason: Optional[str] = None

        # Set by main.py — called whenever a challenge should be pushed to the VR site
        self.on_challenge_ready: Optional[Callable[[dict], None]] = None
        # Set by main.py — called whenever state changes, for websocket/UI broadcast
        self.on_state_change: Optional[Callable[[], None]] = None

        # push Maveli/wheel servos to their starting positions
        self._update_maveli_servo()

    # ------------------------------------------------------------------
    # Arduino event dispatch
    # ------------------------------------------------------------------
    def _on_arduino_event(self, line: str):
        if line == config.BTN_ROLL:
            self.handle_roll_button()
        elif line == config.BTN_VR_READY:
            self.handle_vr_ready_button()
        else:
            logger.info(f"Unhandled Arduino event: {line}")

    # ------------------------------------------------------------------
    # ROLL button (also doubles as "start game")
    # ------------------------------------------------------------------
    def handle_roll_button(self):
        if self.phase != "WAITING_ROLL":
            logger.info(f"Ignoring ROLL — current phase is {self.phase}")
            return
        if self.winner is not None:
            logger.info("Game already over, ignoring ROLL.")
            return

        roll = random.randint(config.DICE_MIN, config.DICE_MAX)
        logger.info(f"Player {self.current_player_id} rolled {roll}")

        self.serial.send_spin(roll)

        player = self.players[self.current_player_id]
        new_pos = min(player.position + roll, config.BOARD_SIZE)
        player.position = new_pos
        self.serial.send_led(new_pos)

        if new_pos == config.BOARD_SIZE:
            self._win(self.current_player_id)
            return

        if new_pos in config.SNAKES or new_pos in config.LADDERS:
            kind = "snake" if new_pos in config.SNAKES else "ladder"
            logger.info(f"Player {self.current_player_id} landed on a {kind} at {new_pos} — needs VR challenge")
            self.phase = "WAITING_FOR_VR"
        elif hasattr(config, 'TRIVIA_CELLS') and new_pos in config.TRIVIA_CELLS:
            logger.info(f"Player {self.current_player_id} landed on a trivia cell at {new_pos} — needs VR challenge")
            self.phase = "WAITING_FOR_VR"
        else:
            self._advance_turn()

        self._notify_state_change()

    # ------------------------------------------------------------------
    # VR_READY button
    # ------------------------------------------------------------------
    def handle_vr_ready_button(self):
        if self.phase != "WAITING_FOR_VR":
            logger.info(f"Ignoring VR_READY — current phase is {self.phase}")
            return

        player = self.players[self.current_player_id]
        stats = player.stats_for_gemma()
        board_state = {
            "player_positions": [{"player": p.id, "row": 0, "col": p.position} for p in self.players.values()]
        }
        recommendation = self.ai.plan_next_turn(stats, board_state)

        player.difficulty = recommendation["recommended_difficulty"]
        self.pending_challenge_reason = recommendation.get("reason")

        if player.position in config.LADDERS:
            challenge_type = "ladder_bonus"
        elif player.position in config.SNAKES:
            challenge_type = "snake_penalty"
        else:
            challenge_type = "trivia"

        challenge = {
            "player_id": player.id,
            "difficulty": player.difficulty,
            "challenge_type": challenge_type,
            "reason": self.pending_challenge_reason,
            "selected_game": recommendation["vr_trivia_game"] if challenge_type == "trivia" else recommendation["vr_challenge_game"]
        }
        
        if challenge_type == "trivia":
            q = trivia_parser.get_random_question(self.trivia_questions)
            if q:
                challenge["trivia_question"] = q
                
        logger.info(f"Sending VR challenge: {challenge}")

        self.phase = "IN_VR"
        if self.on_challenge_ready:
            self.on_challenge_ready(challenge)

        self._notify_state_change()

    # ------------------------------------------------------------------
    # VR result (comes in over REST from the VR website)
    # ------------------------------------------------------------------
    def apply_vr_result(self, player_id: int, success: bool, response_time_sec: float,
                         challenge_type: Optional[str] = None):
        if self.phase != "IN_VR":
            logger.warning(f"Received VR result while phase={self.phase}, applying anyway.")

        player = self.players.get(player_id)
        if not player:
            logger.error(f"Unknown player_id {player_id} in VR result")
            return

        player.vr_results.append(success)
        player.response_times.append(response_time_sec)
        if challenge_type == "trivia":
            player.trivia_results.append(success)

        square = player.position
        if success:
            if square in config.LADDERS:
                player.position = config.LADDERS[square]
                logger.info(f"Player {player_id} succeeded — climbs ladder to {player.position}")
            elif square in config.SNAKES:
                # succeeding a snake-square challenge = "resisted the snake", stay put
                logger.info(f"Player {player_id} succeeded — avoided the snake, stays at {square}")
            self.maaveli_state = max(config.MAVELI_MIN, self.maaveli_state + config.MAVELI_STEP_ON_SUCCESS)
        else:
            if square in config.SNAKES:
                player.position = config.SNAKES[square]
                logger.info(f"Player {player_id} failed — slides down snake to {player.position}")
            elif square in config.LADDERS:
                # failed the bonus challenge = forfeit the ladder climb, stay put
                logger.info(f"Player {player_id} failed — forfeits ladder, stays at {square}")
            self.maaveli_state = min(config.MAVELI_MAX, self.maaveli_state + config.MAVELI_STEP_ON_FAILURE)

        self.serial.send_led(player.position)
        self._update_maveli_servo()

        if player.position >= config.BOARD_SIZE:
            self._win(player_id)
            self._notify_state_change()
            return

        self.phase = "WAITING_ROLL"
        self._advance_turn()
        self._notify_state_change()

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    def _advance_turn(self):
        ids = sorted(self.players.keys())
        idx = ids.index(self.current_player_id)
        self.current_player_id = ids[(idx + 1) % len(ids)]
        self.phase = "WAITING_ROLL"

    def _update_maveli_servo(self):
        angle = int(
            config.MAVELI_SERVO_ANGLE_MIN
            + (self.maaveli_state / config.MAVELI_MAX)
            * (config.MAVELI_SERVO_ANGLE_MAX - config.MAVELI_SERVO_ANGLE_MIN)
        )
        self.serial.send_maveli(angle)

    def _win(self, player_id: int):
        self.winner = player_id
        self.phase = "GAME_OVER"
        logger.info(f"Player {player_id} WINS the game!")
        self.serial.send_mahabali(config.WHEEL_SERVO_ANGLE_MAX)  # celebratory move, tune as needed

    def _notify_state_change(self):
        if self.on_state_change:
            self.on_state_change()

    def reset(self):
        self.__init__(self.serial, num_players=len(self.players))

    # ------------------------------------------------------------------
    # serialization for API / websocket
    # ------------------------------------------------------------------
    def to_dict(self) -> dict:
        return {
            "current_player": self.current_player_id,
            "phase": self.phase,
            "maaveli_state": self.maaveli_state,
            "winner": self.winner,
            "players": [
                {
                    "id": p.id,
                    "position": p.position,
                    "difficulty": p.difficulty,
                    "vr_success_rate": round(p.vr_success_rate, 2),
                    "trivia_accuracy": round(p.trivia_accuracy, 2),
                    "avg_response_time": round(p.avg_response_time, 2),
                }
                for p in self.players.values()
            ],
        }
