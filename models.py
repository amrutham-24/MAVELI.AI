"""
models.py
Pydantic schemas for everything that crosses the laptop <-> VR website boundary,
plus a couple of REST request bodies.
"""

from pydantic import BaseModel, Field
from typing import Optional, Literal


class VRResultIn(BaseModel):
    """VR website POSTs this back to the laptop after a challenge finishes."""
    player_id: int
    success: bool
    response_time_sec: float = Field(..., ge=0)
    challenge_type: Optional[str] = None  # e.g. "trivia", "reflex", "puzzle"


class ChallengeOut(BaseModel):
    """Laptop -> VR website: what challenge to render, at what difficulty."""
    player_id: int
    difficulty: Literal["EASY", "MEDIUM", "HARD", "HARD_PLUS"]
    challenge_type: str
    reason: Optional[str] = None  # human-readable, handy for judges/demo overlay


class ManualRollIn(BaseModel):
    """Fallback REST endpoint if you want to trigger a roll without the button."""
    player_id: Optional[int] = None


class PlayerState(BaseModel):
    id: int
    position: int
    difficulty: str
    vr_success_rate: float
    trivia_accuracy: float
    avg_response_time: float


class GameStateOut(BaseModel):
    current_player: int
    phase: str
    players: list[PlayerState]
    maaveli_state: int
    winner: Optional[int] = None
