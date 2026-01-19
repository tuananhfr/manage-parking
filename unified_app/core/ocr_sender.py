"""
OCR Sender - Send OCR detections to central server with DB-backed retry
"""
import logging
import requests
import threading
import time
from datetime import datetime
from typing import Optional

from .db import insert_ocr_log, get_unsynced_logs, mark_log_synced, increment_retry_count


class OCRSender:
    """Send OCR detections to central server via /api/edge/ocr endpoint with retry"""

    def __init__(self, central_url: str, device_id: str, enable_retry: bool = True):
        """
        Args:
            central_url: URL of central server (e.g., http://192.168.0.78:8000)
            device_id: Unique identifier for this unified_app instance
            enable_retry: Enable background retry worker for failed sends
        """
        self.central_url = central_url.rstrip('/')
        self.device_id = device_id
        self.endpoint = f"{self.central_url}/api/edge/ocr"
        self.enable_retry = enable_retry

        # Stats
        self.stats = {
            "sent": 0,
            "failed": 0,
            "retried": 0,
        }

        # Background retry worker
        self.running = False
        self.retry_thread: Optional[threading.Thread] = None

        if enable_retry:
            self.start_retry_worker()

        logging.info(f"[OCRSender] Initialized with central_url={central_url}, device_id={device_id}, retry={enable_retry}")

    def start_retry_worker(self):
        """Start background thread to retry failed sends"""
        if self.running:
            return

        self.running = True
        self.retry_thread = threading.Thread(target=self._retry_loop, daemon=True)
        self.retry_thread.start()
        logging.info("[OCRSender] Retry worker started")

    def stop_retry_worker(self):
        """Stop background retry worker"""
        self.running = False
        if self.retry_thread:
            self.retry_thread.join(timeout=2)
        logging.info("[OCRSender] Retry worker stopped")

    def send_ocr(self, camera_id: str, camera_name: str, plate_text: str, camera_type: Optional[str] = None, timestamp: Optional[str] = None) -> bool:
        """
        Send OCR detection to central server

        Strategy:
        1. Try to send immediately via HTTP POST
        2. If success → return True
        3. If fail → Save to DB for retry → return False

        Args:
            camera_id: Camera ID (e.g., 'a', 'b', 'cam1')
            camera_name: Camera name (e.g., 'khu a', 'Entrance 1')
            plate_text: Detected license plate text
            camera_type: Camera type - entrance, exit, internal
            timestamp: ISO format timestamp, defaults to current time

        Returns:
            True if sent successfully, False if failed (will retry from DB)
        """
        if not timestamp:
            timestamp = datetime.utcnow().isoformat()

        payload = {
            "device_id": self.device_id,
            "camera_id": camera_id,
            "camera_name": camera_name,
            "plate_text": plate_text,
            "camera_type": camera_type or "internal",
            "timestamp": timestamp
        }

        # Try immediate send
        success = self._send_http(payload)

        if success:
            self.stats["sent"] += 1
            logging.info(f"[OCRSender] ✓ Sent: {plate_text} -> {camera_name}")
            return True
        else:
            # Failed → Save to DB for retry
            if self.enable_retry:
                try:
                    insert_ocr_log(camera_id, plate_text, timestamp, camera_type)
                    logging.warning(f"[OCRSender] ⚠ Send failed, saved to DB for retry: {plate_text}")
                except Exception as e:
                    logging.error(f"[OCRSender] Failed to save to DB: {e}")

            self.stats["failed"] += 1
            return False

    def _send_http(self, payload: dict) -> bool:
        """
        Send payload via HTTP POST

        Returns:
            True if successful (200/201), False otherwise
        """
        try:
            response = requests.post(
                self.endpoint,
                json=payload,
                timeout=5
            )

            if response.status_code in [200, 201]:
                return True
            elif response.status_code == 404:
                # Vehicle not in parking - this is expected, treat as success
                logging.debug(f"[OCRSender] Vehicle {payload['plate_text']} not in parking (404)")
                return True  # Treat as success to avoid retry
            else:
                logging.error(f"[OCRSender] HTTP {response.status_code}: {response.text}")
                return False

        except requests.exceptions.ConnectionError as e:
            logging.error(f"[OCRSender] Connection error: {e}")
            return False
        except requests.exceptions.Timeout:
            logging.error(f"[OCRSender] Request timeout")
            return False
        except Exception as e:
            logging.error(f"[OCRSender] Error: {e}")
            return False

    def _retry_loop(self):
        """Background worker to retry failed sends from DB"""
        logging.info("[OCRSender] Retry loop started")

        while self.running:
            try:
                # Get unsynced logs from DB
                unsynced = get_unsynced_logs(limit=50)

                if not unsynced:
                    time.sleep(10)  # No pending items, wait 10s
                    continue

                logging.info(f"[OCRSender] Retrying {len(unsynced)} failed sends")

                # Retry each log
                for log in unsynced:
                    if not self.running:
                        break

                    # Lấy camera_type từ DB, nếu không có thì lấy từ config
                    camera_type = log.get("camera_type")
                    if not camera_type:
                        # Fallback: lấy từ config dựa trên camera_id
                        try:
                            from .config import load_config
                            cfg = load_config()
                            meta = cfg.get("metadata", {}).get(log["camera_id"], {})
                            camera_type = meta.get("camera_type") or "internal"
                        except Exception:
                            camera_type = "internal"
                    
                    payload = {
                        "device_id": self.device_id,
                        "camera_id": log["camera_id"],
                        "camera_name": log["camera_name"],
                        "plate_text": log["plate_text"],
                        "camera_type": camera_type,  # Quan trọng: gửi camera_type khi retry
                        "timestamp": log["timestamp"],
                    }

                    success = self._send_http(payload)

                    if success:
                        # Success → Delete from DB
                        mark_log_synced(log["id"])
                        self.stats["retried"] += 1
                        logging.info(f"[OCRSender] ✓ Retry success: {log['plate_text']}")
                    else:
                        # Failed → Increment retry count
                        increment_retry_count(log["id"])
                        logging.warning(f"[OCRSender] ⚠ Retry failed: {log['plate_text']} (attempt {log['retry_count'] + 1}/5)")

                    time.sleep(0.2)  # Small delay between retries

                # Wait before next batch
                time.sleep(10)

            except Exception as e:
                logging.error(f"[OCRSender] Retry loop error: {e}", exc_info=True)
                time.sleep(10)

        logging.info("[OCRSender] Retry loop stopped")

    def get_stats(self) -> dict:
        """Get sender statistics"""
        try:
            pending = len(get_unsynced_logs(limit=1000))
        except Exception:
            pending = 0

        return {
            **self.stats,
            "pending_retries": pending,
        }


