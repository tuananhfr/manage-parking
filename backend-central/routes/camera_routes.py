from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict
import httpx
import os
import json
import logging
import sys

# Add parent directory to path to import auth
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from auth import get_current_user, require_manager

router = APIRouter(prefix="/api/rtsp-cameras", tags=["rtsp-cameras"])

# NVR servers config file path
NVR_SERVERS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "nvr.servers.json")

# Camera order storage file (central là nơi QUYẾT ĐỊNH order)
CAMERA_ORDER_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "camera_order.json")


def load_camera_orders() -> Dict[str, int]:
    """Load camera order map from JSON file (key = "nvr_id::camera_id")"""
    if not os.path.exists(CAMERA_ORDER_FILE):
        return {}
    try:
        with open(CAMERA_ORDER_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                # Đảm bảo value là int
                return {str(k): int(v) for k, v in data.items()}
    except Exception:
        pass
    return {}


def save_camera_orders(order_map: Dict[str, int]) -> None:
    """Save camera order map to JSON file"""
    try:
        with open(CAMERA_ORDER_FILE, "w", encoding="utf-8") as f:
            json.dump(order_map, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving camera orders: {e}")

class Camera(BaseModel):
    id: str
    name: str
    type: str
    url: str
    hasAudio: bool = False
    nvr_id: Optional[str] = None  # Which NVR server manages this camera
    # Fields cần forward đến NVR
    camera_type: Optional[str] = None  # entrance, exit, internal
    enable_detection: Optional[bool] = None  # Enable AI detection

class CameraUpdate(BaseModel):
    url: Optional[str] = None
    name: Optional[str] = None
    type: Optional[str] = None
    camera_type: Optional[str] = None
    newId: Optional[str] = None
    order: Optional[int] = None
    enable_detection: Optional[bool] = None  # Enable AI detection


def load_nvr_servers():
    """Load NVR servers from JSON file"""
    if not os.path.exists(NVR_SERVERS_FILE):
        return []
    
    try:
        with open(NVR_SERVERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return []


async def _find_nvr_for_camera(camera_id: str) -> Optional[Dict]:
    """Find which NVR server manages a specific camera"""
    servers = load_nvr_servers()
    
    for server in servers:
        if not server.get('enabled'):
            continue
        
        try:
            # Query NVR API to get its cameras
            nvr_url = f"http://{server['host']}:{server['port']}/api/cameras"
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(nvr_url)
                if response.status_code == 200:
                    cameras = response.json()
                    if isinstance(cameras, list):
                        # Check if camera_id exists in this NVR's cameras
                        if any(cam.get('id') == camera_id for cam in cameras):
                            return server
        except:
            continue
    
    return None


@router.get("/")
async def get_cameras():
    """Get all cameras from all NVR servers (Public endpoint - no auth required)

    Central là nguồn quản lý order, nên ở đây sẽ merge cameras + order.
    """
    servers = load_nvr_servers()
    all_cameras = []
    
    for server in servers:
        if not server.get('enabled'):
            continue
        
        try:
            # Get cameras from this NVR
            nvr_url = f"http://{server['host']}:{server['port']}/api/cameras"
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(nvr_url)
                if response.status_code == 200:
                    cameras = response.json()
                    if isinstance(cameras, list):
                        # Add NVR info to each camera
                        for cam in cameras:
                            cam['nvr_id'] = server['id']
                            cam['nvr_name'] = server['name']
                            # Use go2rtc_url from config, fallback to auto-generate from host
                            go2rtc_url = server.get('go2rtc_url') or f"http://{server['host']}:1984"
                            cam['go2rtc_url'] = go2rtc_url
                            # Fix snapshot_url: replace localhost with actual go2rtc_url
                            if cam.get('snapshot_url'):
                                snapshot_url = cam['snapshot_url']
                                if 'localhost:1984' in snapshot_url or '127.0.0.1:1984' in snapshot_url:
                                    cam['snapshot_url'] = snapshot_url.replace('http://localhost:1984', go2rtc_url).replace('http://127.0.0.1:1984', go2rtc_url)
                            else:
                                # If snapshot_url doesn't exist, create from go2rtc_url and camera_id
                                # Use raw stream, go2rtc will decode and resize to 640x360
                                cam['snapshot_url'] = f"{go2rtc_url}/api/frame.jpeg?src={cam.get('id', '')}&width=640&height=360"
                        all_cameras.extend(cameras)
        except Exception as e:
            print(f"Error fetching cameras from NVR {server['id']}: {e}")
            continue
    
    # Load order map từ file trung tâm
    order_map = load_camera_orders()
    
    # Gắn order vào từng camera (key = "nvr_id::camera_id")
    for cam in all_cameras:
        key = f"{cam.get('nvr_id', '')}::{cam.get('id', '')}"
        if key in order_map:
            cam['order'] = order_map[key]
    
    # Sort theo order (thiếu order -> 999), rồi theo id để ổn định
    all_cameras.sort(
        key=lambda c: (
            c.get('order') if c.get('order') is not None else 999,
            str(c.get('id', '')),
        )
    )
    
    return all_cameras


@router.get("/recordings")
async def get_recordings(
    nvr_id: str,
    camera_id: str,
    page: int = 1,
    limit: int = 20,
    date: Optional[str] = None,  # YYYY-MM-DD
    start_time: Optional[str] = None,  # HH:MM
    end_time: Optional[str] = None  # HH:MM
):
    """
    Proxy: lấy recordings từ 1 NVR cho 1 camera với filter support

    unified_app (NVR) endpoint: GET /api/recordings?camera_id=...
    """
    servers = load_nvr_servers()
    nvr = next((s for s in servers if s.get('id') == nvr_id and s.get('enabled')), None)
    if not nvr:
        raise HTTPException(status_code=404, detail=f"NVR server '{nvr_id}' not found or disabled")

    try:
        # Forward pagination and filter params to NVR
        # Timeout dài hơn vì cần đọc duration từ video files (có thể chậm với nhiều files)
        params = f"camera_id={camera_id}&page={page}&limit={limit}"
        if date:
            params += f"&date={date}"
        if start_time:
            params += f"&start_time={start_time}"
        if end_time:
            params += f"&end_time={end_time}"

        nvr_url = f"http://{nvr['host']}:{nvr['port']}/api/recordings?{params}"
        async with httpx.AsyncClient(timeout=60.0) as client:  # Tăng timeout lên 60s
            response = await client.get(nvr_url)
            
            # Log response để debug
            if response.status_code != 200:
                error_text = response.text[:500] if response.text else "No error message"
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to fetch recordings from NVR '{nvr_id}': HTTP {response.status_code}. Error: {error_text}",
                )
            
            # Parse JSON response
            try:
                data = response.json()
            except Exception as json_err:
                raise HTTPException(
                    status_code=502,
                    detail=f"Invalid JSON response from NVR '{nvr_id}': {str(json_err)}. Response: {response.text[:200]}",
                )
            
            # Validate response structure
            if not isinstance(data, dict):
                raise HTTPException(
                    status_code=502,
                    detail=f"Invalid response format from NVR '{nvr_id}': expected dict, got {type(data).__name__}",
                )
            
            # Extract recordings list (có thể là list hoặc None)
            recordings_list = data.get("recordings", [])
            if not isinstance(recordings_list, list):
                recordings_list = []
        
        # Forward pagination info from NVR response
        pagination = data.get("pagination", {})
        
        return {
            "success": True,
            "nvr_id": nvr_id,
            "nvr_name": nvr.get("name"),
            "camera_id": camera_id,
            "recordings": recordings_list,
            "pagination": pagination,
        }
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail=f"Timeout connecting to NVR '{nvr_id}' ({nvr['host']}:{nvr['port']})",
        )
    except httpx.ConnectError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot connect to NVR '{nvr_id}' at {nvr['host']}:{nvr['port']}. Is the NVR running?",
        )
    except Exception as e:
        import traceback
        error_detail = f"Failed to fetch recordings from NVR '{nvr_id}': {str(e)}"
        logging.error(f"[get_recordings] {error_detail}\n{traceback.format_exc()}")
        raise HTTPException(
            status_code=502,
            detail=error_detail,
        )


