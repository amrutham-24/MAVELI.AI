# Snake & Ladder Physical-AI Backend

Python backend for the board game: FastAPI + pyserial + Gemma (local via Ollama).

```
LAPTOP (this backend)
  - game_engine.py   : referee — state, RNG, snake/ladder, Maveli, win condition
  - gemma_adaptive.py: adaptive difficulty (Ollama Gemma, with heuristic fallback)
  - serial_handler.py: talks to Arduino over USB serial
  - main.py          : FastAPI — WebSocket for VR site, REST for results
```

## 1. Install

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## 2. (Optional but recommended) Run Gemma locally via Ollama

```bash
ollama pull gemma2:2b
ollama serve
```

If Ollama isn't running or times out, `gemma_adaptive.py` automatically falls
back to a transparent heuristic — the demo never breaks on stage.
To skip Gemma entirely, set `GEMMA_MODE = "heuristic_only"` in `config.py`.

## 3. Configure hardware

Edit `config.py`:
- `SERIAL_PORT` — your Arduino's port (`/dev/ttyUSB0`, `/dev/ttyACM0`, or `COM5`)
- `SNAKES` / `LADDERS` — match your physical board
- Servo angle ranges for Maveli / wheel

Your Arduino sketch should:
- Print `BUTTON,ROLL` when the roll/start button is pressed
- Print `BUTTON,VR_READY` when the VR-enter button is pressed
- Understand incoming lines: `SPIN,<1-8>`, `LED,<square>`, `MAVELI,<angle>`, `MAHABALI,<angle>`

## 4. No Arduino yet? Develop without hardware

In `main.py`, set:
```python
USE_MOCK_SERIAL = True
```
Then simulate button presses with:
```bash
curl -X POST http://localhost:8000/debug/button/roll
curl -X POST http://localhost:8000/debug/button/vr_ready
```

## 5. Run

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

## 6. Connect the VR website

- Connect a WebSocket to `ws://<laptop-ip>:8000/ws`
- On `{"type": "challenge", "data": {...}}` — render that challenge at the given difficulty
- When the player finishes, `POST /vr/result`:

```json
{
  "player_id": 2,
  "success": true,
  "response_time_sec": 4.1,
  "challenge_type": "trivia"
}
```

- Also listen for `{"type": "state", "data": {...}}` messages to keep any
  spectator screen / LED-mirroring UI in sync.

## 7. Poll state directly (for a spectator screen, or debugging)

```bash
curl http://localhost:8000/state
```

## 8. Reset between demo runs

```bash
curl -X POST http://localhost:8000/reset
```

---

### Demo narrative for judges

> Player rolls physically → Arduino reports the button press → the laptop's
> game engine generates the number and drives the wheel servo → if they land
> on a snake or ladder, the laptop asks **Gemma** to size the next VR
> challenge to that specific player's recent performance → the VR result
> comes back → the game engine updates the board *and* physically moves the
> Maveli servo based on how the player is doing over time.
>
> That last step — an AI decision changing a physical object in the real
> world — is the Physical AI story.
