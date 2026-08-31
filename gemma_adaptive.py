"""
gemma_adaptive.py — rigged roll + competence-band-driven game selection.
RED/YELLOW trigger cells are fixed in the .ino firmware — this module does
not choose or move them.
"""

import json
import logging
import random
import re
from typing import Optional

import requests

import config

logger = logging.getLogger("gemma_adaptive")

# Fixed difficulty per game — Gemma/heuristic pick WHICH game, not the label
VR_GAMES = {
    "uriyadi":       "MODERATE",
    "sadhya_memory": "EASY",
    "vallamkali":    "TOUGH",
    "chenda":        "TOUGHEST",
}

# Explicit competence -> game bands (used by heuristic fallback, and stated
# to Gemma as a strong prior it can deviate from with a reason)
COMPETENCE_BANDS = [
    (0.0, 0.4,  "sadhya_memory"),
    (0.4, 0.6,  "uriyadi"),
    (0.6, 0.8,  "vallamkali"),
    (0.8, 1.01, "chenda"),
]


def _band_game(score: float) -> str:
    for lo, hi, game in COMPETENCE_BANDS:
        if lo <= score < hi:
            return game
    return "uriyadi"


class AdaptiveAI:
    def __init__(self, mode: str = config.GEMMA_MODE):
        self.mode = mode

    # ------------------------------------------------------------------
    def plan_next_turn(self, player_stats: dict, board_state: dict, vr_result: Optional[dict] = None) -> dict:
        """
        player_stats (from PlayerCompetenceTracker.get_stats):
            {"player": 2, "recent_vr_success": 0.8, "trivia_accuracy": 0.9,
             "average_response_time": 4.2, "competence_score": 0.74,
             "rounds_played": 5}

        board_state: {"player_positions": [{"player": 1, "row": .., "col": ..}, ...]}
        (RED/YELLOW zones are fixed on the physical board by the .ino —
        Gemma does not choose or move them, only uses player positions for
        its own reasoning if useful.)

        vr_result (optional — the WebXR page's report on the last challenge):
            {"success": True/False, "response_time_sec": 6.1, "game": "uriyadi"}

        Returns:
            {"rigged_roll": 5, "vr_game": "vallamkali", "difficulty": "TOUGH", "reason": "..."}
        """
        result = None
        if self.mode == "ollama":
            result = self._ask_gemma(player_stats, board_state, vr_result)
            if result is not None:
                result = self._validate(result)

        if result is None:
            logger.warning("Gemma call failed or was invalid — using heuristic.")
            result = self._heuristic(player_stats, vr_result)

        return result

    def recommend_difficulty(self, player_stats: dict) -> dict:
        """
        Wrapper compatibility method matching the call signature in game_engine.py.
        Generates a dummy board state to delegate to plan_next_turn.
        """
        dummy_board_state = {
            "player_positions": [
                {"player": player_stats.get("player", 1), "row": 0, "col": 0}
            ]
        }
        res = self.plan_next_turn(player_stats, dummy_board_state)
        if "difficulty" in res and "recommended_difficulty" not in res:
            res["recommended_difficulty"] = res["difficulty"]
        if "vr_game" in res and "vr_challenge_game" not in res:
            res["vr_challenge_game"] = res["vr_game"]
        return res

    # ------------------------------------------------------------------
    def _ask_gemma(self, stats: dict, board_state: dict, vr_result: Optional[dict]) -> Optional[dict]:
        prompt = self._build_prompt(stats, board_state, vr_result)
        try:
            resp = requests.post(
                config.OLLAMA_URL,
                json={"model": config.OLLAMA_MODEL, "prompt": prompt, "stream": False,
                      "options": {"temperature": 0.4}},
                timeout=config.GEMMA_TIMEOUT_SEC,
            )
            resp.raise_for_status()
            return self._parse(resp.json().get("response", ""))
        except Exception as e:
            logger.warning(f"Ollama request failed: {e}")
            return None

    def _build_prompt(self, stats: dict, board_state: dict, vr_result: Optional[dict]) -> str:
        return f"""You are the adaptive controller for an Onam board game.
Dice roll range: {config.DICE_MIN}-{config.DICE_MAX}.
Note: RED and YELLOW trigger cells are FIXED on the physical board (set in
firmware) — you do not choose or move them, only use player positions for
your own reasoning if useful.

Player stats (JSON): {json.dumps(stats)}
Board state (JSON): {json.dumps(board_state)}
Last VR challenge result (JSON, may be null if this is turn 1): {json.dumps(vr_result)}

Player's current competence_score (0.0-1.0, already computed from their
rolling recent performance): {stats.get("competence_score", 0.5)}

Available VR games and their FIXED difficulty (do not change these labels):
{json.dumps(VR_GAMES)}

Default competence -> game bands (use these unless the last result or
current position gives a clear reason to deviate — if you deviate, say
why in "reason"):
0.0-0.4  -> sadhya_memory (EASY)
0.4-0.6  -> uriyadi (MODERATE)
0.6-0.8  -> vallamkali (TOUGH)
0.8-1.0  -> chenda (TOUGHEST)

Decide:
1. rigged_roll: an integer in range, chosen so the player's move creates a
   meaningful outcome given their current position and recent performance.
   Never pick a value outside {config.DICE_MIN}-{config.DICE_MAX}.
2. vr_game: pick ONE of {list(VR_GAMES.keys())}, normally following the
   competence band above.

Respond with ONLY this JSON, no extra text:
{{"rigged_roll": <int>, "vr_game": "<one of the games>", "reason": "<one short sentence>"}}
"""

    def _parse(self, text: str) -> Optional[dict]:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
            roll = int(parsed["rigged_roll"])
            game = parsed["vr_game"]
            if game not in VR_GAMES:
                return None
            if not (config.DICE_MIN <= roll <= config.DICE_MAX):
                return None
            return {
                "rigged_roll": roll,
                "vr_game": game,
                "difficulty": VR_GAMES[game],
                "reason": parsed.get("reason", "Gemma adaptive recommendation."),
            }
        except (json.JSONDecodeError, KeyError, ValueError, TypeError):
            return None

    def _validate(self, result: dict) -> Optional[dict]:
        if not (config.DICE_MIN <= result["rigged_roll"] <= config.DICE_MAX):
            return None
        if result["vr_game"] not in VR_GAMES:
            return None
        return result

    # ------------------------------------------------------------------
    def _heuristic(self, stats: dict, vr_result: Optional[dict]) -> dict:
        score = stats.get("competence_score", 0.5)
        game = _band_game(score)
        roll = random.randint(config.DICE_MIN, config.DICE_MAX)
        return {
            "rigged_roll": roll,
            "vr_game": game,
            "difficulty": VR_GAMES[game],
            "reason": f"Competence score {score:.2f} -> {game} band.",
        }