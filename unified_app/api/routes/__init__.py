"""
Routes module - Export all API routers
"""
from .camera_routes import router as camera_router
from .recording_routes import router as recording_router
from .video_routes import router as video_router
from .timelapse_routes import router as timelapse_router
from .cleanup_routes import router as cleanup_router, set_cleanup_scheduler
from .config_routes import router as config_router

__all__ = [
    "camera_router",
    "recording_router",
    "video_router",
    "timelapse_router",
    "cleanup_router",
    "config_router",
    "set_cleanup_scheduler"
]
