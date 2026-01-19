"""
API Models - Pydantic models for FastAPI
"""
from typing import Optional, List
from pydantic import BaseModel


class CameraCreate(BaseModel):
    id: str
    url: str
    name: Optional[str] = None
    type: str = "rtsp"  # rtsp or video
    camera_type: Optional[str] = "entrance"  # entrance, exit, internal
    enable_detection: Optional[bool] = True  # Enable AI detection (True) or stream-only mode (False)


class CameraUpdate(BaseModel):
    url: Optional[str] = None
    name: Optional[str] = None
    type: Optional[str] = None
    camera_type: Optional[str] = None
    enable_detection: Optional[bool] = None  # Enable AI detection (True) or stream-only mode (False)
    newId: Optional[str] = None  # Rename camera ID


class CameraOut(BaseModel):
    id: str
    url: str
    name: str
    type: str
    camera_type: str = "entrance"
    enable_detection: bool = True  # Enable AI detection (True) or stream-only mode (False)
    # Snapshot URL cho thumbnail (frontend-central dùng snapshot JPEG, không dùng video stream)
    snapshot_url: Optional[str] = None  # go2rtc snapshot API URL: http://localhost:1984/api/frame.jpeg?src={id}&width=640&height=360


class DetectionResult(BaseModel):
    bbox: List[int]
    confidence: float
    class_id: int
    class_name: str


class DetectionResponse(BaseModel):
    detections: List[DetectionResult]
    count: int
    processing_time_ms: float

