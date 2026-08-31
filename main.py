"""
main.py
FastAPI backend tying together: ESP32 (Wi-Fi WebSocket), the game engine,
Gemma adaptive difficulty, and the VR website (WebSocket for pushed
challenges + live state, REST for posting results back).

Run:
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

If you don't have the ESP32 flashed/connected yet, set USE_MOCK_ESP32 = True
below to develop/demo the whole loop without hardware.
"""

import asyncio
import os
import logging
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import config
from models import VRResultIn, GameStateOut, ManualRollIn
from serial_handler import SerialHandler, MockSerialHandler
from game_engine import GameEngine

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
# Root logging config — controls the default format/level for any logger
# that doesn't set its own (uvicorn's own loggers manage themselves).
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)

logger = logging.getLogger("main")

# Explicitly ensure the game_engine logger (where Gemma prompt/response
# logging lives, e.g. `logger.info(f"[GEMMA PROMPT]...")`) is set to DEBUG
# and propagates up to the root handler configured above, so those lines
# reliably show up on your terminal regardless of import order.
gemma_logger = logging.getLogger("game_engine")
gemma_logger.setLevel(logging.DEBUG)
gemma_logger.propagate = True

# Quiet down noisy third-party loggers if needed (uncomment if httpx/requests
# spam the terminal and drown out the Gemma prompt/response logs).
# logging.getLogger("httpx").setLevel(logging.WARNING)
# logging.getLogger("urllib3").setLevel(logging.WARNING)

# Flip to True for development without an ESP32 attached (defaults to False for physical setup)
USE_MOCK_ESP32 = os.getenv("USE_MOCK_ESP32", "False").lower() in ("true", "1", "yes")

app = FastAPI(title="Snake & Ladder Physical-AI Backend")

app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/uri-adi", StaticFiles(directory="uri-adi"), name="uri-adi")
app.mount("/chenda", StaticFiles(directory="chenda"), name="chenda")
app.mount("/vallamkali", StaticFiles(directory="vallamkali"), name="vallamkali")
app.mount("/sadya-memory", StaticFiles(directory="sadya-memory"), name="sadya-memory")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],           # tighten this for production / judging network
    allow_methods=["*"],
    allow_headers=["*"],
)

esp32_handler = MockSerialHandler() if USE_MOCK_ESP32 else SerialHandler()
engine = GameEngine(esp32_handler)

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
    """Thread-safe bridge: game_engine callbacks fire from the ESP32 reader
    thread/task, but broadcasting must happen on the asyncio event loop."""
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
    esp32_handler.start()
    logger.info(
        "Backend started. Waiting for ROLL button over ESP32 Wi-Fi "
        "(also starts the game)."
    )


@app.on_event("shutdown")
async def shutdown():
    esp32_handler.stop()


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
# Debug helpers — simulate button presses without touching the ESP32.
# Handy while wiring up the VR site / Gemma before hardware is ready,
# or for a backup demo path if Wi-Fi/a servo fails on stage.
# ---------------------------------------------------------------------------
@app.post("/debug/button/roll")
async def debug_roll():
    if not isinstance(esp32_handler, MockSerialHandler):
        raise HTTPException(400, "Debug button endpoints only work with USE_MOCK_ESP32=True")
    esp32_handler.fire(config.BTN_ROLL)
    return {"ok": True, "state": engine.to_dict()}


@app.post("/debug/button/vr_ready")
async def debug_vr_ready():
    if not isinstance(esp32_handler, MockSerialHandler):
        raise HTTPException(400, "Debug button endpoints only work with USE_MOCK_ESP32=True")
    esp32_handler.fire(config.BTN_VR_READY)
    return {"ok": True, "state": engine.to_dict()}


@app.get("/")
async def root():
    return {
        "status": "running",
        "phase": engine.phase,
        "current_player": engine.current_player_id,
        "hint": "Connect the VR website to ws://<host>:8000/ws and POST results to /vr/result",
    }