@router.get("/recordings/{camera_id}/video")
async def get_recording_video_proxy(
    nvr_id: str, 
    camera_id: str, 
    path: str,
    request: Request,
    download: bool = False
):
    """
    Proxy: serve video file từ NVR cho frontend-central với hỗ trợ range requests.
    
    unified_app (NVR) endpoint: GET /api/recordings/{camera_id}/video?path=...
    Accepts download=True to force file download.
    """
    from fastapi.responses import StreamingResponse
    
    servers = load_nvr_servers()
    nvr = next((s for s in servers if s.get('id') == nvr_id and s.get('enabled')), None)
    if not nvr:
        raise HTTPException(status_code=404, detail=f"NVR server '{nvr_id}' not found or disabled")
    
    try:
        # Proxy request đến NVR, forward Range header nếu có
        nvr_url = f"http://{nvr['host']}:{nvr['port']}/api/recordings/{camera_id}/video?path={path}"
        
        # Get Range header từ request
        range_header = request.headers.get("range")
        headers = {}
        if range_header:
            headers["Range"] = range_header
        
        async with httpx.AsyncClient(timeout=60.0) as client:  # Timeout dài hơn cho video streaming
            response = await client.get(nvr_url, headers=headers)
            
            # Handle 206 Partial Content và 200 OK
            if response.status_code not in (200, 206):
                error_text = response.text[:500] if response.text else "No error message"
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to fetch video from NVR '{nvr_id}': HTTP {response.status_code}. Error: {error_text}",
                )
            
            # Forward response headers quan trọng cho video streaming
            response_headers = {
                "Accept-Ranges": response.headers.get("accept-ranges", "bytes"),
                "Content-Type": response.headers.get("content-type", "video/mp4"),
            }
            
            if download:
                # Force download functionality
                filename = os.path.basename(path)
                response_headers["Content-Disposition"] = f'attachment; filename="{filename}"'

            # Forward Content-Range nếu có (206 Partial Content)
            if response.status_code == 206:
                if "content-range" in response.headers:
                    response_headers["Content-Range"] = response.headers["content-range"]
                if "content-length" in response.headers:
                    response_headers["Content-Length"] = response.headers["content-length"]
            else:
                # 200 OK - full file
                if "content-length" in response.headers:
                    response_headers["Content-Length"] = response.headers["content-length"]
            
            # Stream video response từ NVR về client
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
            detail=f"Timeout streaming video from NVR '{nvr_id}' ({nvr['host']}:{nvr['port']})",
        )
    except httpx.ConnectError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot connect to NVR '{nvr_id}' at {nvr['host']}:{nvr['port']}. Is the NVR running?",
        )
    except Exception as e:
        import traceback
        error_detail = f"Failed to stream video from NVR '{nvr_id}': {str(e)}"
        logging.error(f"[get_recording_video_proxy] {error_detail}\n{traceback.format_exc()}")
        raise HTTPException(
            status_code=502,
            detail=error_detail,
        )


