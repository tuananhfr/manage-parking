"""
Unified Camera App - Main Entry Point
"""
import os
import sys
import threading
import logging

# Suppress FFmpeg warnings (H.264 decode errors)
os.environ["OPENCV_LOG_LEVEL"] = "ERROR"
os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "quiet"

import uvicorn
from PyQt6 import QtWidgets

from api import app, set_cleanup_scheduler
from core.camera_manager import camera_manager
from core.config import load_config
from core.central_sync import CentralSyncService
from core.central_manager import central_manager
from core.ocr_sender import init_ocr_sender
from core.go2rtc_manager import init_go2rtc, stop_go2rtc, get_go2rtc_manager
from core.cleanup_scheduler import CleanupScheduler
from ui import MainWindow, FFmpegWarningFilter

# Configure logging to console and file
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("unified_app.log", encoding='utf-8')
    ]
)

# Global service instances
_sync_service = None
_cleanup_scheduler = None
_api_server = None


def start_api():
    """Start FastAPI server in background thread"""
    global _api_server
    config = uvicorn.Config(app, host="0.0.0.0", port=5000, log_level="info")
    _api_server = uvicorn.Server(config)
    _api_server.run()


def main():
    global _sync_service, _cleanup_scheduler, _api_server

    print("=" * 80, flush=True)
    print("🚀 UNIFIED APP STARTING", flush=True)
    print("=" * 80, flush=True)
    logging.info("=" * 80)
    logging.info("🚀 UNIFIED APP STARTING")
    logging.info("=" * 80)

    # Suppress FFmpeg H.264 decode warnings
    original_stderr = sys.stderr
    sys.stderr = FFmpegWarningFilter(original_stderr)

    # Load config
    cfg = load_config()

    # Start go2rtc media server (required - no fallback to direct camera)
    logging.info("[App] Starting go2rtc media server (required - unified_app always uses media server)...")
    if not init_go2rtc():
        logging.error("[App] ❌ CRITICAL: go2rtc failed to start!")
        logging.error("[App] Unified_app requires go2rtc media server to run.")
        logging.error("[App] Please ensure:")
        logging.error("[App]   1. go2rtc binary is installed and available in PATH")
        logging.error("[App]   2. go2rtc.yaml config file exists")
        logging.error("[App]   3. Ports 8554 (RTSP) and 1984 (API) are available")
        print("=" * 80, flush=True)
        print("❌ CRITICAL ERROR: go2rtc media server failed to start", flush=True)
        print("Unified_app requires go2rtc to run. Please check logs above.", flush=True)
        print("=" * 80, flush=True)
        sys.exit(1)
    
    logging.info("[App] ✅ go2rtc media server started successfully")
    logging.info("[App] Unified_app will ALWAYS use go2rtc relay URLs (no direct camera connections)")
    print("[App] ✅ go2rtc started, now syncing cameras...", flush=True)

    # Sync cameras FROM config.yaml TO go2rtc (config.yaml is SOURCE OF TRUTH)
    logging.info("[App] Syncing cameras from config.yaml to go2rtc...")
    print("[App] Syncing cameras from config.yaml to go2rtc...", flush=True)
    go2rtc_manager = get_go2rtc_manager()
    synced_count = go2rtc_manager.sync_config_to_go2rtc()
    print(f"[App] Synced {synced_count} cameras to go2rtc", flush=True)
    if synced_count > 0:
        logging.info(f"[App] ✅ Synced {synced_count} cameras to go2rtc")
    else:
        logging.info("[App] No cameras to sync (config.yaml is empty)")

    print("🎬 About to call auto_start_all...", flush=True)
    logging.info("🎬 About to call auto_start_all...")

    # Auto-start all cameras (20 FPS for smooth video stream)
    camera_manager.auto_start_all(fps=20.0)

    print("✅ auto_start_all completed", flush=True)
    logging.info("✅ auto_start_all completed")

    # Initialize OCR Sender (using target_server from config)
    target_server = cfg.get("target_server", {})
    device_id = cfg.get("device_id", "").strip()

    if target_server and device_id:
        central_ip = target_server.get("ip", "").strip()
        central_port = target_server.get("port", 8000)

        if central_ip:
            central_url = f"http://{central_ip}:{central_port}"
            init_ocr_sender(central_url, device_id)
            logging.info(f"[App] OCR sender initialized: {central_url} (device: {device_id})")
        else:
            logging.warning("[App] OCR sender not initialized: target_server.ip is empty")
    else:
        logging.warning("[App] OCR sender not initialized: device_id or target_server missing")

    # Init central sync service via Manager (singleton)
    central_manager.start()

    # Start Cleanup Scheduler
    _cleanup_scheduler = CleanupScheduler(config_path="config.yaml")
    _cleanup_scheduler.start()
    logging.info("[App] Cleanup scheduler started")

    # Set cleanup scheduler in API routes (for manual trigger endpoint)
    set_cleanup_scheduler(_cleanup_scheduler)

    # Start API server in background (non-daemon for graceful shutdown)
    api_thread = threading.Thread(target=start_api, daemon=False)
    api_thread.start()

    # Start PyQt6 UI
    qt_app = QtWidgets.QApplication(sys.argv)
    win = MainWindow()
    win.show()

    # Cleanup on exit
    try:
        sys.exit(qt_app.exec())
    finally:
        logging.info("[App] Shutting down gracefully...")

        # Stop sync service
        try:
            logging.info("[App] Stopping central sync service...")
            central_manager.stop()
        except:
            pass

        # Stop cleanup scheduler
        if _cleanup_scheduler:
            logging.info("[App] Stopping cleanup scheduler...")
            _cleanup_scheduler.stop()

        # Stop API server gracefully
        if _api_server:
            logging.info("[App] Stopping API server...")
            _api_server.should_exit = True

        # Wait for API thread to finish (with timeout)
        if api_thread and api_thread.is_alive():
            logging.info("[App] Waiting for API thread to finish...")
            api_thread.join(timeout=5)
            if api_thread.is_alive():
                logging.warning("[App] API thread did not stop within 5 seconds")
            else:
                logging.info("[App] API thread stopped successfully")

        # Stop go2rtc
        logging.info("[App] Stopping go2rtc...")
        stop_go2rtc()

        logging.info("[App] Shutdown complete")


if __name__ == "__main__":
    main()

