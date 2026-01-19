"""
Video processing routes - Upload and process video files for license plate detection
"""
import os
import time
import cv2
from datetime import datetime
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from typing import Dict

from core.video_worker import VideoSourceWorker

# Resource limits
MAX_VIDEO_JOBS = 3

# Upload directory
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Storage for video processing jobs
video_workers: Dict[str, VideoSourceWorker] = {}

router = APIRouter(prefix="/api/video", tags=["video"])


@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload MP4/AVI video file for processing"""
    # Check resource limits
    active_videos = sum(1 for w in video_workers.values() if w.running)
    if active_videos >= MAX_VIDEO_JOBS:
        raise HTTPException(
            status_code=429,
            detail=f"Maximum number of video jobs ({MAX_VIDEO_JOBS}) reached"
        )

    # Validate file type
    if not file.filename.lower().endswith(('.mp4', '.avi', '.mov', '.mkv')):
        raise HTTPException(
            status_code=400,
            detail="Only video files (MP4, AVI, MOV, MKV) are allowed"
        )

    # Generate unique video ID
    timestamp = int(datetime.now().timestamp() * 1000)
    video_id = f"video_{timestamp}"

    # Save uploaded file
    file_ext = os.path.splitext(file.filename)[1]
    video_path = os.path.join(UPLOAD_DIR, f"{video_id}{file_ext}")

    with open(video_path, "wb") as f:
        content = await file.read()
        f.write(content)

    # Create video worker
    worker = VideoSourceWorker(
        video_id=video_id,
        video_path=video_path,
        target_fps=5.0,
        vid_stride=3
    )

    # Store worker
    video_workers[video_id] = worker

    # Start processing
    worker.start()

    return {
        "success": True,
        "video_id": video_id,
        "filename": file.filename,
        "message": "Video uploaded and processing started"
    }


@router.get("/list")
async def list_videos():
    """List all video processing jobs"""
    jobs = []
    for video_id, worker in video_workers.items():
        stats = worker.get_stats()
        jobs.append({
            "video_id": video_id,
            "is_running": worker.running,
            "is_completed": worker.is_completed,
            "progress": stats.get("progress", 0),
            "detected_plates": stats.get("detected_plates_count", 0),
            "total_frames": worker.total_frames,
            "current_frame": worker.current_frame_idx,
        })
    return {"success": True, "jobs": jobs}


@router.get("/stats/{video_id}")
async def get_video_stats(video_id: str):
    """Get processing statistics for a video"""
    if video_id not in video_workers:
        raise HTTPException(status_code=404, detail="Video job not found")

    worker = video_workers[video_id]
    stats = worker.get_stats()

    return {
        "success": True,
        "video_id": video_id,
        "stats": stats,
        "is_running": worker.running,
        "is_completed": worker.is_completed,
    }


@router.get("/results/{video_id}")
async def get_video_results(video_id: str):
    """Get all detected plates from video processing"""
    if video_id not in video_workers:
        raise HTTPException(status_code=404, detail="Video job not found")

    worker = video_workers[video_id]
    results = worker.get_results()

    return {
        "success": True,
        "video_id": video_id,
        "detected_plates": results,
        "total": len(results),
        "is_completed": worker.is_completed,
    }


@router.get("/preview/{video_id}")
async def preview_video_mjpeg(video_id: str):
    """Stream processed video frames with detections (MJPEG)"""
    if video_id not in video_workers:
        raise HTTPException(status_code=404, detail="Video job not found")

    worker = video_workers[video_id]

    def gen():
        while worker.running or not worker.is_completed:
            frame, _ = worker.get_frame()
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
            time.sleep(0.1)  # ~10 fps preview

        # Show final frame when completed
        if worker.is_completed:
            frame, _ = worker.get_frame()
            if frame is not None:
                ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                if ok:
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n"
                    )

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")


@router.post("/stop/{video_id}")
async def stop_video_processing(video_id: str):
    """Stop video processing"""
    if video_id not in video_workers:
        raise HTTPException(status_code=404, detail="Video job not found")

    worker = video_workers[video_id]
    worker.stop()

    return {"success": True, "message": "Video processing stopped"}


@router.delete("/{video_id}")
async def delete_video(video_id: str):
    """Delete video processing job and file"""
    if video_id not in video_workers:
        raise HTTPException(status_code=404, detail="Video job not found")

    worker = video_workers[video_id]

    # Stop processing if running
    if worker.running:
        worker.stop()

    # Delete video file
    if os.path.exists(worker.video_path):
        try:
            os.remove(worker.video_path)
        except Exception as e:
            print(f"Failed to delete video file: {e}")

    # Remove from workers dict
    del video_workers[video_id]

    return {"success": True, "message": "Video job deleted"}
