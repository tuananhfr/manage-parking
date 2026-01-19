"""
API module - FastAPI routes and models
"""
from .models import CameraCreate, CameraUpdate, CameraOut, DetectionResult, DetectionResponse
from .app import app
from .routes import set_cleanup_scheduler

__all__ = [
    "app",
    "set_cleanup_scheduler",
    "CameraCreate",
    "CameraUpdate",
    "CameraOut",
    "DetectionResult",
    "DetectionResponse",
]