@router.get("/recordings/{camera_id}/thumbnail")
async def get_recording_thumbnail_proxy(
    nvr_id: str,
    camera_id: str,
    path: str
):
    """
    Proxy: serve thumbnail (frame đầu tiên) của video recording từ NVR.
    """
    servers = load_nvr_servers()
    nvr = next((s for s in servers if s.get('id') == nvr_id and s.get('enabled')), None)
    if not nvr:
        raise HTTPException(status_code=404, detail=f"NVR server '{nvr_id}' not found or disabled")
    
    try:
        nvr_url = f"http://{nvr['host']}:{nvr['port']}/api/recordings/{camera_id}/thumbnail?path={path}"
        
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(nvr_url)
            
            if response.status_code != 200:
                error_text = response.text[:500] if response.text else "No error message"
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to fetch thumbnail from NVR '{nvr_id}': HTTP {response.status_code}. Error: {error_text}",
                )
            
            from fastapi.responses import StreamingResponse
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
            detail=f"Timeout fetching thumbnail from NVR '{nvr_id}' ({nvr['host']}:{nvr['port']})",
        )
    except httpx.ConnectError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot connect to NVR '{nvr_id}' at {nvr['host']}:{nvr['port']}. Is the NVR running?",
        )
    except Exception as e:
        import traceback
        error_detail = f"Failed to fetch thumbnail from NVR '{nvr_id}': {str(e)}"
        logging.error(f"[get_recording_thumbnail_proxy] {error_detail}\n{traceback.format_exc()}")
        raise HTTPException(
            status_code=502,
            detail=error_detail,
        )


