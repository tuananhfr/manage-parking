import logging
import threading
from typing import Optional
from core.central_sync import CentralSyncService
from core.config import load_config

class CentralManager:
    """Singleton Manager for Central Sync Service"""
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(CentralManager, cls).__new__(cls)
                cls._instance._service = None
        return cls._instance

    def start(self):
        """Start or restart the sync service based on current config"""
        self.reload_config()

    def stop(self):
        """Stop the sync service"""
        if self._service:
            self._service.stop()
            self._service = None

    def reload_config(self):
        """Reload config and restart service if enabled"""
        try:
            cfg = load_config()
            central_cfg = cfg.get("central", {})
            enabled = central_cfg.get("enabled", False)
            central_url = central_cfg.get("url", "")
            
            # Always sync device_id
            sync_device_id = central_cfg.get("device_id") or cfg.get("device_id")

            # Validate basic requirements
            if not enabled or not central_url or not sync_device_id:
                if self._service:
                    logging.info("[CentralManager] Stopping sync service (disabled or missing config)")
                    self.stop()
                return

            if self._service:
                logging.info("[CentralManager] Restarting sync service with new config...")
                self.stop()
            
            # Start new service
            logging.info(f"[CentralManager] Starting sync service -> {central_url}")
            self._service = CentralSyncService(
                central_url=central_url,
                device_id=sync_device_id
            )
            self._service.start()

        except Exception as e:
            logging.error(f"[CentralManager] Failed to reload config: {e}")

# Global instance
central_manager = CentralManager()
