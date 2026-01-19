"""
Camera management routes - CRUD operations, detection control, and preview
"""
import time
import cv2
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import List

from ..models import CameraOut, CameraCreate, CameraUpdate
from core.camera_manager import camera_manager

# Resource limits
MAX_CAMERAS = 10

router = APIRouter(prefix="/api", tags=["cameras"])


@router.get("/cameras", response_model=List[CameraOut])
async def get_cameras(include_videos: bool = False):
    """
    List cameras.
    By default, excludes 'video' type inputs (which are for backend analysis only).
    """
    cameras = camera_manager.list_cameras()
    if not include_videos:
        cameras = [c for c in cameras if c.type != "video"]
    return cameras


@router.get("/cameras/{camera_id}/snapshot")
async def get_camera_snapshot_url(camera_id: str):
    """Get snapshot URL for camera (for thumbnail usage by other services)"""
    cameras = camera_manager.list_cameras()
    camera = next((cam for cam in cameras if cam.id == camera_id), None)

    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    if camera.snapshot_url:
        return {
            "camera_id": camera_id,
            "snapshot_url": camera.snapshot_url,
            "snapshot_api_base": "http://localhost:1984/api/frame.jpeg"
        }
    else:
        raise HTTPException(
            status_code=503,
            detail="Snapshot URL not available (go2rtc may not be running)"
        )


@router.get("/cameras/snapshots")
async def get_all_snapshot_urls():
    """Get all snapshot URLs for all cameras"""
    cameras = camera_manager.list_cameras()
    result = []

    for camera in cameras:
        if camera.snapshot_url:
            result.append({
                "camera_id": camera.id,
                "camera_name": camera.name,
                "snapshot_url": camera.snapshot_url
            })

    return {
        "success": True,
        "snapshots": result,
        "snapshot_api_base": "http://localhost:1984/api/frame.jpeg"
    }


@router.post("/rtsp-cameras", response_model=CameraOut)
@router.post("/rtsp-cameras/", response_model=CameraOut, include_in_schema=False)
@router.post("/cameras", response_model=CameraOut, include_in_schema=False)
@router.post("/cameras/", response_model=CameraOut, include_in_schema=False)
async def add_camera(cam: CameraCreate):
    """Add new camera"""
    if len(camera_manager.list_cameras()) >= MAX_CAMERAS:
        raise HTTPException(
            status_code=429,
            detail=f"Maximum number of cameras ({MAX_CAMERAS}) reached"
        )

    camera_manager.add_camera(cam)
    return {"success": True}


@router.put("/cameras/{camera_id}")
async def update_camera(camera_id: str, cam: CameraUpdate):
    """Update camera configuration"""
    camera_manager.update_camera(camera_id, cam)
    return {"success": True}


@router.delete("/cameras/{camera_id}")
async def delete_camera(camera_id: str):
    """Delete camera"""
    camera_manager.remove_camera(camera_id)
    return {"success": True}


@router.post("/detection/start/{camera_id}")
async def start_detection(camera_id: str, fps: float = 5.0):
    """Start detection for camera"""
    camera_manager.start_detection(camera_id, fps=fps)
    return {"success": True}


@router.post("/detection/stop/{camera_id}")
async def stop_detection(camera_id: str):
    """Stop detection for camera"""
    camera_manager.stop_detection(camera_id)
    return {"success": True}


@router.get("/detection/stats")
async def detection_stats():
    """Get detection statistics"""
    return camera_manager.get_stats()


@router.get("/preview/{camera_id}")
async def preview_mjpeg(camera_id: str):
    """Stream MJPEG preview for camera"""
    frame, _ = camera_manager.get_frame(camera_id)
    if frame is None:
        raise HTTPException(
            status_code=404,
            detail="No frame yet or camera not running"
        )

    def gen():
        while True:
            frame, _ = camera_manager.get_frame(camera_id)
            if frame is None:
                time.sleep(0.1)
                continue
            ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if not ok:
                continue
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n"
            )
            time.sleep(0.2)  # ~5 fps

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")