@router.get("/recordings/{camera_id}/preview")
async def get_recording_preview_proxy(
    nvr_id: str,
    camera_id: str,
    path: str,
    request: Request
):
    """
    Proxy: serve preview video (5s đầu tiên) từ NVR.
    """
    from fastapi.responses import StreamingResponse
    
    servers = load_nvr_servers()
    nvr = next((s for s in servers if s.get('id') == nvr_id and s.get('enabled')), None)
    if not nvr:
        raise HTTPException(status_code=404, detail=f"NVR server '{nvr_id}' not found or disabled")
    
    try:
        nvr_url = f"http://{nvr['host']}:{nvr['port']}/api/recordings/{camera_id}/preview?path={path}"
        
        range_header = request.headers.get("range")
        headers = {}
        if range_header:
            headers["Range"] = range_header
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(nvr_url, headers=headers)
            
            if response.status_code not in (200, 206):
                error_text = response.text[:500] if response.text else "No error message"
                raise HTTPException(
                    status_code=502,
                    detail=f"Failed to fetch preview from NVR '{nvr_id}': HTTP {response.status_code}. Error: {error_text}",
                )
            
            response_headers = {
                "Accept-Ranges": response.headers.get("accept-ranges", "bytes"),
                "Content-Type": response.headers.get("content-type", "video/mp4"),
                "Cache-Control": response.headers.get("cache-control", "public, max-age=3600"),
            }
            
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
            detail=f"Timeout streaming preview from NVR '{nvr_id}' ({nvr['host']}:{nvr['port']})",
        )
    except httpx.ConnectError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot connect to NVR '{nvr_id}' at {nvr['host']}:{nvr['port']}. Is the NVR running?",
        )
    except Exception as e:
        import traceback
        error_detail = f"Failed to stream preview from NVR '{nvr_id}': {str(e)}"
        logging.error(f"[get_recording_preview_proxy] {error_detail}\n{traceback.format_exc()}")
        raise HTTPException(
            status_code=502,
            detail=error_detail,
        )


@router.put("/reorder")
async def reorder_cameras(order_map: Dict[str, int]):
    """
    Update order of multiple cameras (CHỈ lưu tại central)

    - Không gọi xuống unified_app nữa (app chỉ phát video, không quản lý order)
    - Key lưu dạng "nvr_id::camera_id" để tránh trùng ID giữa nhiều NVR
    """
    servers = load_nvr_servers()
    
    # Load order hiện tại
    current_orders = load_camera_orders()
    updated = 0
    
    for camera_id, order in order_map.items():
        # Tìm NVR quản lý camera này để lấy nvr_id (dùng cho key)
        nvr = await _find_nvr_for_camera(camera_id)
        if not nvr:
            continue
        key = f"{nvr['id']}::{camera_id}"
        try:
            current_orders[key] = int(order)
            updated += 1
        except ValueError:
            continue
    
    # Lưu lại
    save_camera_orders(current_orders)
    
    return {
        "success": True,
        "message": f"Order updated for {updated} cameras (central only)",
        "updated_count": updated
    }


@router.post("/")
async def add_camera(camera: Camera):
    """Add new camera to specified NVR (No auth required)"""
    if not camera.nvr_id:
        raise HTTPException(
            status_code=400,
            detail="nvr_id is required to add camera"
        )

    servers = load_nvr_servers()
    nvr = next((s for s in servers if s['id'] == camera.nvr_id), None)

    if not nvr:
        raise HTTPException(status_code=404, detail="NVR server not found")

    try:
        # Proxy request to NVR với đầy đủ fields
        nvr_url = f"http://{nvr['host']}:{nvr['port']}/api/cameras"

        # Build camera data - forward tất cả fields quan trọng
        camera_data = {
            "id": camera.id,
            "name": camera.name,
            "type": camera.type,
            "url": camera.url,
            # Forward camera_type (nếu có, fallback về "internal")
            "camera_type": camera.camera_type if camera.camera_type else "internal",
        }

        # Forward enable_detection nếu được set (quan trọng!)
        # Nếu không set, để NVR dùng default (True)
        if camera.enable_detection is not None:
            camera_data["enable_detection"] = camera.enable_detection

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(nvr_url, json=camera_data)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to add camera to NVR: {str(e)}"
        )