# Global OCR sender instance
_ocr_sender: Optional[OCRSender] = None


def init_ocr_sender(central_url: str, device_id: str):
    """Initialize global OCR sender instance"""
    global _ocr_sender
    # Stop old sender if exists
    if _ocr_sender is not None:
        _ocr_sender.stop_retry_worker()
    _ocr_sender = OCRSender(central_url, device_id)
    logging.info(f"[OCRSender] Global instance initialized")


def reload_ocr_sender():
    """Reload OCR sender từ config file"""
    try:
        from .config import load_config
        cfg = load_config()
        target_server = cfg.get("target_server", {})
        device_id = cfg.get("device_id", "").strip()
        
        if target_server and device_id:
            central_ip = target_server.get("ip", "").strip()
            central_port = target_server.get("port", 8000)
            
            if central_ip:
                central_url = f"http://{central_ip}:{central_port}"
                init_ocr_sender(central_url, device_id)
                logging.info(f"[OCRSender] Reloaded: {central_url} (device: {device_id})")
                return True
            else:
                logging.warning("[OCRSender] Reload failed: target_server.ip is empty")
                return False
        else:
            logging.warning("[OCRSender] Reload failed: device_id or target_server missing")
            return False
    except Exception as e:
        logging.error(f"[OCRSender] Reload error: {e}")
        return False


def get_ocr_sender() -> Optional[OCRSender]:
    """Get global OCR sender instance"""
    return _ocr_sender


def send_ocr_to_central(camera_id: str, camera_name: str, plate_text: str, camera_type: Optional[str] = None, timestamp: Optional[str] = None) -> bool:
    """
    Convenience function to send OCR using global sender

    Returns:
        True if sent successfully, False if sender not initialized or send failed
    """
    if _ocr_sender is None:
        logging.warning("[OCRSender] OCR sender not initialized, skipping send")
        return False

    return _ocr_sender.send_ocr(camera_id, camera_name, plate_text, camera_type, timestamp)
