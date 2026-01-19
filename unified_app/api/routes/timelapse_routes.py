"""
Timelapse routes - Configuration, list, and serve timelapse videos
"""
import os
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from core.timelapse_manager import get_timelapse_manager

router = APIRouter(prefix="/api/timelapse", tags=["timelapse"])


from core.config import load_config, save_config

@router.post("/config")
async def set_timelapse_config(
    camera_id: str,
    interval_seconds: int,
    cycle_seconds: int,
    enabled: bool = True
):
    """
    Set timelapse configuration.
    Updates GLOBAL config in config.yaml (applies to all cameras).
    camera_id is accepted consistency but currently affects global config.
    """
    try:
        # 1. Update config.yaml directly
        config = load_config()
        if "timelapse" not in config:
            config["timelapse"] = {}
        
        config["timelapse"]["interval_seconds"] = interval_seconds
        config["timelapse"]["cycle_seconds"] = cycle_seconds
        config["timelapse"]["enabled"] = enabled
        
        save_config(config)
        
        # 2. TimelapseManager will auto-reload this within 30s
        # But we can force a quick update if needed, basically by doing nothing
        # as the manager loop handles it.
        
        return {
            "success": True,
            "camera_id": camera_id,
            "config": {
                "interval_seconds": interval_seconds,
                "cycle_seconds": cycle_seconds,
                "enabled": enabled
            },
            "message": "Global timelapse config updated in config.yaml"
        }
    except Exception as e:
        logging.error(f"[API] Failed to set timelapse config: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to set timelapse config: {e}")


@router.get("/config/{camera_id}")
async def get_timelapse_config(camera_id: str):
    """Get timelapse configuration for a camera"""
    try:
        timelapse_manager = get_timelapse_manager()
        config = timelapse_manager.get_config(camera_id)
        if not config:
            raise HTTPException(status_code=404, detail="Timelapse config not found")
        return {
            "success": True,
            "camera_id": camera_id,
            "config": config
        }
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"[API] Failed to get timelapse config: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get timelapse config: {e}")


@router.delete("/config/{camera_id}")
async def delete_timelapse_config(camera_id: str):
    """Delete timelapse configuration for a camera"""
    try:
        timelapse_manager = get_timelapse_manager()
        timelapse_manager.remove_config(camera_id)
        return {"success": True, "camera_id": camera_id}
    except Exception as e:
        logging.error(f"[API] Failed to delete timelapse config: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete timelapse config: {e}")


@router.get("/{camera_id}")
async def list_timelapses(
    camera_id: str,
    page: int = 1,
    limit: int = 20,
    date: str = None,  # YYYY-MM-DD
    start_time: str = None,  # HH:MM
    end_time: str = None  # HH:MM
):
    """List timelapse videos for a camera with pagination and filters"""
    try:
        timelapse_manager = get_timelapse_manager()
        page = max(1, page)
        limit = max(1, min(limit, 100))

        # Load timelapses (using cache if available)
        all_timelapses = timelapse_manager.list_timelapses(camera_id, use_cache=True)

        # Apply filters BEFORE pagination
        filtered_timelapses = all_timelapses

        if date or start_time or end_time:
            filtered_timelapses = []
            for tl in all_timelapses:
                tl_datetime_str = tl.get("start_time") or tl.get("created_at")

                if not tl_datetime_str:
                    continue

                try:
                    # Extract date and time from ISO string
                    if "T" in tl_datetime_str:
                        tl_date_str, tl_time_with_sec = tl_datetime_str.split("T")
                        tl_time_str = tl_time_with_sec.split(".")[0]
                    else:
                        tl_date_str = tl_datetime_str[:10]
                        tl_time_str = "00:00:00"

                    # Filter by date
                    if date and tl_date_str != date:
                        continue

                    # Filter by time range
                    if start_time or end_time:
                        tl_time = tl_time_str[:5]  # HH:MM
                        tl_h, tl_m = map(int, tl_time.split(":"))
                        tl_minutes = tl_h * 60 + tl_m

                        if start_time:
                            start_h, start_m = map(int, start_time.split(":"))
                            if tl_minutes < (start_h * 60 + start_m):
                                continue

                        if end_time:
                            end_h, end_m = map(int, end_time.split(":"))
                            if tl_minutes > (end_h * 60 + end_m):
                                continue

                    filtered_timelapses.append(tl)
                except Exception as e:
                    logging.debug(f"[API] Failed to parse datetime for timelapse: {e}")
                    continue

        # Total AFTER filtering
        total = len(filtered_timelapses)

        # Paginate
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        timelapses = filtered_timelapses[start_idx:end_idx]
        has_more = end_idx < total

        # Remove internal fields
        for tl in timelapses:
            tl.pop("_file_path", None)

        return {
            "success": True,
            "camera_id": camera_id,
            "timelapses": timelapses,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total,
                "has_more": has_more
            }
        }
    except Exception as e:
        logging.error(f"[API] Failed to list timelapses: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to list timelapses: {e}")


@router.get("/status/{camera_id}")
async def get_timelapse_status(camera_id: str):
    """Get timelapse status for a camera"""
    try:
        timelapse_manager = get_timelapse_manager()
        status = timelapse_manager.get_status(camera_id)
        return {
            "success": True,
            **status
        }
    except Exception as e:
        logging.error(f"[API] Failed to get timelapse status for {camera_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get timelapse status: {e}")


@router.get("/{camera_id}/thumbnail")
async def get_timelapse_thumbnail(camera_id: str, path: str):
    """Serve thumbnail of timelapse video"""
    try:
        timelapse_manager = get_timelapse_manager()
        base_dir = timelapse_manager.base_dir

        if ".." in path or path.startswith("/"):
            raise HTTPException(status_code=400, detail="Invalid path")

        video_path = os.path.join(base_dir, path)
        video_path = os.path.abspath(video_path)
        base_dir_abs = os.path.abspath(base_dir)

        if not video_path.startswith(base_dir_abs):
            raise HTTPException(status_code=403, detail="Access denied")

        thumbnail_path = video_path

        if not os.path.exists(thumbnail_path):
            raise HTTPException(status_code=404, detail="Thumbnail not found")

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
        logging.error(f"[API] Failed to serve timelapse thumbnail: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to serve thumbnail: {e}")


@router.get("/{camera_id}/video")
async def get_timelapse_video(camera_id: str, path: str):
    """Serve timelapse video file"""
    try:
        timelapse_manager = get_timelapse_manager()
        base_dir = timelapse_manager.base_dir

        if ".." in path or path.startswith("/"):
            raise HTTPException(status_code=400, detail="Invalid path")

        file_path = os.path.join(base_dir, path)
        file_path = os.path.abspath(file_path)
        base_dir_abs = os.path.abspath(base_dir)

        if not file_path.startswith(base_dir_abs):
            raise HTTPException(status_code=403, detail="Access denied")

        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Timelapse video not found")

        if not file_path.lower().endswith('.mp4'):
            raise HTTPException(status_code=400, detail="Only MP4 files are supported")

        return FileResponse(
            file_path,
            media_type="video/mp4",
            headers={
                "Accept-Ranges": "bytes",
                "Content-Disposition": f'inline; filename="{os.path.basename(file_path)}"'
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"[API] Failed to serve timelapse video: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to serve timelapse video: {e}")
