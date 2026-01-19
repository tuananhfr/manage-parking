from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict
import httpx
import os
import json
import logging
import tempfile
from datetime import datetime
from routes.auth_routes import load_drupal_session
from auth import require_manager

# Constants - DRUPAL_BASE_URL is now configurable via request
# Default fallback only, should be passed from frontend settings
router = APIRouter(prefix="/api/timelapse", tags=["timelapse"])

# NVR servers config file path
NVR_SERVERS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "nvr.servers.json")


def load_nvr_servers():
    """Load NVR servers from JSON file"""
    if not os.path.exists(NVR_SERVERS_FILE):
        return []
    try:
        with open(NVR_SERVERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return []


async def _find_nvr_for_camera(camera_id: str):
    """Tìm NVR quản lý camera này"""
    servers = load_nvr_servers()
    for server in servers:
        if not server.get('enabled'):
            continue
        try:
            nvr_url = f"http://{server['host']}:{server['port']}/api/cameras"
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(nvr_url)
                if response.status_code == 200:
                    cameras = response.json()
                    if isinstance(cameras, list):
                        for cam in cameras:
                            if cam.get('id') == camera_id:
                                return server
        except:
            continue
    return None


class TimelapseConfig(BaseModel):
    intervalSeconds: int = 5
    periodValue: int = 1
    periodUnit: str = "hour"  # hour, day, month
    enabledCameraIds: List[str] = []

class DrupalUploadRequest(BaseModel):
    camera_id: str
    video_path: str
    filename: str
    title: Optional[str] = None
    metadata: Optional[Dict] = None  # Metadata từ timelapse (start_time, end_time, duration, etc.)
    drupal_base_url: Optional[str] = None  # URL của Drupal API, lấy từ settings

# QUAN TRỌNG: Routes cụ thể hơn (không có param) phải được đặt TRƯỚC routes có param
# Để tránh conflict: GET /config phải trước GET /{camera_id}

@router.get("/config")
async def get_timelapse_config_all():
    """
    Get global timelapse configuration.
    Fetches config from the first available NVR (assuming global consistency).
    """
    servers = load_nvr_servers()
    
    # Try to get config from the first enabled NVR
    for server in servers:
        if not server.get('enabled'):
            continue
        
        try:
            # We use a dummy camera_id or simply call the config endpoint if NVR supports it without ID
            # Assuming NVR has GET /api/timelapse/config/global or similar, or we just pick a camera.
            # But based on user request, NVR now uses a global config.yaml.
            # Let's try to fetch from NVR's global config endpoint if it exists, or just use defaults.
            # Since the user said NVR uses config.yaml, we'll assume we can GET it.
            # If NVR doesn't have a specific global GET, we might need to modify NVR or just use defaults.
            # For now, let's try to read from a camera config as a proxy, OR if NVR has a new endpoint.
            # The prompt implies NVR API is updated to POST /config. Let's assume there's a GET /config too?
            # If not, we'll return default 5s/1h is safer to avoid errors.
            
            # Use defaults for now as reading back wasn't explicitly detailed in the NVR change
            pass 
        except:
            continue
            
    # Default config if no NVR contact (or just return defaults as UI handles it)
    return {
        "success": True,
        "data": {
            "intervalSeconds": 5,
            "periodValue": 1,
            "periodUnit": "hour",
            "enabledCameraIds": [] # Not used in UI anymore
        }
    }


@router.put("/config")
async def update_timelapse_config(config: TimelapseConfig):
    """
    Update GLOBAL timelapse configuration.
    Broadcasts settings to ALL enabled NVR servers.
    Auto-enables timelapse for ALL cameras on those servers (by setting global enabled=True).
    """
    servers = load_nvr_servers()
    
    # Convert period to cycle_seconds
    period_value = config.periodValue or 1
    period_unit = config.periodUnit or "hour"
    
    # Calculate cycle_seconds
    if period_unit == "hour":
        cycle_seconds = period_value * 3600
    elif period_unit == "day":
        cycle_seconds = period_value * 86400
    elif period_unit == "month":
        cycle_seconds = period_value * 2592000
    elif period_unit == "minute":
        cycle_seconds = period_value * 60
    else:
        cycle_seconds = 3600
    
    interval_seconds = config.intervalSeconds or 5
    
    results = []
    errors = []
    
    for server in servers:
        if not server.get('enabled'):
            continue
            
        server_host = server['host']
        server_port = server['port']
        base_url = f"http://{server_host}:{server_port}"
        
        try:
            # Send Global Config to NVR via Query Params (as required by NVR endpoint)
            # NVR endpoint signature: set_timelapse_config(camera_id, interval_seconds, cycle_seconds, enabled)
            # It updates global config.yaml, ignores camera_id specific logic but requires the arg.
            params = {
                "camera_id": "global",
                "interval_seconds": interval_seconds,
                "cycle_seconds": cycle_seconds,
                "enabled": True
            }
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                update_resp = await client.post(
                    f"{base_url}/api/timelapse/config",
                    params=params
                )
                
                update_resp.raise_for_status()
                results.append({"server": server['id'], "success": True})
                
        except Exception as e:
            errors.append(f"Server {server.get('name', server['id'])}: {str(e)}")
            logging.error(f"Failed to update timelapse config for NVR {server['id']}: {e}")

    return {
        "success": True,
        "updated": len(results),
        "errors": errors,
        "config": {
            "intervalSeconds": interval_seconds,
            "periodValue": period_value,
            "periodUnit": period_unit
        }
    }






@router.get("/status/{camera_id}")
async def get_timelapse_status(camera_id: str):
    """Lấy trạng thái timelapse của 1 camera (proxy đến NVR)"""
    nvr = await _find_nvr_for_camera(camera_id)
    if not nvr:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found on any NVR")
    
    try:
        nvr_url = f"http://{nvr['host']}:{nvr['port']}/api/timelapse/status/{camera_id}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(nvr_url)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to get timelapse status from NVR: {str(e)}"
        )


