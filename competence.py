"""
competence.py — tracks each player's rolling performance across the match
and turns it into a single 0-1 competence score that drives game/difficulty
selection in gemma_adaptive.py.
"""

from collections import deque
from typing import Optional

HISTORY_LEN = 5  # how many recent challenges factor into the rolling score


class PlayerCompetenceTracker:
    def __init__(self):
        self._history: dict[int, deque] = {}

    def _history_for(self, player_id: int) -> deque:
        if player_id not in self._history:
            self._history[player_id] = deque(maxlen=HISTORY_LEN)
        return self._history[player_id]

    def record(self, player_id: int, success: bool, response_time_sec: float, game: str):
        self._history_for(player_id).append({
            "success": success,
            "response_time_sec": response_time_sec,
            "game": game,
        })

    def get_stats(self, player_id: int) -> dict:
        hist = self._history_for(player_id)
        if not hist:
            return {
                "player": player_id,
                "recent_vr_success": 0.5,
                "trivia_accuracy": 0.5,
                "average_response_time": 6.0,
                "competence_score": 0.5,
                "rounds_played": 0,
            }

        success_rate = sum(1 for h in hist if h["success"]) / len(hist)

        trivia_rounds = [h for h in hist if h["game"] == "sadhya_memory"]
        trivia_accuracy = (
            sum(1 for h in trivia_rounds if h["success"]) / len(trivia_rounds)
            if trivia_rounds else success_rate
        )

        avg_response = sum(h["response_time_sec"] for h in hist) / len(hist)

        # Faster responses nudge the score up slightly; slower nudge it down.
        # 3s = neutral, capped so one very slow/fast round can't dominate.
        speed_factor = max(-0.1, min(0.1, (3.0 - avg_response) / 30.0))

        competence_score = max(0.0, min(1.0, success_rate * 0.7 + trivia_accuracy * 0.3 + speed_factor))

        return {
            "player": player_id,
            "recent_vr_success": round(success_rate, 2),
            "trivia_accuracy": round(trivia_accuracy, 2),
            "average_response_time": round(avg_response, 2),
            "competence_score": round(competence_score, 2),
            "rounds_played": len(hist),
        }