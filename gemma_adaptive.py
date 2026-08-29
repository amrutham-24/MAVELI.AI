"""
gemma_adaptive.py
This is the "AI" in the physical-AI story: given a player's recent
performance, recommend a difficulty level for their next VR/physical challenge.

Default mode talks to a locally-running Gemma via Ollama
(`ollama pull gemma2:2b && ollama serve`). If Ollama is unreachable or
returns something unparseable, we fall back to a transparent heuristic so
the demo never breaks on stage.
"""

import json
import logging
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
    def recommend_difficulty(self, player_stats: dict) -> dict:
        """
        player_stats example:
        {
            "player": 2,
            "recent_vr_success": 0.8,
            "trivia_accuracy": 0.9,
            "average_response_time": 4.2,
            "current_difficulty": "MEDIUM"
        }

        Returns:
        {
            "recommended_difficulty": "HARD",
            "reason": "..."
        }
        """
        if self.mode == "ollama":
            result = self._ask_gemma(player_stats)
            if result is not None:
                return result
            logger.warning("Gemma call failed, falling back to heuristic.")

        return self._heuristic(player_stats)

    # ------------------------------------------------------------------
    # Gemma via Ollama
    # ------------------------------------------------------------------
    def _ask_gemma(self, player_stats: dict) -> Optional[dict]:
        prompt = self._build_prompt(player_stats)
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

    def _build_prompt(self, stats: dict) -> str:
        return f"""You are an adaptive difficulty controller for a physical board game.
Given a player's recent performance stats, choose ONE difficulty level from:
EASY, MEDIUM, HARD, HARD_PLUS.

Player stats (JSON):
{json.dumps(stats)}

Rules of thumb:
- success rate and accuracy above ~0.85 with fast response times -> increase difficulty
- success rate and accuracy below ~0.55, or slow responses -> decrease difficulty
- otherwise keep it close to current_difficulty
- never jump more than one level at a time

Respond with ONLY a JSON object, no extra text, in exactly this shape:
{{"recommended_difficulty": "EASY|MEDIUM|HARD|HARD_PLUS", "reason": "<one short sentence>"}}
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
            return {
                "recommended_difficulty": level,
                "reason": parsed.get("reason", "Gemma adaptive recommendation."),
            }
        except json.JSONDecodeError:
            return None

    # ------------------------------------------------------------------
    # heuristic fallback (also useful standalone / offline demo mode)
    # ------------------------------------------------------------------
    def _heuristic(self, stats: dict) -> dict:
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

        return {"recommended_difficulty": levels[idx], "reason": reason}
