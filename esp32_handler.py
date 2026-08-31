"""
esp32_handler.py
WebSocket client that connects to the ESP32 WebSocket server on the physical board.
Ensures non-blocking message processing and synchronous sending interface for the game engine.
"""

import asyncio
import logging
from typing import Callable, Optional
import websockets

import config

logger = logging.getLogger("esp32_handler")


class ESP32Handler:
    def __init__(self):
        self.on_event: Optional[Callable[[str], None]] = None
        self._send_queue: asyncio.Queue = asyncio.Queue()
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._connect_task: Optional[asyncio.Task] = None
        self._stop_event = asyncio.Event()

    async def start(self):
        self._loop = asyncio.get_running_loop()
        self._stop_event.clear()
        self._connect_task = asyncio.create_task(self._run())
        logger.info("ESP32Handler task scheduled in event loop.")

    async def stop(self):
        self._stop_event.set()
        if self._connect_task:
            self._connect_task.cancel()
            try:
                await self._connect_task
            except asyncio.CancelledError:
                pass
        logger.info("ESP32Handler stopped.")

    async def _run(self):
        uri = f"{config.ESP32_PROTOCOL}://{config.ESP32_IP}:{config.ESP32_PORT}"
        while not self._stop_event.is_set():
            try:
                logger.info(f"Connecting to ESP32 WebSocket at {uri}...")
                async with websockets.connect(uri) as websocket:
                    logger.info("Successfully connected to ESP32 WebSocket server.")
                    
                    # Run sender and receiver concurrently
                    sender = asyncio.create_task(self._sender_loop(websocket))
                    receiver = asyncio.create_task(self._receiver_loop(websocket))
                    
                    done, pending = await asyncio.wait(
                        [sender, receiver],
                        return_when=asyncio.FIRST_COMPLETED
                    )
                    
                    # If one of them exits/errors, cancel the other task
                    for task in pending:
                        task.cancel()
                        
            except (websockets.exceptions.WebSocketException, OSError, ConnectionError) as e:
                logger.warning(f"WebSocket client connection error: {e}. Retrying in {config.ESP32_RECONNECT_DELAY_SEC}s...")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Unexpected error in ESP32 WebSocket loop: {e}", exc_info=True)
            
            if not self._stop_event.is_set():
                await asyncio.sleep(config.ESP32_RECONNECT_DELAY_SEC)

    async def _sender_loop(self, websocket):
        try:
            while not self._stop_event.is_set():
                msg = await self._send_queue.get()
                try:
                    await websocket.send(msg)
                    logger.info(f"[Laptop->ESP32] {msg}")
                except Exception as e:
                    logger.warning(f"Failed to send message '{msg}' over websocket: {e}")
                    raise
                finally:
                    self._send_queue.task_done()
        except asyncio.CancelledError:
            pass

    async def _receiver_loop(self, websocket):
        try:
            async for message in websocket:
                if isinstance(message, bytes):
                    message = message.decode(errors="ignore")
                line = message.strip()
                if line:
                    logger.info(f"[ESP32->Laptop] {line}")
                    if self.on_event:
                        # Forward event to game engine callback
                        self.on_event(line)
        except asyncio.CancelledError:
            pass

    def _send(self, line: str):
        if self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(self._send_queue.put_nowait, line)
        else:
            logger.warning(f"Event loop is not running. Dropped command: {line}")

    def send_spin(self, value: int):
        self._send(f"{config.CMD_SPIN},{value}")

    def send_led(self, square: int):
        self._send(f"{config.CMD_LED},{square}")

    def send_maveli(self, angle: int):
        self._send(f"{config.CMD_MAVELI},{angle}")

    def send_mahabali(self, angle: int):
        self._send(f"{config.CMD_MAHABALI},{angle}")


class MockESP32Handler:
    """Mock handler for local testing/development when ESP32 is not powered on/connected."""
    def __init__(self):
        self.on_event: Optional[Callable[[str], None]] = None

    async def start(self):
        logger.info("MockESP32Handler started. Running offline without hardware connection.")

    async def stop(self):
        logger.info("MockESP32Handler stopped.")

    def _send(self, line: str):
        logger.info(f"[MOCK Laptop->ESP32] {line}")

    def send_spin(self, value: int):
        self._send(f"{config.CMD_SPIN},{value}")

    def send_led(self, square: int):
        self._send(f"{config.CMD_LED},{square}")

    def send_maveli(self, angle: int):
        self._send(f"{config.CMD_MAVELI},{angle}")

    def send_mahabali(self, angle: int):
        self._send(f"{config.CMD_MAHABALI},{angle}")

    def fire(self, event: str):
        """Simulate incoming events manually (e.g. from debug endpoints)"""
        if self.on_event:
            self.on_event(event)