@router.put("/{cam_id}")
async def update_camera(cam_id: str, update: CameraUpdate):
    """Update camera on its NVR (No auth required)"""
    # Find which NVR manages this camera
    nvr = await _find_nvr_for_camera(cam_id)
    if not nvr:
        raise HTTPException(status_code=404, detail="Camera not found on any NVR")

    try:
        # Proxy request to NVR - forward tất cả fields được set
        nvr_url = f"http://{nvr['host']}:{nvr['port']}/api/cameras/{cam_id}"
        update_data = {}
        if update.url is not None:
            update_data['url'] = update.url
        if update.name is not None:
            update_data['name'] = update.name
        if update.type is not None:
            update_data['type'] = update.type
        if update.camera_type is not None:
            update_data['camera_type'] = update.camera_type
        if update.enable_detection is not None:
            update_data['enable_detection'] = update.enable_detection
        if update.newId is not None:
            update_data['newId'] = update.newId
        # Order không được update qua update_camera endpoint - phải dùng /reorder endpoint riêng

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.put(nvr_url, json=update_data)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to update camera on NVR: {str(e)}"
        )


@router.delete("/{cam_id}")
async def delete_camera(cam_id: str):
    """Remove camera from its NVR (No auth required)"""
    # Find which NVR manages this camera
    nvr = await _find_nvr_for_camera(cam_id)
    if not nvr:
        raise HTTPException(status_code=404, detail="Camera not found on any NVR")
    
    try:
        # Proxy request to NVR
        nvr_url = f"http://{nvr['host']}:{nvr['port']}/api/cameras/{cam_id}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.delete(nvr_url)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as e:
        raise HTTPException(
        )


# --- Drupal Recording Upload ---

import tempfile
from datetime import datetime
from routes.auth_routes import load_drupal_session

# Default fallback URL for recording upload
DEFAULT_DRUPAL_BASE_URL = "https://paristechno.vn"


class DrupalRecordingUploadRequest(BaseModel):
    nvr_id: str
    camera_id: str
    video_path: str
    filename: str
    title: Optional[str] = None
    metadata: Optional[Dict] = None
    drupal_base_url: Optional[str] = None  # Full URL for upload endpoint


async def _get_drupal_csrf_token(client, drupal_base_url: str):
    """Get CSRF token from Drupal"""
    try:
        resp = await client.get(f"{drupal_base_url}/session/token")
        if resp.status_code == 200:
            return resp.text
        return None
    except Exception as e:
        logging.error(f"Failed to get CSRF token: {e}")
        return None


