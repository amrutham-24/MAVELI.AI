"""
main.py
FastAPI backend tying together: Arduino (pyserial), the game engine, Gemma
adaptive difficulty, and the VR website (WebSocket for pushed challenges +
live state, REST for posting results back).

Run:
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

If you don't have the Arduino plugged in yet, set USE_MOCK_SERIAL = True
below to develop/demo the whole loop without hardware.
"""

import asyncio
import logging
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import config
from models import VRResultIn, GameStateOut, ManualRollIn
from serial_handler import SerialHandler, MockSerialHandler
from game_engine import GameEngine

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("main")

# Flip to True for development without an Arduino attached
USE_MOCK_SERIAL = True

app = FastAPI(title="Snake & Ladder Physical-AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],           # tighten this for production / judging network
    allow_methods=["*"],
    allow_headers=["*"],
)

serial_handler = MockSerialHandler() if USE_MOCK_SERIAL else SerialHandler()
engine = GameEngine(serial_handler)

# ---------------------------------------------------------------------------
# WebSocket connection management (VR website + any spectator/LED dashboard)
# ---------------------------------------------------------------------------
active_sockets: Set[WebSocket] = set()
_loop: asyncio.AbstractEventLoop | None = None


async def _broadcast(payload: dict):
    dead = []
    for ws in active_sockets:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        active_sockets.discard(ws)


def _schedule_broadcast(payload: dict):
    """Thread-safe bridge: game_engine callbacks fire from the serial reader
    thread, but broadcasting must happen on the asyncio event loop."""
    if _loop is None:
        return
    asyncio.run_coroutine_threadsafe(_broadcast(payload), _loop)


def _on_state_change():
    _schedule_broadcast({"type": "state", "data": engine.to_dict()})


def _on_challenge_ready(challenge: dict):
    _schedule_broadcast({"type": "challenge", "data": challenge})


engine.on_state_change = _on_state_change
engine.on_challenge_ready = _on_challenge_ready


# ---------------------------------------------------------------------------
# lifecycle
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    global _loop
    _loop = asyncio.get_event_loop()
    serial_handler.start()
    logger.info("Backend started. Waiting for ROLL button (also starts the game).")


@app.on_event("shutdown")
async def shutdown():
    serial_handler.stop()


# ---------------------------------------------------------------------------
# WebSocket — VR website (and/or a spectator dashboard) connects here
# ---------------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_sockets.add(websocket)
    # send current state immediately on connect
    await websocket.send_json({"type": "state", "data": engine.to_dict()})
    try:
        while True:
            # We don't require the client to send anything, but keep the
            # connection alive and allow future two-way messages if needed.
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_sockets.discard(websocket)


# ---------------------------------------------------------------------------
# REST — VR website posts the outcome of a challenge here
# ---------------------------------------------------------------------------
@app.post("/vr/result")
async def vr_result(payload: VRResultIn):
    engine.apply_vr_result(
        player_id=payload.player_id,
        success=payload.success,
        response_time_sec=payload.response_time_sec,
        challenge_type=payload.challenge_type,
    )
    return {"ok": True, "state": engine.to_dict()}


# ---------------------------------------------------------------------------
# REST — state polling (useful for a simple spectator screen, or debugging)
# ---------------------------------------------------------------------------
@app.get("/state", response_model=GameStateOut)
async def get_state():
    return engine.to_dict()


@app.post("/reset")
async def reset_game():
    engine.reset()
    engine.on_state_change = _on_state_change
    engine.on_challenge_ready = _on_challenge_ready
    _on_state_change()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Debug helpers — simulate button presses without touching the Arduino.
# Handy while wiring up the VR site / Gemma before hardware is ready,
# or for a backup demo path if a servo/wire fails on stage.
# ---------------------------------------------------------------------------
@app.post("/debug/button/roll")
async def debug_roll():
    if not isinstance(serial_handler, MockSerialHandler):
        raise HTTPException(400, "Debug button endpoints only work with USE_MOCK_SERIAL=True")
    serial_handler.fire(config.BTN_ROLL)
    return {"ok": True, "state": engine.to_dict()}


@app.post("/debug/button/vr_ready")
async def debug_vr_ready():
    if not isinstance(serial_handler, MockSerialHandler):
        raise HTTPException(400, "Debug button endpoints only work with USE_MOCK_SERIAL=True")
    serial_handler.fire(config.BTN_VR_READY)
    return {"ok": True, "state": engine.to_dict()}


@app.get("/")
async def root():
    return {
        "status": "running",
        "phase": engine.phase,
        "current_player": engine.current_player_id,
        "hint": "Connect the VR website to ws://<host>:8000/ws and POST results to /vr/result",
    }
