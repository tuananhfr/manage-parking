"""
Recorder module - Camera recording functionality
"""
from .camera_recorder import CameraRecorder
from .recorder_manager import RecorderManager, get_recorder_manager

__all__ = [
    "CameraRecorder",
    "RecorderManager",
    "get_recorder_manager"
]
