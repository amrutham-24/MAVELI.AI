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

# 18x20 LED matrix geometry for dynamic RED/YELLOW VR zones
BOARD_ROWS = 18
BOARD_COLS = 20
ZONE_SIZE = (4, 3)     # (height, width) of a VR trigger zone — red or yellow
PLAYER_SIZE = (3, 2)   # (height, width) of a player's piece footprint on the matrix

# VR game pools used by gemma_adaptive.py's plan_next_turn()
VR_CHALLENGE_GAMES = ["uri_adi", "vallamkali"]          # escape-type (RED zones)
VR_TRIVIA_GAMES = ["sadhya_memory", "pookalam_bloom"]   # trivia-type (YELLOW zones)

# ---------------------------------------------------------------------------
# MAVELI / MAHABALI (physical servo characters)
# ---------------------------------------------------------------------------
MAVELI_START_STATE = 50
MAVELI_STEP_ON_SUCCESS = -8
MAVELI_STEP_ON_FAILURE = 12
MAVELI_MIN, MAVELI_MAX = 0, 100

MAVELI_SERVO_ANGLE_MIN = 0
MAVELI_SERVO_ANGLE_MAX = 180
WHEEL_SERVO_ANGLE_MIN = 0
WHEEL_SERVO_ANGLE_MAX = 180
WHEEL_POSITIONS = DICE_MAX

# ---------------------------------------------------------------------------
# ESP32 (Wi-Fi) — replaces SERIAL_PORT / SERIAL_BAUD
# ---------------------------------------------------------------------------
ESP32_IP = "192.168.1.50"      # set a static IP (or DHCP reservation) on the ESP32
ESP32_PORT = 8765
ESP32_PROTOCOL = "ws"          # WebSocket, not raw TCP/HTTP polling
ESP32_RECONNECT_DELAY_SEC = 2.0

# Arduino/ESP32 -> Laptop message prefixes we listen for
BTN_ROLL = "BUTTON,ROLL"          # also acts as "start game" on first press
BTN_VR_READY = "BUTTON,VR_READY"  # player says "I'm in the VR headset, ready"

# Laptop -> ESP32 commands we send
CMD_SPIN = "SPIN"          # SPIN,<1-8>
CMD_LED = "LED"            # LED,<square>
CMD_MAVELI = "MAVELI"      # MAVELI,<angle>
CMD_MAHABALI = "MAHABALI"  # MAHABALI,<angle>  (win-condition servo)
CMD_ZONE = "ZONE"              # ZONE,<RED|YELLOW>,<row>,<col>,<h>,<w>
CMD_ZONE_CLEAR = "ZONE_CLEAR"  # ZONE_CLEAR,<RED|YELLOW>

# ---------------------------------------------------------------------------
# GEMMA (adaptive difficulty + zone/game planning)
# ---------------------------------------------------------------------------
GEMMA_MODE = "ollama"                 # "ollama" | "heuristic_only"
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "gemma3:4b"            # bumped from gemma2:2b — your RTX has headroom
GEMMA_TIMEOUT_SEC = 4.0

DIFFICULTY_LEVELS = ["EASY", "MEDIUM", "HARD", "HARD_PLUS"]
DEFAULT_DIFFICULTY = "MEDIUM"

# ---------------------------------------------------------------------------
# SERVER
# ---------------------------------------------------------------------------
HOST = "0.0.0.0"
PORT = 8000
NUM_PLAYERS = 4