@router.post("/upload-to-drupal")
async def upload_recording_to_drupal(request: DrupalRecordingUploadRequest, user: Dict = Depends(require_manager)):
    """
    Upload recording video from NVR to Drupal.
    drupal_base_url should be the FULL URL for file upload, e.g:
    https://paristechno.vn/file/upload/node/recording/field_recording
    """
    from urllib.parse import urlparse
    
    # 0. Get full upload URL from request or use default
    full_upload_url = request.drupal_base_url or f"{DEFAULT_DRUPAL_BASE_URL}/file/upload/node/recording/field_recording"
    full_upload_url = full_upload_url.rstrip('/')
    
    # Extract base URL (scheme + netloc) from full URL for CSRF token and node creation
    parsed = urlparse(full_upload_url)
    drupal_base_url = f"{parsed.scheme}://{parsed.netloc}"
    
    logging.info(f"[Recording Upload] Using Drupal upload URL: {full_upload_url}")
    logging.info(f"[Recording Upload] Extracted base URL: {drupal_base_url}")
    
    # 1. Load Drupal Session
    cookies = load_drupal_session()
    if not cookies:
        raise HTTPException(status_code=401, detail="No Drupal session found. Please login first.")

    # 2. Find NVR
    servers = load_nvr_servers()
    nvr = next((s for s in servers if s.get('id') == request.nvr_id and s.get('enabled')), None)
    if not nvr:
        raise HTTPException(status_code=404, detail=f"NVR '{request.nvr_id}' not found or disabled")

    # 3. Download video from NVR to temp file
    temp_file_path = None
    try:
        fd, temp_file_path = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)

        nvr_url = f"http://{nvr['host']}:{nvr['port']}/api/recordings/{request.camera_id}/video?path={request.video_path}"
        
        logging.info(f"[Recording Upload] Downloading video from NVR: {nvr_url}")
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream("GET", nvr_url) as response:
                if response.status_code != 200:
                    raise HTTPException(status_code=502, detail=f"Failed to download from NVR: {response.status_code}")
                with open(temp_file_path, "wb") as f:
                    async for chunk in response.aiter_bytes():
                        f.write(chunk)
        
        # 4. Upload to Drupal
        async with httpx.AsyncClient(timeout=300.0, cookies=cookies, http2=False) as drupal_client:
            # A. Get CSRF Token
            csrf_token = await _get_drupal_csrf_token(drupal_client, drupal_base_url)
            if not csrf_token:
                raise HTTPException(status_code=401, detail="Failed to get Drupal CSRF token")

            # B. Upload File - Use full URL directly from settings
            upload_url = full_upload_url
            
            headers = {
                "Accept": "application/json",
                "Content-Type": "application/octet-stream",
                "Content-Disposition": f'file; filename="{request.filename}"',
                "X-CSRF-Token": csrf_token
            }
            
            logging.info(f"[Recording Upload] Uploading to Drupal: {upload_url}")
            
            with open(temp_file_path, "rb") as f:
                file_content = f.read()
            
            upload_resp = await drupal_client.post(
                upload_url,
                headers=headers,
                content=file_content,
                params={"_format": "json"}
            )
            
            if upload_resp.status_code not in (200, 201):
                logging.error(f"[Recording Upload] Drupal upload failed: {upload_resp.text}")
                raise HTTPException(status_code=502, detail=f"Drupal file upload failed: {upload_resp.status_code}")
            
            file_data = upload_resp.json()
            fid = None
            if isinstance(file_data, dict) and 'fid' in file_data:
                if isinstance(file_data['fid'], list) and len(file_data['fid']) > 0:
                    fid = file_data['fid'][0].get('value')
                elif isinstance(file_data['fid'], (int, str)):
                    fid = file_data['fid']
            
            if not fid:
                logging.error(f"[Recording Upload] No FID in response: {file_data}")
                raise HTTPException(status_code=502, detail="Invalid Drupal response: no FID")

            # C. Create Node
            node_url = f"{drupal_base_url}/node?_format=json"
            
            title = request.title or f"Recording {request.filename}"
            
            # Use metadata from request if provided
            if request.metadata:
                data_payload = request.metadata
            else:
                data_payload = {
                    "camera_id": request.camera_id,
                    "nvr_id": request.nvr_id,
                    "uploaded_at": datetime.now().isoformat()
                }
            
            # Extract content type and field name from upload URL
            # URL format: /file/upload/node/{content_type}/{field_name}
            url_parts = parsed.path.rstrip('/').split('/')
            # Find index of 'node' and get next two parts
            try:
                node_idx = url_parts.index('node')
                content_type = url_parts[node_idx + 1] if len(url_parts) > node_idx + 1 else "recording"
                field_name = url_parts[node_idx + 2] if len(url_parts) > node_idx + 2 else "field_recording"
            except (ValueError, IndexError):
                content_type = "recording"
                field_name = "field_recording"
            
            logging.info(f"[Recording Upload] Using content type: {content_type}, field: {field_name}")
            
            node_payload = {
                "type": [{"target_id": content_type}],
                "title": [{"value": title}],
                field_name: [{"target_id": fid}],
                "field_data": [{"value": json.dumps(data_payload)}]
            }
            
            node_headers = {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf_token
            }
            
            create_resp = await drupal_client.post(
                node_url,
                headers=node_headers,
                json=node_payload
            )
            
            if create_resp.status_code not in (200, 201):
                logging.error(f"[Recording Upload] Drupal node creation failed: {create_resp.text}")
                raise HTTPException(status_code=502, detail=f"Drupal node creation failed: {create_resp.status_code}")
                
            node_data = create_resp.json()
            nid = None
            if 'nid' in node_data:
                if isinstance(node_data['nid'], list) and len(node_data['nid']) > 0:
                    nid = node_data['nid'][0].get('value')
                elif isinstance(node_data['nid'], (int, str)):
                    nid = node_data['nid']
            
            return {
                "success": True,
                "message": f"Uploaded successfully. Node ID: {nid}",
                "file_id": fid,
                "node_id": nid,
                "drupal_url": f"{drupal_base_url}/node/{nid}" if nid else ""
            }

    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"[Recording Upload] Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup temp file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except:
                pass

