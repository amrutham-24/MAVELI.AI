"""
config.py
Central place for board layout, hardware, and Gemma settings.
Tweak these numbers to match your physical board / Arduino sketch.
"""

# ---------------------------------------------------------------------------
# BOARD
# ---------------------------------------------------------------------------
BOARD_SIZE = 100          # last square = win
DICE_MIN = 1
DICE_MAX = 8               # your spin wheel is 1-8, not a normal 6-sided die

SNAKES = {
    17: 7,
    54: 34,
    62: 19,
    87: 24,
    93: 68,
}

LADDERS = {
    3: 22,
    11: 39,
    27: 56,
    40: 59,
    72: 91,
}

# ---------------------------------------------------------------------------
# MAVELI / MAHABALI (physical servo characters)
# ---------------------------------------------------------------------------
# maveli_state is tracked 0 (very safe / Kerala) -> 100 (fully descended / Pathalam)
MAVELI_START_STATE = 50
MAVELI_STEP_ON_SUCCESS = -8     # player succeeds VR challenge -> Maveli rises back up (safer)
MAVELI_STEP_ON_FAILURE = 12     # player fails -> Maveli sinks further toward Pathalam
MAVELI_MIN, MAVELI_MAX = 0, 100

# servo angle mapping (adjust to your physical rig's real min/max angles)
MAVELI_SERVO_ANGLE_MIN = 0
MAVELI_SERVO_ANGLE_MAX = 180

WHEEL_SERVO_ANGLE_MIN = 0
WHEEL_SERVO_ANGLE_MAX = 180
WHEEL_POSITIONS = DICE_MAX  # 1..8 -> 8 discrete stops on the wheel servo

# ---------------------------------------------------------------------------
# SERIAL (Arduino)
# ---------------------------------------------------------------------------
SERIAL_PORT = "/dev/ttyUSB0"   # change to e.g. "COM5" on Windows
SERIAL_BAUD = 115200
SERIAL_RECONNECT_DELAY_SEC = 2.0

# Arduino -> Laptop message prefixes we listen for (see serial_handler.py)
BTN_ROLL = "BUTTON,ROLL"          # also acts as "start game" on first press
BTN_VR_READY = "BUTTON,VR_READY"  # player says "I'm in the VR headset, ready"

# Laptop -> Arduino commands we send (see serial_handler.py send helpers)
CMD_SPIN = "SPIN"          # SPIN,<1-8>
CMD_LED = "LED"            # LED,<square>
CMD_MAVELI = "MAVELI"      # MAVELI,<angle>
CMD_MAHABALI = "MAHABALI"  # MAHABALI,<angle>  (win-condition servo)

# ---------------------------------------------------------------------------
# GEMMA (adaptive difficulty)
# ---------------------------------------------------------------------------
# Local Gemma served via Ollama (typical hackathon setup: `ollama run gemma2:2b`)
GEMMA_MODE = "ollama"                 # "ollama" | "heuristic_only"
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "gemma2:2b"
GEMMA_TIMEOUT_SEC = 4.0

# Difficulty levels exposed to the VR site
DIFFICULTY_LEVELS = ["EASY", "MEDIUM", "HARD", "HARD_PLUS"]
DEFAULT_DIFFICULTY = "MEDIUM"

# ---------------------------------------------------------------------------
# SERVER
# ---------------------------------------------------------------------------
HOST = "0.0.0.0"
PORT = 8000
NUM_PLAYERS = 4
