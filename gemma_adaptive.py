"""
gemma_adaptive.py

This is the "AI" in the physical-AI story. Once per player turn it decides:
  - the difficulty for their next challenge (as before)
  - which VR game to send them to (trivia-type vs escape-type)
  - where on the 18x20 LED matrix to place the next RED (VR challenge)
    and YELLOW (VR trivia) 4x3 zones, avoiding player positions and
    each other

Default mode talks to a locally-running Gemma via Ollama
(`ollama pull gemma3:4b && ollama serve`). If Ollama is unreachable or
returns something unparseable, OR if Gemma's zone placement is invalid
(out of bounds / overlapping), we fall back to a transparent heuristic
so the demo never breaks on stage.
"""

import json
import logging
import random
import re
from typing import Optional

import requests

import config

logger = logging.getLogger("gemma_adaptive")


class AdaptiveAI:
    def __init__(self, mode: str = config.GEMMA_MODE):
        self.mode = mode

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------
    def plan_next_turn(self, player_stats: dict, board_state: dict) -> dict:
        """
        player_stats example:
        {
            "player": 2,
            "recent_vr_success": 0.8,
            "trivia_accuracy": 0.9,
            "average_response_time": 4.2,
            "current_difficulty": "MEDIUM"
        }

        board_state example:
        {
            "player_positions": [
                {"player": 1, "row": 2, "col": 4},   # top-left of 3x2 piece
                {"player": 2, "row": 9, "col": 11}
            ]
        }
        (row/col are the top-left corner of each player's 3x2 footprint)

        Returns:
        {
            "recommended_difficulty": "HARD",
            "vr_challenge_game": "uri_adi",
            "vr_trivia_game": "sadhya_memory",
            "red_zone": {"row": 5, "col": 6},   # top-left of 4x3 zone
            "yellow_zone": {"row": 12, "col": 2},
            "reason": "..."
        }
        """
        result = None
        if self.mode == "ollama":
            result = self._ask_gemma(player_stats, board_state)
            if result is not None:
                result = self._validate_and_fix(result, board_state)

        if result is None:
            logger.warning("Gemma call failed or was invalid — using heuristic.")
            result = self._heuristic(player_stats, board_state)

        return result

    # ------------------------------------------------------------------
    # Gemma via Ollama
    # ------------------------------------------------------------------
    def _ask_gemma(self, stats: dict, board_state: dict) -> Optional[dict]:
        prompt = self._build_prompt(stats, board_state)
        try:
            resp = requests.post(
                config.OLLAMA_URL,
                json={
                    "model": config.OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.3},
                },
                timeout=config.GEMMA_TIMEOUT_SEC,
            )
            resp.raise_for_status()
            raw_text = resp.json().get("response", "")
            return self._parse_gemma_response(raw_text)
        except Exception as e:
            logger.warning(f"Ollama request failed: {e}")
            return None

    def _build_prompt(self, stats: dict, board_state: dict) -> str:
        return f"""You are the adaptive board controller for an Onam-themed
physical-AI board game. Board is an 18-row x 20-col LED matrix (rows 0-17,
cols 0-19). Each player's piece occupies a 3x2 cell footprint. You must
choose ONE 4x3 zone to light RED (VR_CHALLENGE, escape-type game) and ONE
separate 4x3 zone to light YELLOW (VR_TRIVIA, trivia-type game).

Rules for zone placement:
- Each zone is 4 rows tall x 3 cols wide. Give the ROW,COL of its top-left
  corner. A zone with top-left (row, col) occupies rows row..row+3 and
  cols col..col+2 — both must stay inside the board (row+3 <= 17,
  col+2 <= 19).
- The RED zone and YELLOW zone must not overlap each other.
- Neither zone may overlap any player's current 3x2 position.
- Prefer placing zones within a few cells of the current player's position,
  so it's reachable in the next turn or two, but this is a soft preference.

Available VR_CHALLENGE (escape-type) games: {config.VR_CHALLENGE_GAMES}
Available VR_TRIVIA (trivia-type) games: {config.VR_TRIVIA_GAMES}

Current player stats (JSON):
{json.dumps(stats)}

Board state (JSON):
{json.dumps(board_state)}

Difficulty rules of thumb:
- success rate and accuracy above ~0.85 with fast response times -> increase difficulty
- success rate and accuracy below ~0.55, or slow responses -> decrease difficulty
- otherwise keep it close to current_difficulty
- never jump more than one level at a time

Game choice rule of thumb: players with lower trivia_accuracy or slower
average_response_time tend to do better on memory-based games than fast
reaction-time games — pick accordingly.

Respond with ONLY a JSON object, no extra text, in exactly this shape:
{{"recommended_difficulty": "EASY|MEDIUM|HARD|HARD_PLUS",
  "vr_challenge_game": "<one of the VR_CHALLENGE games>",
  "vr_trivia_game": "<one of the VR_TRIVIA games>",
  "red_zone": {{"row": <int>, "col": <int>}},
  "yellow_zone": {{"row": <int>, "col": <int>}},
  "reason": "<one short sentence>"}}
"""

    def _parse_gemma_response(self, text: str) -> Optional[dict]:
        # Gemma sometimes wraps JSON in ```json fences or adds stray text — extract the {...}
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        try:
            parsed = json.loads(match.group(0))
            level = parsed.get("recommended_difficulty", "").upper()
            if level not in config.DIFFICULTY_LEVELS:
                return None
            if parsed.get("vr_challenge_game") not in config.VR_CHALLENGE_GAMES:
                return None
            if parsed.get("vr_trivia_game") not in config.VR_TRIVIA_GAMES:
                return None
            red = parsed.get("red_zone", {})
            yellow = parsed.get("yellow_zone", {})
            if "row" not in red or "col" not in red or "row" not in yellow or "col" not in yellow:
                return None
            return {
                "recommended_difficulty": level,
                "vr_challenge_game": parsed["vr_challenge_game"],
                "vr_trivia_game": parsed["vr_trivia_game"],
                "red_zone": {"row": int(red["row"]), "col": int(red["col"])},
                "yellow_zone": {"row": int(yellow["row"]), "col": int(yellow["col"])},
                "reason": parsed.get("reason", "Gemma adaptive recommendation."),
            }
        except (json.JSONDecodeError, ValueError, TypeError):
            return None

    # ------------------------------------------------------------------
    # validation — never trust an LLM's grid arithmetic blindly
    # ------------------------------------------------------------------
    def _validate_and_fix(self, result: dict, board_state: dict) -> Optional[dict]:
        zone_h, zone_w = config.ZONE_SIZE  # (4, 3)
        red = result["red_zone"]
        yellow = result["yellow_zone"]

        red_rect = (red["row"], red["col"], zone_h, zone_w)
        yellow_rect = (yellow["row"], yellow["col"], zone_h, zone_w)

        if not self._in_bounds(red_rect) or not self._in_bounds(yellow_rect):
            return None
        if self._rects_overlap(red_rect, yellow_rect):
            return None

        player_h, player_w = config.PLAYER_SIZE  # (3, 2)
        for p in board_state.get("player_positions", []):
            p_rect = (p["row"], p["col"], player_h, player_w)
            if self._rects_overlap(red_rect, p_rect) or self._rects_overlap(yellow_rect, p_rect):
                return None

        return result

    def _in_bounds(self, rect) -> bool:
        row, col, h, w = rect
        return (
            0 <= row and row + h - 1 <= config.BOARD_ROWS - 1
            and 0 <= col and col + w - 1 <= config.BOARD_COLS - 1
        )

    def _rects_overlap(self, a, b) -> bool:
        a_row, a_col, a_h, a_w = a
        b_row, b_col, b_h, b_w = b
        return not (
            a_row + a_h <= b_row
            or b_row + b_h <= a_row
            or a_col + a_w <= b_col
            or b_col + b_w <= a_col
        )

    # ------------------------------------------------------------------
    # heuristic fallback (also useful standalone / offline demo mode)
    # ------------------------------------------------------------------
    def _heuristic(self, stats: dict, board_state: dict) -> dict:
        success = stats.get("recent_vr_success", 0.5)
        accuracy = stats.get("trivia_accuracy", 0.5)
        resp_time = stats.get("average_response_time", 6.0)
        current = stats.get("current_difficulty", config.DEFAULT_DIFFICULTY)

        score = (success * 0.5) + (accuracy * 0.4) - min(resp_time / 20.0, 0.1)
        levels = config.DIFFICULTY_LEVELS
        idx = levels.index(current) if current in levels else 1

        if score >= 0.8 and idx < len(levels) - 1:
            idx += 1
            reason = "High recent success and accuracy — stepping difficulty up."
        elif score <= 0.5 and idx > 0:
            idx -= 1
            reason = "Recent struggles detected — easing difficulty down."
        else:
            reason = "Performance is steady — keeping difficulty unchanged."

        # Slower / less accurate players lean toward the memory-style game;
        # faster / more accurate players get the reaction-time game.
        challenge_game = random.choice(config.VR_CHALLENGE_GAMES)
        if accuracy < 0.6 or resp_time > 8.0:
            trivia_game = config.VR_TRIVIA_GAMES[0]
        else:
            trivia_game = random.choice(config.VR_TRIVIA_GAMES)

        red_zone = self._random_valid_zone(board_state, exclude=[])
        yellow_zone = self._random_valid_zone(
            board_state, exclude=[self._zone_to_rect(red_zone)]
        )

        return {
            "recommended_difficulty": levels[idx],
            "vr_challenge_game": challenge_game,
            "vr_trivia_game": trivia_game,
            "red_zone": red_zone,
            "yellow_zone": yellow_zone,
            "reason": reason,
        }

    def _zone_to_rect(self, zone: dict):
        h, w = config.ZONE_SIZE
        return (zone["row"], zone["col"], h, w)

    def _random_valid_zone(self, board_state: dict, exclude: list) -> dict:
        """Pick a random in-bounds 4x3 zone that doesn't overlap any player
        piece or any rect already reserved this call. Retries a bounded
        number of times, then falls back to a scan of every cell so this
        can never infinite-loop or fail on a mostly-full board."""
        zone_h, zone_w = config.ZONE_SIZE
        player_h, player_w = config.PLAYER_SIZE
        player_rects = [
            (p["row"], p["col"], player_h, player_w)
            for p in board_state.get("player_positions", [])
        ]

        def is_free(row, col) -> bool:
            rect = (row, col, zone_h, zone_w)
            if not self._in_bounds(rect):
                return False
            for other in player_rects + exclude:
                if self._rects_overlap(rect, other):
                    return False
            return True

        for _ in range(50):
            row = random.randint(0, config.BOARD_ROWS - zone_h)
            col = random.randint(0, config.BOARD_COLS - zone_w)
            if is_free(row, col):
                return {"row": row, "col": col}

        # Exhaustive fallback — guarantees a result exists or raises clearly.
        for row in range(0, config.BOARD_ROWS - zone_h + 1):
            for col in range(0, config.BOARD_COLS - zone_w + 1):
                if is_free(row, col):
                    return {"row": row, "col": col}

        raise RuntimeError("No valid zone placement found — board is too full.")
