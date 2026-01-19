"""
Core module - config, detector, camera
"""
from .config import load_config, save_config
from .detector import get_detector, get_ocr_service, crop_plate_image
from .camera_worker import CameraWorker
from .camera_manager import camera_manager

__all__ = [
    "load_config",
    "save_config",
    "get_detector",
    "get_ocr_service",
    "crop_plate_image",
    "CameraWorker",
    "camera_manager",
]

