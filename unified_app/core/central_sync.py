"""
Central Sync Service - Gửi OCR logs từ Edge lên Central Server

Workflow:
1. OCR finalized → Lưu vào local DB (synced=0)
2. Background sync worker: Lấy unsynced records → Gửi lên server
3. Nếu thành công → Xóa khỏi DB
4. Nếu thất bại → Tăng retry_count, retry sau
"""
import requests
import threading
import time
import logging
from typing import Optional
import json

try:
    import websocket  # websocket-client library
    WEBSOCKET_AVAILABLE = True
except ImportError:
    WEBSOCKET_AVAILABLE = False
    logging.warning("websocket-client not installed, WebSocket sync disabled")

from .db import get_unsynced_logs, mark_log_synced, increment_retry_count
from .events import get_event_emitter


class CentralSyncService:
    """Service sync OCR logs lên central server"""

    def __init__(self, central_url: str, device_id: str = "unified-app-001"):
        """
        Args:
            central_url: URL của central server
            device_id: ID định danh cho edge device này
        """
        self.central_url = central_url.rstrip("/")
        self.device_id = device_id
        
        self.running = False
        self.sync_thread: Optional[threading.Thread] = None
        self.heartbeat_thread: Optional[threading.Thread] = None

        # WebSocket
        self.ws: Optional[websocket.WebSocketApp] = None if WEBSOCKET_AVAILABLE else None
        self.ws_connected = False
        self.ws_thread: Optional[threading.Thread] = None

        # Stats
        self.logs_sent = 0
        self.logs_failed = 0
        self.last_sync_time = None

        logging.info(f"[Central Sync] Initialized with URL: {self.central_url}")

        logging.info(f"[Central Sync] Initialized with URL: {self.central_url}")


    def start(self):
        """Start sync service"""
        if self.running:
            return

        self.running = True
        logging.info("[Central Sync] Starting sync service...")

        # Start WebSocket connection (if available)
        if WEBSOCKET_AVAILABLE and self.ws is not None:
            self.ws_thread = threading.Thread(target=self._websocket_loop, daemon=True)
            self.ws_thread.start()

        # Start sync loop (lấy unsync logs và gửi)
        self.sync_thread = threading.Thread(target=self._sync_loop, daemon=True)
        self.sync_thread.start()

        # Start heartbeat (30s interval)
        self.heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self.heartbeat_thread.start()

        logging.info("[Central Sync] Service started")

    def stop(self):
        """Stop sync service"""
        self.running = False
        if self.ws:
            self.ws.close()
        logging.info("[Central Sync] Service stopped")

    def _sync_loop(self):
        """Main sync loop: Lấy unsynced logs và gửi lên server"""
        while self.running:
            try:
                # Lấy danh sách chưa sync (synced=0, retry_count < 5)
                unsynced = get_unsynced_logs(limit=50)

                if not unsynced:
                    # Broadcast status even when idle
                    self._broadcast_status()
                    time.sleep(5)  # Không có gì → chờ 5s
                    continue

                logging.info(f"[Central Sync] Found {len(unsynced)} unsynced logs")

                # Gửi từng log
                for log in unsynced:
                    if not self.running:
                        break

                    success = self._send_log_to_central(log)

                    if success:
                        # Thành công → Xóa khỏi DB
                        mark_log_synced(log["id"])
                        self.logs_sent += 1
                        self.last_sync_time = time.time()
                        logging.info(f"[Central Sync] ✅ Synced log ID={log['id']}: {log['plate_text']}")
                    else:
                        # Thất bại → Tăng retry_count
                        increment_retry_count(log["id"])
                        self.logs_failed += 1
                        logging.warning(f"[Central Sync] ❌ Failed log ID={log['id']}: {log['plate_text']}")

                    # Broadcast status after each log
                    self._broadcast_status()
                    time.sleep(0.1)  # Delay nhỏ giữa các requests

                # Sau khi xử lý batch → chờ 5s
                time.sleep(5)

            except Exception as e:
                logging.error(f"[Central Sync] Sync loop error: {e}")
                time.sleep(5)

    def _send_log_to_central(self, log: dict) -> bool:
        """
        Gửi 1 log lên central server

        Returns:
            True nếu thành công, False nếu thất bại
        """
        # Chuẩn bị payload
        payload = {
            "device_id": self.device_id,
            "camera_id": log["camera_id"],
            "camera_name": log["camera_name"],
            "plate_text": log["plate_text"],
            "timestamp": log["timestamp"],
        }

        # Try WebSocket first (if connected)
        if self.ws_connected and self.ws:
            try:
                event = {
                    "type": "OCR_LOG",
                    "data": payload
                }
                self.ws.send(json.dumps(event))
                return True
            except Exception as e:
                logging.debug(f"[Central Sync] WebSocket send failed: {e}")
                # Fallback to HTTP

        # HTTP POST fallback
        try:
            response = requests.post(
                f"{self.central_url}/api/edge/ocr",
                json=payload,
                timeout=5.0
            )

            if response.status_code in [200, 201]:
                return True
            else:
                logging.warning(f"[Central Sync] Server returned {response.status_code}: {response.text}")
                return False

        except requests.RequestException as e:
            logging.warning(f"[Central Sync] HTTP request failed: {e}")
            return False

    def _websocket_loop(self):
        """WebSocket connection loop with auto-reconnect"""
        if not WEBSOCKET_AVAILABLE:
            return

        while self.running:
            try:
                # Build WebSocket URL
                ws_url = self.central_url.replace("http://", "ws://").replace("https://", "wss://")
                ws_url = f"{ws_url}/ws/edge/{self.device_id}"

                logging.info(f"[Central Sync] Connecting to WebSocket: {ws_url}")

                # Create WebSocket connection
                self.ws = websocket.WebSocketApp(
                    ws_url,
                    on_open=self._on_ws_open,
                    on_message=self._on_ws_message,
                    on_error=self._on_ws_error,
                    on_close=self._on_ws_close
                )

                # Run forever (blocking)
                self.ws.run_forever()

                # Connection closed → wait before reconnect
                logging.info("[Central Sync] WebSocket disconnected, reconnecting in 10s...")
                time.sleep(10)

            except Exception as e:
                logging.error(f"[Central Sync] WebSocket error: {e}")
                time.sleep(10)

    def _on_ws_open(self, ws):
        """WebSocket opened"""
        logging.info("[Central Sync] WebSocket connected")
        self.ws_connected = True
        self._broadcast_status()  # Broadcast connection status

    def _on_ws_message(self, ws, message):
        """Received message from Central"""
        try:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "connected":
                logging.info(f"[Central Sync] {data.get('message')}")
            elif msg_type == "pong":
                pass  # Heartbeat response
            else:
                logging.debug(f"[Central Sync] Unknown message: {msg_type}")

        except Exception as e:
            logging.error(f"[Central Sync] Error handling message: {e}")

    def _on_ws_error(self, ws, error):
        """WebSocket error"""
        logging.error(f"[Central Sync] WebSocket error: {error}")

    def _on_ws_close(self, ws, close_status_code, close_msg):
        """WebSocket closed"""
        logging.info(f"[Central Sync] WebSocket closed (code={close_status_code})")
        self.ws_connected = False
        self._broadcast_status()  # Broadcast disconnection status

    def _heartbeat_loop(self):
        """Send heartbeat every 30s"""
        while self.running:
            try:
                self._send_heartbeat()
                time.sleep(30)
            except Exception as e:
                logging.error(f"[Central Sync] Heartbeat error: {e}")
                time.sleep(30)

    def _send_heartbeat(self):
        """Send heartbeat to central"""
        try:
            # Auto-detect local IP used to reach central
            local_ip = "127.0.0.1"
            try:
                import socket
                from urllib.parse import urlparse
                parsed = urlparse(self.central_url)
                host = parsed.hostname
                port = parsed.port or 80
                
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.settimeout(1.0)
                # Doesn't actually connect, just determines routing
                s.connect((host, port)) 
                local_ip = s.getsockname()[0]
                s.close()
            except Exception:
                pass

            response = requests.post(
                f"{self.central_url}/api/edge/heartbeat",
                json={
                    "device_id": self.device_id,
                    # "nvr_id": self.nvr_id, # Removed per user request
                    # "name": self.name,
                    # "description": self.description,
                    "host": local_ip,
                    "port": 5000,
                    "status": "online",
                    "logs_sent": self.logs_sent,
                    "logs_failed": self.logs_failed,
                    "timestamp": time.time()
                },
                timeout=5.0
            )

            if response.status_code != 200:
                logging.debug(f"[Central Sync] Heartbeat failed: {response.status_code}")

        except requests.RequestException as e:
            logging.debug(f"[Central Sync] Heartbeat error: {e}")

    def _broadcast_status(self):
        """Broadcast sync status qua event emitter"""
        try:
            # Lấy số lượng pending logs
            pending = len(get_unsynced_logs(limit=1000))

            # Emit signal
            event_emitter = get_event_emitter()
            event_emitter.sync_status_changed.emit(
                self.ws_connected,
                self.logs_sent,
                self.logs_failed,
                pending
            )
        except Exception as e:
            logging.debug(f"[Central Sync] Failed to broadcast status: {e}")

    def get_status(self) -> dict:
        """Get sync status"""
        pending = len(get_unsynced_logs(limit=1000))
        return {
            "running": self.running,
            "central_url": self.central_url,
            "device_id": self.device_id,
            "ws_connected": self.ws_connected,
            "logs_sent": self.logs_sent,
            "logs_failed": self.logs_failed,
            "pending": pending,
            "last_sync_time": self.last_sync_time,
        }