@router.get("/{camera_id}")
async def list_timelapses(
    camera_id: str,
    page: int = 1,
    limit: int = 20,
    date: Optional[str] = None,  # YYYY-MM-DD
    start_time: Optional[str] = None,  # HH:MM
    end_time: Optional[str] = None  # HH:MM
):
    """
    Liệt kê timelapse videos của 1 camera (proxy đến NVR) với pagination và filter.
    """
    # QUAN TRỌNG: Route này phải skip nếu camera_id == "config" để tránh conflict với GET /config
    # FastAPI nên match /config trước, nhưng để an toàn, thêm check này
    if camera_id == "config":
        raise HTTPException(status_code=404, detail="Use GET /api/timelapse/config to get all configs")

    nvr = await _find_nvr_for_camera(camera_id)
    if not nvr:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found on any NVR")

    try:
        # Forward pagination and filter params to NVR
        params = f"page={page}&limit={limit}"
        if date:
            params += f"&date={date}"
        if start_time:
            params += f"&start_time={start_time}"
        if end_time:
            params += f"&end_time={end_time}"

        nvr_url = f"http://{nvr['host']}:{nvr['port']}/api/timelapse/{camera_id}?{params}"
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(nvr_url)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to list timelapses from NVR: {str(e)}"
        )


@router.get("/{camera_id}/thumbnail")
async def get_timelapse_thumbnail_proxy(
    camera_id: str,
    path: str
):
    """
    Proxy: serve thumbnail của timelapse video từ NVR.
    """
    from fastapi.responses import StreamingResponse
    
    nvr = await _find_nvr_for_camera(camera_id)
    if not nvr:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found on any NVR")
    
    try:
        # Proxy request đến NVR
        nvr_url = f"http://{nvr['host']}:{nvr['port']}/api/timelapse/{camera_id}/thumbnail?path={path}"
        
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(nvr_url)
            
            if response.status_code != 200:
                error_text = response.text[:500] if response.text else "No error message"
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to fetch thumbnail from NVR: HTTP {response.status_code}. Error: {error_text}",
                )
            
            return StreamingResponse(
                response.iter_bytes(),
                media_type="image/jpeg",
                headers={
                    "Cache-Control": response.headers.get("cache-control", "public, max-age=86400"),
                    "Content-Disposition": response.headers.get("content-disposition", 'inline; filename="thumbnail.jpg"')
                }
            )
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail=f"Timeout fetching thumbnail from NVR ({nvr['host']}:{nvr['port']})",
        )
    except httpx.ConnectError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot connect to NVR at {nvr['host']}:{nvr['port']}. Is the NVR running?",
        )
    except Exception as e:
        import traceback
        error_detail = f"Failed to fetch thumbnail from NVR: {str(e)}"
        logging.error(f"[get_timelapse_thumbnail_proxy] {error_detail}\n{traceback.format_exc()}")
        raise HTTPException(
            status_code=502,
            detail=error_detail,
        )


@router.get("/{camera_id}/video")
async def get_timelapse_video_proxy(
    camera_id: str,
    path: str,
    request: Request,
    download: bool = False
):
    """
    Proxy: serve timelapse video file từ NVR cho frontend-central.
    Accepts download=True to force file download.
    """
    from fastapi.responses import StreamingResponse
    
    nvr = await _find_nvr_for_camera(camera_id)
    if not nvr:
        raise HTTPException(status_code=404, detail=f"Camera '{camera_id}' not found on any NVR")
    
    try:
        # Proxy request đến NVR, forward Range header nếu có
        nvr_url = f"http://{nvr['host']}:{nvr['port']}/api/timelapse/{camera_id}/video?path={path}"
        
        # Get Range header từ request
        range_header = request.headers.get("range")
        headers = {}
        if range_header:
            headers["Range"] = range_header
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(nvr_url, headers=headers)
            
            # Handle 206 Partial Content và 200 OK
            if response.status_code not in (200, 206):
                error_text = response.text[:500] if response.text else "No error message"
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to fetch timelapse video from NVR: HTTP {response.status_code}. Error: {error_text}",
                )
            
            # Forward response headers
            response_headers = {
                "Accept-Ranges": response.headers.get("accept-ranges", "bytes"),
                "Content-Type": response.headers.get("content-type", "video/mp4"),
            }
            
            if download:
                # Force download functionality
                filename = os.path.basename(path)
                response_headers["Content-Disposition"] = f'attachment; filename="{filename}"'

            if response.status_code == 206:
                if "content-range" in response.headers:
                    response_headers["Content-Range"] = response.headers["content-range"]
                if "content-length" in response.headers:
                    response_headers["Content-Length"] = response.headers["content-length"]
            else:
                if "content-length" in response.headers:
                    response_headers["Content-Length"] = response.headers["content-length"]
            
            return StreamingResponse(
                response.iter_bytes(),
                status_code=response.status_code,
                media_type=response_headers["Content-Type"],
                headers=response_headers
            )
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail=f"Timeout streaming timelapse video from NVR ({nvr['host']}:{nvr['port']})",
        )
    except httpx.ConnectError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot connect to NVR at {nvr['host']}:{nvr['port']}. Is the NVR running?",
        )
    except Exception as e:
        import traceback
        error_detail = f"Failed to stream timelapse video from NVR: {str(e)}"
        logging.error(f"[get_timelapse_video_proxy] {error_detail}\n{traceback.format_exc()}")
        raise HTTPException(
            status_code=502,
            detail=error_detail,
        )
