"""
Recording routes - List, download, and serve recording videos/thumbnails/previews
"""
import os
import logging
from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import FileResponse

from core.recorder_manager import get_recorder_manager

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


@router.get("")
async def list_recordings(
    camera_id: str,
    page: int = 1,
    limit: int = 20,
    date: str = None,  # YYYY-MM-DD
    start_time: str = None,  # HH:MM
    end_time: str = None  # HH:MM
):
    """
    List recordings for a camera with pagination and filters
    """
    try:
        recorder_manager = get_recorder_manager()

        # Validate pagination params
        page = max(1, page)
        limit = max(1, min(limit, 100))

        # Get all recordings
        all_recordings = recorder_manager.list_recordings(camera_id)

        # Apply filters
        if date or start_time or end_time:
            filtered = []
            for rec in all_recordings:
                if not rec.get("start"):
                    continue

                try:
                    rec_date_str, rec_time_str = rec["start"].split("T")

                    # Filter by date
                    if date and rec_date_str != date:
                        continue

                    # Filter by time range
                    if start_time or end_time:
                        rec_time = rec_time_str[:5]  # HH:MM
                        rec_h, rec_m = map(int, rec_time.split(":"))
                        rec_minutes = rec_h * 60 + rec_m

                        if start_time:
                            start_h, start_m = map(int, start_time.split(":"))
                            if rec_minutes < (start_h * 60 + start_m):
                                continue

                        if end_time:
                            end_h, end_m = map(int, end_time.split(":"))
                            if rec_minutes > (end_h * 60 + end_m):
                                continue

                    filtered.append(rec)
                except Exception:
                    continue

            all_recordings = filtered

        # Reverse to show newest first
        all_recordings = list(reversed(all_recordings))

        total = len(all_recordings)

        # Paginate
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        recordings = all_recordings[start_idx:end_idx]
        has_more = end_idx < total

        # Remove internal fields
        for rec in recordings:
            rec.pop("_file_path", None)

        # Check recorder status
        recorder = recorder_manager.recorders.get(camera_id)
        is_recording = False
        reason = "no_recorder"
        if recorder:
            is_recording = recorder.running and recorder.process and recorder.process.poll() is None
            if is_recording:
                reason = "running"
            elif recorder.running:
                reason = "process_exited"
            else:
                reason = "stopped"

        return {
            "success": True,
            "camera_id": camera_id,
            "recordings": recordings,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "has_more": has_more
            },
            "is_recording": is_recording,
            "reason": reason,
        }
    except Exception as e:
        logging.error(f"[API] Failed to list recordings for {camera_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list recordings: {e}")


@router.get("/status")
async def recordings_status(camera_id: str):
    """Get recorder status for a camera"""
    try:
        recorder_manager = get_recorder_manager()
        status = recorder_manager.get_status(camera_id)
        return {
            "success": True,
            **status,
        }
    except Exception as e:
        logging.error(f"[API] Failed to get recording status for {camera_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get recording status: {e}")


@router.get("/{camera_id}/video")
async def get_recording_video(
    camera_id: str,
    path: str,
    range: str = Header(None)
):
    """
    Serve video file with range request support (for seeking)
    """
    try:
        recorder_manager = get_recorder_manager()
        base_dir = recorder_manager.base_dir

        # Security checks
        if ".." in path or path.startswith("/"):
            raise HTTPException(status_code=400, detail="Invalid path")

        file_path = os.path.join(base_dir, path)
        file_path = os.path.abspath(file_path)
        base_dir_abs = os.path.abspath(base_dir)

        if not file_path.startswith(base_dir_abs):
            raise HTTPException(status_code=403, detail="Access denied")

        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Video file not found")

        if not file_path.lower().endswith('.mp4'):
            raise HTTPException(status_code=400, detail="Only MP4 files are supported")

        file_size = os.path.getsize(file_path)

        headers = {
            "Accept-Ranges": "bytes",
            "Content-Disposition": f'inline; filename="{os.path.basename(file_path)}"',
            "Content-Length": str(file_size),
        }

        return FileResponse(
            file_path,
            media_type="video/mp4",
            headers=headers
        )
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"[API] Failed to serve video for {camera_id}/{path}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to serve video: {e}")


@router.get("/{camera_id}/thumbnail")
async def get_recording_thumbnail(camera_id: str, path: str):
    """Serve thumbnail (first frame) of recording video"""
    try:
        recorder_manager = get_recorder_manager()
        base_dir = recorder_manager.base_dir

        if ".." in path or path.startswith("/"):
            raise HTTPException(status_code=400, detail="Invalid path")

        video_path = os.path.join(base_dir, path)
        video_path = os.path.abspath(video_path)
        base_dir_abs = os.path.abspath(base_dir)

        if not video_path.startswith(base_dir_abs):
            raise HTTPException(status_code=403, detail="Access denied")

        if not video_path.lower().endswith('.mp4'):
            raise HTTPException(status_code=400, detail="Only MP4 files are supported")

        # Find thumbnail in same folder
        video_dir = os.path.dirname(video_path)
        video_basename = os.path.basename(video_path)
        name_without_ext = os.path.splitext(video_basename)[0]
        thumbnail_path = os.path.join(video_dir, f"{name_without_ext}_thumb.jpg")

        if not os.path.exists(thumbnail_path):
            raise HTTPException(status_code=404, detail="Thumbnail not found (may be generating)")

        return FileResponse(
            thumbnail_path,
            media_type="image/jpeg",
            headers={
                "Cache-Control": "public, max-age=86400",
                "Content-Disposition": f'inline; filename="{os.path.basename(thumbnail_path)}"'
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"[API] Failed to serve thumbnail for {camera_id}/{path}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to serve thumbnail: {e}")


@router.get("/{camera_id}/preview")
async def get_recording_preview(camera_id: str, path: str):
    """Serve timelapse preview video of recording"""
    try:
        recorder_manager = get_recorder_manager()
        base_dir = recorder_manager.base_dir

        if ".." in path or path.startswith("/"):
            raise HTTPException(status_code=400, detail="Invalid path")

        video_path = os.path.join(base_dir, path)
        video_path = os.path.abspath(video_path)
        base_dir_abs = os.path.abspath(base_dir)

        if not video_path.startswith(base_dir_abs):
            raise HTTPException(status_code=403, detail="Access denied")

        if not video_path.lower().endswith('.mp4'):
            raise HTTPException(status_code=400, detail="Only MP4 files are supported")

        # Find timelapse video in same folder
        video_dir = os.path.dirname(video_path)
        video_basename = os.path.basename(video_path)
        name_without_ext = os.path.splitext(video_basename)[0]
        timelapse_path = os.path.join(video_dir, f"{name_without_ext}_timelapse.mp4")

        if not os.path.exists(timelapse_path):
            raise HTTPException(status_code=404, detail="Timelapse preview not found (may be generating)")

        file_size = os.path.getsize(timelapse_path)

        return FileResponse(
            timelapse_path,
            media_type="video/mp4",
            headers={
                "Accept-Ranges": "bytes",
                "Content-Disposition": f'inline; filename="{os.path.basename(timelapse_path)}"',
                "Content-Length": str(file_size),
                "Cache-Control": "public, max-age=3600",
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"[API] Failed to serve preview for {camera_id}/{path}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to serve preview: {e}")
