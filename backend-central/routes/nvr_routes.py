from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import json
import os

router = APIRouter(prefix="/api/nvr/servers", tags=["nvr-servers"])

NVR_SERVERS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "nvr.servers.json")

class NVRServer(BaseModel):
    id: str
    name: str
    host: str
    port: int = 5000
    device_id: str  # device_id trong unified_app config
    go2rtc_url: Optional[str] = None  # URL for go2rtc API (e.g., http://192.168.0.78:1984)
    go2rtc_rtsp_port: int = 8554
    go2rtc_webrtc_port: int = 8555
    cameras: list = []  # List of camera IDs managed by this NVR
    description: Optional[str] = ""
    enabled: bool = True

class NVRServerUpdate(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    device_id: Optional[str] = None
    go2rtc_url: Optional[str] = None
    go2rtc_rtsp_port: Optional[int] = None
    go2rtc_webrtc_port: Optional[int] = None
    cameras: Optional[list] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None


def load_nvr_servers():
    """Load NVR servers from JSON file"""
    if not os.path.exists(NVR_SERVERS_FILE):
        return []

    try:
        with open(NVR_SERVERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return []


def save_nvr_servers(servers):
    """Save NVR servers to JSON file"""
    try:
        os.makedirs(os.path.dirname(NVR_SERVERS_FILE), exist_ok=True)
        with open(NVR_SERVERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(servers, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving NVR servers: {e}")


@router.get("/")
async def get_nvr_servers():
    """Get all NVR servers"""
    try:
        servers = load_nvr_servers()
        return {"success": True, "data": servers}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/")
async def add_nvr_server(server: NVRServer):
    """Add new NVR server"""
    servers = load_nvr_servers()

    # Check for duplicate ID
    if any(s.get('id') == server.id for s in servers):
        raise HTTPException(
            status_code=400,
            detail="NVR server with this ID already exists"
        )

    # Auto-set go2rtc_url if not provided (go2rtc runs on same machine as unified_app)
    go2rtc_url = server.go2rtc_url if server.go2rtc_url else f"http://{server.host}:1984"

    new_server = {
        "id": server.id,
        "name": server.name,
        "host": server.host,
        "port": server.port,
        "device_id": server.device_id,
        "go2rtc_url": go2rtc_url,
        "go2rtc_rtsp_port": server.go2rtc_rtsp_port,
        "go2rtc_webrtc_port": server.go2rtc_webrtc_port,
        "cameras": server.cameras or [],
        "description": server.description or "",
        "enabled": server.enabled
    }

    servers.append(new_server)
    save_nvr_servers(servers)

    # Push config to App
    await _push_config_to_nvr(new_server)

    return {"success": True, "data": new_server}


@router.delete("/{server_id}")
async def delete_nvr_server(server_id: str):
    """Remove NVR server"""
    servers = load_nvr_servers()

    filtered = [s for s in servers if s.get('id') != server_id]

    if len(filtered) == len(servers):
        raise HTTPException(status_code=404, detail="NVR server not found")

    save_nvr_servers(filtered)
    return {"success": True, "message": "NVR server removed successfully"}


@router.put("/{server_id}")
async def update_nvr_server(server_id: str, update: NVRServerUpdate):
    """Update NVR server"""
    servers = load_nvr_servers()

    server_index = None
    for i, s in enumerate(servers):
        if s.get('id') == server_id:
            server_index = i
            break

    if server_index is None:
        raise HTTPException(status_code=404, detail="NVR server not found")

    # Update server
    server = servers[server_index]
    if update.name is not None:
        server['name'] = update.name
    if update.port is not None:
        server['port'] = update.port
    if update.device_id is not None:
        server['device_id'] = update.device_id
    if update.go2rtc_rtsp_port is not None:
        server['go2rtc_rtsp_port'] = update.go2rtc_rtsp_port
    if update.go2rtc_webrtc_port is not None:
        server['go2rtc_webrtc_port'] = update.go2rtc_webrtc_port
    if update.cameras is not None:
        server['cameras'] = update.cameras
    if update.description is not None:
        server['description'] = update.description
    if update.enabled is not None:
        server['enabled'] = update.enabled

    # IMPORTANT: Process host LAST and always auto-update go2rtc_url
    # This ensures go2rtc_url is always in sync with host
    if update.host is not None:
        server['host'] = update.host
        server['go2rtc_url'] = f"http://{update.host}:1984"

    servers[server_index] = server
    save_nvr_servers(servers)
    
    # Push config to App
    await _push_config_to_nvr(server)

    return {"success": True, "data": server}


async def _push_config_to_nvr(nvr_server: dict):
    """
    Push Central URL configuration to the NVR (Unified App).
    This handles TH1: Central -> App (push config)
    """
    import httpx
    import config
    import logging
    
    try:
        # Construct Central URL
        central_host = getattr(config, "CENTRAL_SERVER_IP", "127.0.0.1")
        central_port = getattr(config, "SERVER_PORT", 8000)
        central_url = f"http://{central_host}:{central_port}"
        
        app_url = f"http://{nvr_server['host']}:{nvr_server['port']}/api/config/central"
        
        logging.info(f"[NVR Sync] Pushing config to App {nvr_server['name']} ({app_url})...")
        
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(app_url, json={"central_url": central_url})
            if resp.status_code == 200:
                logging.info(f"[NVR Sync] ✅ Successfully pushed config to App {nvr_server['name']}")
            else:
                logging.warning(f"[NVR Sync] ⚠️ Failed to push config: {resp.status_code} - {resp.text}")
                
    except Exception as e:
        logging.warning(f"[NVR Sync] ❌ Error pushing config to App: {e}")


@router.get("/{server_id}/health")
async def check_nvr_health(server_id: str):
    """Check if NVR server and its go2rtc are reachable"""
    import httpx
    
    servers = load_nvr_servers()
    server = next((s for s in servers if s.get('id') == server_id), None)
    
    if not server:
        raise HTTPException(status_code=404, detail="NVR server not found")
    
    result = {
        "nvr_id": server_id,
        "nvr_reachable": False,
        "go2rtc_reachable": False,
        "error": None
    }
    
    # Check NVR API
    try:
        nvr_url = f"http://{server['host']}:{server['port']}/api/cameras"
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(nvr_url)
            if response.status_code == 200:
                result["nvr_reachable"] = True
    except Exception as e:
        result["error"] = f"NVR API error: {str(e)}"
    
    # Check go2rtc API
    go2rtc_url = server.get('go2rtc_url')
    if go2rtc_url:
        try:
            go2rtc_health_url = f"{go2rtc_url}/api/streams"
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(go2rtc_health_url)
                if response.status_code == 200:
                    result["go2rtc_reachable"] = True
        except Exception as e:
            if not result["error"]:
                result["error"] = f"go2rtc API error: {str(e)}"
            else:
                result["error"] += f" | go2rtc API error: {str(e)}"
    
    result["success"] = result["nvr_reachable"] or result["go2rtc_reachable"]
    return result


@router.get("/{server_id}/cameras")
async def get_nvr_cameras(server_id: str):
    """Get cameras from NVR's API"""
    import httpx
    
    servers = load_nvr_servers()
    server = next((s for s in servers if s.get('id') == server_id), None)
    
    if not server:
        raise HTTPException(status_code=404, detail="NVR server not found")
    
    try:
        nvr_url = f"http://{server['host']}:{server['port']}/api/cameras"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(nvr_url)
            response.raise_for_status()
            cameras = response.json()
            
            # Add nvr_id to each camera
            if isinstance(cameras, list):
                for cam in cameras:
                    cam['nvr_id'] = server_id
                    cam['nvr_name'] = server['name']
            
            return {"success": True, "nvr_id": server_id, "cameras": cameras}
    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to fetch cameras from NVR: {str(e)}"
        )


# ============ Cleanup Configuration Endpoints ============

@router.get("/cleanup/config")
async def get_all_nvr_cleanup_configs():
    """
    Get cleanup configuration from all NVR servers.

    Returns:
        {
            "success": True,
            "servers": [
                {
                    "nvr_id": str,
                    "nvr_name": str,
                    "reachable": bool,
                    "config": {...} or null,
                    "error": str or null
                }
            ]
        }
    """
    import httpx

    servers = load_nvr_servers()
    results = []

    for server in servers:
        if not server.get('enabled', True):
            continue

        result = {
            "nvr_id": server['id'],
            "nvr_name": server['name'],
            "reachable": False,
            "config": None,
            "error": None
        }

        try:
            nvr_url = f"http://{server['host']}:{server['port']}/api/cleanup/config"
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(nvr_url)
                response.raise_for_status()
                data = response.json()

                result["reachable"] = True
                result["config"] = data.get("config", {})
        except Exception as e:
            result["error"] = str(e)

        results.append(result)

    return {
        "success": True,
        "servers": results
    }


@router.put("/cleanup/config")
async def update_all_nvr_cleanup_config(
    recordings_retention_days: int,
    timelapse_retention_days: int,
    enabled: bool = True,
    schedule: str = "03:00"
):
    """
    Broadcast cleanup configuration update to ALL NVR servers.

    This endpoint is called by the frontend when the user changes global cleanup settings.
    It will send PUT requests to all enabled NVR servers to update their cleanup config.

    Args:
        recordings_retention_days: Days to retain recordings (1-3650)
        timelapse_retention_days: Days to retain timelapse videos (1-3650)
        enabled: Enable/disable auto cleanup
        schedule: Time to run cleanup daily (HH:MM format)

    Returns:
        {
            "success": True,
            "total_servers": int,
            "updated": int,
            "failed": int,
            "results": [
                {
                    "nvr_id": str,
                    "nvr_name": str,
                    "success": bool,
                    "error": str or null
                }
            ]
        }
    """
    import httpx

    # Validate inputs
    if recordings_retention_days < 1 or recordings_retention_days > 3650:
        raise HTTPException(status_code=400, detail="recordings_retention_days must be between 1 and 3650")

    if timelapse_retention_days < 1 or timelapse_retention_days > 3650:
        raise HTTPException(status_code=400, detail="timelapse_retention_days must be between 1 and 3650")

    # Validate schedule format
    try:
        h, m = schedule.split(":")
        if len(h) != 2 or len(m) != 2:
            raise ValueError()
        int(h), int(m)
    except:
        raise HTTPException(status_code=400, detail="schedule must be in HH:MM format")

    servers = load_nvr_servers()
    results = []
    updated_count = 0
    failed_count = 0

    for server in servers:
        if not server.get('enabled', True):
            continue

        result = {
            "nvr_id": server['id'],
            "nvr_name": server['name'],
            "success": False,
            "error": None
        }

        try:
            nvr_url = f"http://{server['host']}:{server['port']}/api/cleanup/config"
            params = {
                "recordings_retention_days": recordings_retention_days,
                "timelapse_retention_days": timelapse_retention_days,
                "enabled": enabled,
                "schedule": schedule
            }

            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.put(nvr_url, params=params)
                response.raise_for_status()

                result["success"] = True
                updated_count += 1
        except Exception as e:
            result["error"] = str(e)
            failed_count += 1

        results.append(result)

    return {
        "success": True,
        "total_servers": len(results),
        "updated": updated_count,
        "failed": failed_count,
        "results": results
    }


@router.post("/{server_id}/cleanup/execute")
async def execute_nvr_cleanup(server_id: str):
    """
    Trigger cleanup execution on a specific NVR server immediately.

    Args:
        server_id: NVR server ID

    Returns:
        {
            "success": True,
            "message": str
        }
    """
    import httpx

    servers = load_nvr_servers()
    server = next((s for s in servers if s.get('id') == server_id), None)

    if not server:
        raise HTTPException(status_code=404, detail="NVR server not found")

    try:
        nvr_url = f"http://{server['host']}:{server['port']}/api/cleanup/execute"
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(nvr_url)
            response.raise_for_status()

            return {
                "success": True,
                "message": f"Cleanup triggered on NVR '{server['name']}'"
            }
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to trigger cleanup on NVR: {str(e)}"
        )
