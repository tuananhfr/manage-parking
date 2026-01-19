"""
RecorderManager - Manage multiple camera recorders
"""
import os
import threading
import logging
from typing import Dict, List, Optional

from .camera_recorder import CameraRecorder
from ..config import load_config


class RecorderManager:
    """
    Manager cho tất cả camera recorders.
    Mỗi camera có 1 CameraRecorder riêng biệt.
    """

    def __init__(self, base_dir: str = "recordings"):
        self.base_dir = base_dir
        os.makedirs(base_dir, exist_ok=True)

        # Dict of recorders: {camera_id: CameraRecorder}
        self.recorders: Dict[str, CameraRecorder] = {}
        self.lock = threading.Lock()

        logging.info(f"[RecorderManager] Initialized with base_dir: {base_dir}")

    def start_recorder(self, camera_id: str):
        """Start continuous recording for a camera"""
        with self.lock:
            if camera_id in self.recorders:
                recorder = self.recorders[camera_id]
                if recorder.running:
                    logging.warning(f"[RecorderManager] Recorder for {camera_id} already running")
                    return

            # Read segment_seconds from config.yaml
            try:
                cfg = load_config()
                recording_config = cfg.get("recording", {})
                segment_seconds = recording_config.get("segment_seconds", 300)  # Default 5 minutes
            except Exception as e:
                logging.warning(f"[RecorderManager] Failed to read config, using default segment_seconds=300: {e}")
                segment_seconds = 300

            # Create new recorder with config value
            recorder = CameraRecorder(
                camera_id=camera_id,
                base_dir=self.base_dir,
                segment_seconds=segment_seconds
            )
            self.recorders[camera_id] = recorder

            # Start in background thread
            recorder.start()
            logging.info(f"[RecorderManager] Started recorder for {camera_id} (segment={segment_seconds}s)")

    def stop_recorder(self, camera_id: str):
        """Stop recording for a camera"""
        with self.lock:
            if camera_id not in self.recorders:
                logging.warning(f"[RecorderManager] No recorder found for {camera_id}")
                return

            recorder = self.recorders[camera_id]
            recorder.stop()
            logging.info(f"[RecorderManager] Stopped recorder for {camera_id}")

    def stop_all(self):
        """Stop all recorders"""
        with self.lock:
            for camera_id, recorder in list(self.recorders.items()):
                recorder.stop()
            logging.info("[RecorderManager] Stopped all recorders")

    def get_status(self, camera_id: str) -> dict:
        """Get recorder status for a camera"""
        with self.lock:
            if camera_id not in self.recorders:
                return {
                    "camera_id": camera_id,
                    "is_recording": False,
                    "has_files": False,
                    "last_error": "No recorder instance"
                }

            recorder = self.recorders[camera_id]
            is_recording = recorder.running and recorder.process and recorder.process.poll() is None

            # Check if has any files
            camera_dir = os.path.join(self.base_dir, camera_id)
            has_files = os.path.exists(camera_dir) and len(os.listdir(camera_dir)) > 0

            return {
                "camera_id": camera_id,
                "is_recording": is_recording,
                "has_files": has_files,
                "last_error": recorder.last_error or None
            }

    def list_recordings(self, camera_id: str) -> List[dict]:
        """
        List all recordings for a camera.
        Returns recordings sorted by date (oldest first).
        
        Only returns FULLY PROCESSED recordings:
        1. Must be in subfolder (YYYYMMDD_HHMMSS/)
        2. Must have thumbnail (indicates processing complete)
        """
        import json
        
        recordings = []
        camera_dir = os.path.join(self.base_dir, camera_id)

        if not os.path.exists(camera_dir):
            return recordings

        # Iterate through date folders (YYYYMMDD)
        for date_folder in sorted(os.listdir(camera_dir)):
            date_path = os.path.join(camera_dir, date_folder)
            if not os.path.isdir(date_path):
                continue

            # Case: Iterate through session FOLDERS (YYYYMMDD_HHMMSS/)
            for item in sorted(os.listdir(date_path)):
                item_path = os.path.join(date_path, item)
                
                # Must be a directory
                if not os.path.isdir(item_path):
                    continue
                    
                session_folder = item
                session_path = item_path
                
                # Look for video file inside folder
                video_file = os.path.join(session_path, f"{session_folder}.mp4")
                if not os.path.exists(video_file):
                    continue

                # STRICT CHECK: Must have thumbnail to be considered "ready"
                thumb_path = os.path.join(session_path, f"{session_folder}_thumb.jpg")
                if not os.path.exists(thumb_path):
                    continue  # Skip incomplete recordings

                # Read metadata if exists
                metadata_file = os.path.join(session_path, "metadata.json")
                metadata = {}
                if os.path.exists(metadata_file):
                    try:
                        with open(metadata_file, 'r') as f:
                            metadata = json.load(f)
                    except:
                        pass
                
                # Retrieve basic metadata if needed (fallback)
                if not metadata:
                    metadata = self._generate_basic_metadata(video_file, session_folder)

                # Format fields
                size_bytes = metadata.get("size_bytes")
                size_mb = round(size_bytes / 1024 / 1024, 2) if size_bytes else metadata.get("size_mb")

                # Build recording info
                recordings.append({
                    "path": os.path.join(camera_id, date_folder, session_folder, f"{session_folder}.mp4"),
                    "start": metadata.get("start_time") or metadata.get("start"),
                    "end": metadata.get("end"),
                    "duration": metadata.get("duration_sec") or metadata.get("duration"),
                    "size_mb": size_mb,
                    "is_processing": False, # Guaranteed fully processed
                    "_file_path": video_file
                })

        return recordings
    
    def _generate_basic_metadata(self, video_file: str, session_name: str) -> dict:
        """
        Generate basic metadata from filename and file stat when metadata.json doesn't exist.
        
        Args:
            video_file: Path to video file
            session_name: Session name (YYYYMMDD_HHMMSS format)
        
        Returns:
            Dict with basic metadata (start_time, size_bytes)
        """
        from datetime import datetime
        
        metadata = {}
        
        # Parse start time from session name (YYYYMMDD_HHMMSS)
        try:
            start_dt = datetime.strptime(session_name, "%Y%m%d_%H%M%S")
            metadata["start_time"] = start_dt.isoformat()
            metadata["start"] = start_dt.strftime("%Y-%m-%dT%H:%M:%S")
        except:
            pass
        
        # Get file size
        try:
            stat = os.stat(video_file)
            metadata["size_bytes"] = stat.st_size
            metadata["size_mb"] = round(stat.st_size / 1024 / 1024, 2)
        except:
            pass
        
        return metadata


# Global instance
_recorder_manager_instance: Optional[RecorderManager] = None
_recorder_manager_lock = threading.Lock()


def get_recorder_manager() -> RecorderManager:
    """Get or create recorder manager singleton"""
    global _recorder_manager_instance
    with _recorder_manager_lock:
        if _recorder_manager_instance is None:
            _recorder_manager_instance = RecorderManager()
        return _recorder_manager_instance
