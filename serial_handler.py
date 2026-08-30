"""
serial_handler.py
Wraps pyserial in a background thread so reading Arduino button events never
blocks the FastAPI event loop. Also exposes simple send_* helpers for the
commands the Arduino sketch understands.

Arduino sketch contract (adjust to match your actual firmware):

  Arduino -> Laptop (one line per event, newline terminated):
      BUTTON,ROLL
      BUTTON,VR_READY

  Laptop -> Arduino (one line per command, newline terminated):
      SPIN,<1-8>
      LED,<square>
      MAVELI,<angle>
      MAHABALI,<angle>
"""

import threading
import time
import logging
from typing import Callable, Optional

import serial  # pyserial

import config

logger = logging.getLogger("serial_handler")


class SerialHandler:
    def __init__(self, port: str = getattr(config, "SERIAL_PORT", "COM3"), baud: int = getattr(config, "SERIAL_BAUD", 115200)):
        self.port = port
        self.baud = baud
        self._ser: Optional[serial.Serial] = None
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.on_event: Optional[Callable[[str], None]] = None  # set by GameEngine

    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------
    def start(self):
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        if self._ser and self._ser.is_open:
            self._ser.close()

    def _connect(self):
        while not self._stop.is_set():
            try:
                self._ser = serial.Serial(self.port, self.baud, timeout=1)
                logger.info(f"Connected to Arduino on {self.port}")
                time.sleep(2)  # allow Arduino to reset after serial open
                return
            except serial.SerialException as e:
                logger.warning(f"Could not open {self.port}: {e}. Retrying...")
                time.sleep(config.SERIAL_RECONNECT_DELAY_SEC)

    def _run(self):
        self._connect()
        buf = b""
        while not self._stop.is_set():
            try:
                if not self._ser or not self._ser.is_open:
                    self._connect()
                    continue
                chunk = self._ser.readline()
                if not chunk:
                    continue
                line = chunk.decode(errors="ignore").strip()
                if not line:
                    continue
                logger.info(f"[Arduino->Laptop] {line}")
                if self.on_event:
                    self.on_event(line)
            except serial.SerialException as e:
                logger.warning(f"Serial error: {e}. Reconnecting...")
                self._ser = None
                time.sleep(config.SERIAL_RECONNECT_DELAY_SEC)

    # ------------------------------------------------------------------
    # sending commands
    # ------------------------------------------------------------------
    def _send(self, line: str):
        if not self._ser or not self._ser.is_open:
            logger.warning(f"Serial not connected, dropped command: {line}")
            return
        try:
            self._ser.write((line + "\n").encode())
            logger.info(f"[Laptop->Arduino] {line}")
        except serial.SerialException as e:
            logger.warning(f"Failed to send '{line}': {e}")

    def send_spin(self, value: int):
        self._send(f"{config.CMD_SPIN},{value}")

    def send_led(self, square: int):
        self._send(f"{config.CMD_LED},{square}")

    def send_maveli(self, angle: int):
        self._send(f"{config.CMD_MAVELI},{angle}")

    def send_mahabali(self, angle: int):
        self._send(f"{config.CMD_MAHABALI},{angle}")


class MockSerialHandler(SerialHandler):
    """Drop-in replacement for demos/dev when no Arduino is plugged in.
    Just logs what WOULD have been sent, and lets you fire events manually
    (see main.py /debug/button endpoint) to simulate button presses.
    """

    def start(self):
        logger.info("MockSerialHandler active — no real Arduino connected.")

    def stop(self):
        pass

    def _send(self, line: str):
        logger.info(f"[MOCK Laptop->Arduino] {line}")

    def fire(self, event: str):
        """Call this from a debug endpoint to simulate an Arduino button press."""
        if self.on_event:
            self.on_event(event)
