"""
UI Dialogs - Export all dialog classes
"""
from .camera_settings_dialog import CameraSettingsDialog, get_local_ip
from .ocr_log_dialog import OCRLogDialog

__all__ = [
    "CameraSettingsDialog",
    "OCRLogDialog",
    "get_local_ip"
]
