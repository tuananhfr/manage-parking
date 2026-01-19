"""
API Proxy Routes for Parking Lock Backends
Forward requests to parking-lock instances and aggregate responses
"""
from fastapi import APIRouter, HTTPException, Query, Path, Body
from typing import Optional, List, Dict, Any
import httpx
import json
import os

router = APIRouter(prefix="/api/parking-lock", tags=["parking-lock-proxy"])

PARKING_BACKENDS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "parking.backends.json")
PARKING_GLOBAL_CONFIG_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "parking.global_config.json")


def load_parking_backends():
    """Load parking backends from JSON file"""
    if not os.path.exists(PARKING_BACKENDS_FILE):
        return []
    
    try:
        with open(PARKING_BACKENDS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return []


def load_global_config() -> Dict[str, Any]:
    """Load global parking config from JSON file (single config for all backends)"""
    if not os.path.exists(PARKING_GLOBAL_CONFIG_FILE):
        # Return default config
        return {
            "price": 50000,
            "free_time": 15,
            "warning_time": 10,
            "updated_at": None
        }

    try:
        with open(PARKING_GLOBAL_CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        import logging
        logging.error(f"Failed to load global config: {e}")
        return {
            "price": 50000,
            "free_time": 15,
            "warning_time": 10,
            "updated_at": None
        }


def save_global_config(config: Dict[str, Any]):
    """Save global config (applies to ALL backends) to JSON file"""
    try:
        from datetime import datetime

        # Single config object with timestamp
        config_to_save = {
            "price": config.get("price"),
            "free_time": config.get("free_time"),
            "warning_time": config.get("warning_time"),
            "updated_at": datetime.now().isoformat()
        }

        # Ensure data directory exists
        os.makedirs(os.path.dirname(PARKING_GLOBAL_CONFIG_FILE), exist_ok=True)

        # Save to file
        with open(PARKING_GLOBAL_CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config_to_save, f, ensure_ascii=False, indent=2)

    except Exception as e:
        import logging
        logging.error(f"Failed to save global config: {e}")
        raise


def get_backend_url(backend_id: str) -> Optional[str]:
    """Get backend URL by ID"""
    backends = load_parking_backends()
    for backend in backends:
        if backend.get('id') == backend_id and backend.get('enabled', True):
            return f"http://{backend['host']}:{backend['port']}"
    return None


async def proxy_request(backend_id: str, method: str, endpoint: str, 
                        params: Optional[Dict] = None, 
                        json_data: Optional[Dict] = None) -> Dict[str, Any]:
    """Proxy request to parking-lock backend"""
    backend_url = get_backend_url(backend_id)
    if not backend_url:
        raise HTTPException(status_code=404, detail=f"Backend {backend_id} not found or disabled")
    
    url = f"{backend_url}{endpoint}"
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if method == "GET":
                response = await client.get(url, params=params)
            elif method == "POST":
                response = await client.post(url, json=json_data, params=params)
            elif method == "PUT":
                response = await client.put(url, json=json_data, params=params)
            elif method == "DELETE":
                response = await client.delete(url, params=params)
            else:
                raise HTTPException(status_code=400, detail=f"Unsupported method: {method}")
            
            response.raise_for_status()
            return response.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail=f"Backend {backend_id} timeout")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail=f"Backend {backend_id} connection failed")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"Backend error: {e.response.text}")


# ... (Keeping other routes as they are up to GLOBAL SETTINGS API) ...
# ============ DEVICES API ============
# ... (Lines 122 - 594 are unchanged, re-inserting solely for context matching or relying on diff if possible) ...
# To be safe, I will implement the replacement for lines 29-726 where I can focus on the changed parts. 
# But wait, replace_file_content works on line ranges. I should target specific blocks.

# Let's target the logic functions first (load/save global config) and then the API routes.
# Actually, the tool allows replacing a big chunk if needed. 
# But I need to be careful not to delete the other existing proxy routes (Devices, Lockers, Logs, Payments).
# The file content I saw has "GLOBAL SETTINGS API" at line 595.
# So I will replace from line 29 to 76 (Storage Logic) AND line 595 to 726 (API Routes).
# Two separate calls or one big replace if contiguous? They are not contiguous.
# Default API replace_file_content does NOT support multiple disjoint chunks in one call unless I use `multi_replace_file_content`.

# Strategy:
# 1. Update Storage Logic (load_global_config, save_global_config) - Lines 29-76.
# 2. Update Global Settings API Routes - Lines 595-726.




def get_backend_url(backend_id: str) -> Optional[str]:
    """Get backend URL by ID"""
    backends = load_parking_backends()
    for backend in backends:
        if backend.get('id') == backend_id and backend.get('enabled', True):
            return f"http://{backend['host']}:{backend['port']}"
    return None


async def proxy_request(backend_id: str, method: str, endpoint: str, 
                        params: Optional[Dict] = None, 
                        json_data: Optional[Dict] = None) -> Dict[str, Any]:
    """Proxy request to parking-lock backend"""
    backend_url = get_backend_url(backend_id)
    if not backend_url:
        raise HTTPException(status_code=404, detail=f"Backend {backend_id} not found or disabled")
    
    url = f"{backend_url}{endpoint}"
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if method == "GET":
                response = await client.get(url, params=params)
            elif method == "POST":
                response = await client.post(url, json=json_data, params=params)
            elif method == "PUT":
                response = await client.put(url, json=json_data, params=params)
            elif method == "DELETE":
                response = await client.delete(url, params=params)
            else:
                raise HTTPException(status_code=400, detail=f"Unsupported method: {method}")
            
            response.raise_for_status()
            return response.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail=f"Backend {backend_id} timeout")
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail=f"Backend {backend_id} connection failed")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=f"Backend error: {e.response.text}")


# ============ DEVICES API ============

@router.get("/backends/{backend_id}/devices")
async def get_devices(
    backend_id: str = Path(..., description="Backend ID"),
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: Optional[int] = Query(100, description="Limit results"),
    offset: Optional[int] = Query(0, description="Offset results")
):
    """Get all devices from a parking-lock backend"""
    params = {}
    if status:
        params['status'] = status
    if limit:
        params['limit'] = limit
    if offset:
        params['offset'] = offset
    
    result = await proxy_request(backend_id, "GET", "/api/devices", params=params)
    return {"success": True, "backend_id": backend_id, **result}


@router.get("/backends/{backend_id}/devices/{device_id}")
async def get_device(
    backend_id: str = Path(..., description="Backend ID"),
    device_id: str = Path(..., description="Device ID")
):
    """Get device details from a parking-lock backend"""
    result = await proxy_request(backend_id, "GET", f"/api/devices/{device_id}")
    return {"success": True, "backend_id": backend_id, **result}


@router.put("/backends/{backend_id}/devices/{device_id}")
async def update_device(
    backend_id: str = Path(..., description="Backend ID"),
    device_id: str = Path(..., description="Device ID"),
    data: Dict[str, Any] = Body(...)
):
    """Update device in a parking-lock backend"""
    result = await proxy_request(backend_id, "PUT", f"/api/devices/{device_id}", json_data=data)
    return {"success": True, "backend_id": backend_id, **result}


@router.post("/backends/{backend_id}/devices/{device_id}/business-control")
async def device_business_control(
    backend_id: str = Path(..., description="Backend ID"),
    device_id: str = Path(..., description="Device ID"),
    data: Dict[str, Any] = Body(...)
):
    """Business control (Open/Close) for device"""
    result = await proxy_request(backend_id, "POST", f"/api/devices/{device_id}/business-control", json_data=data)
    return {"success": True, "backend_id": backend_id, **result}


@router.post("/backends/{backend_id}/devices/{device_id}/maintenance")
async def device_maintenance(
    backend_id: str = Path(..., description="Backend ID"),
    device_id: str = Path(..., description="Device ID"),
    data: Dict[str, Any] = Body(...)
):
    """Maintenance (Reboot/ClearErr) for device"""
    result = await proxy_request(backend_id, "POST", f"/api/devices/{device_id}/maintenance", json_data=data)
    return {"success": True, "backend_id": backend_id, **result}


@router.post("/backends/{backend_id}/devices/refresh-config")
async def refresh_config(
    backend_id: str = Path(..., description="Backend ID")
):
    """Refresh config on all online devices in backend"""
    result = await proxy_request(backend_id, "POST", "/api/devices/refresh-config")
    return {"success": True, "backend_id": backend_id, **result}


# ============ LOCKERS API ============

@router.get("/backends/{backend_id}/lockers")
async def get_lockers(
    backend_id: str = Path(..., description="Backend ID"),
    device_id: Optional[str] = Query(None, description="Filter by device_id"),
    status: Optional[str] = Query(None, description="Filter by status"),
    mode: Optional[str] = Query(None, description="Filter by mode"),
    occupied: Optional[bool] = Query(None, description="Filter by occupied"),
    connected: Optional[bool] = Query(None, description="Filter by connected"),
    limit: Optional[int] = Query(100, description="Limit results"),
    offset: Optional[int] = Query(0, description="Offset results")
):
    """Get all lockers from a parking-lock backend"""
    params = {}
    if device_id:
        params['device_id'] = device_id
    if status:
        params['status'] = status
    if mode:
        params['mode'] = mode
    if occupied is not None:
        params['occupied'] = str(occupied).lower()
    if connected is not None:
        params['connected'] = str(connected).lower()
    if limit:
        params['limit'] = limit
    if offset:
        params['offset'] = offset
    
    result = await proxy_request(backend_id, "GET", "/api/lockers", params=params)
    return {"success": True, "backend_id": backend_id, **result}


@router.get("/backends/{backend_id}/lockers/{lock_id}")
async def get_locker(
    backend_id: str = Path(..., description="Backend ID"),
    lock_id: str = Path(..., description="Locker ID")
):
    """Get locker details from a parking-lock backend"""
    result = await proxy_request(backend_id, "GET", f"/api/lockers/{lock_id}")
    return {"success": True, "backend_id": backend_id, **result}


@router.post("/backends/{backend_id}/lockers/{lock_id}/control")
async def control_locker(
    backend_id: str = Path(..., description="Backend ID"),
    lock_id: str = Path(..., description="Locker ID"),
    data: Dict[str, Any] = Body(...)
):
    """Control locker (open/close/stop/normal/check)"""
    result = await proxy_request(backend_id, "POST", f"/api/lockers/{lock_id}/control", json_data=data)
    return {"success": True, "backend_id": backend_id, **result}


@router.put("/backends/{backend_id}/lockers/{lock_id}")
async def update_locker(
    backend_id: str = Path(..., description="Backend ID"),
    lock_id: str = Path(..., description="Locker ID"),
    data: Dict[str, Any] = Body(...)
):
    """Update locker"""
    result = await proxy_request(backend_id, "PUT", f"/api/lockers/{lock_id}", json_data=data)
    return {"success": True, "backend_id": backend_id, **result}


@router.post("/backends/{backend_id}/lockers/{lock_id}/set-attribute")
async def set_lock_attribute(
    backend_id: str = Path(..., description="Backend ID"),
    lock_id: str = Path(..., description="Locker ID"),
    data: Dict[str, Any] = Body(...)
):
    """Set lock protection attributes"""
    result = await proxy_request(backend_id, "POST", f"/api/lockers/{lock_id}/set-attribute", json_data=data)
    return {"success": True, "backend_id": backend_id, **result}


@router.post("/backends/{backend_id}/lockers/{lock_id}/free-time")
async def set_free_time(
    backend_id: str = Path(..., description="Backend ID"),
    lock_id: str = Path(..., description="Locker ID"),
    data: Dict[str, Any] = Body(...)
):
    """Set free time (minutes before auto-lock)"""
    result = await proxy_request(backend_id, "POST", f"/api/lockers/{lock_id}/free-time", json_data=data)
    return {"success": True, "backend_id": backend_id, **result}


@router.post("/backends/{backend_id}/lockers/{lock_id}/warning-time")
async def set_warning_time(
    backend_id: str = Path(..., description="Backend ID"),
    lock_id: str = Path(..., description="Locker ID"),
    data: Dict[str, Any] = Body(...)
):
    """Set warning time (seconds before action)"""
    result = await proxy_request(backend_id, "POST", f"/api/lockers/{lock_id}/warning-time", json_data=data)
    return {"success": True, "backend_id": backend_id, **result}


@router.post("/backends/{backend_id}/lockers/{lock_id}/simulate-car-enter")
async def simulate_car_enter(
    backend_id: str = Path(..., description="Backend ID"),
    lock_id: str = Path(..., description="Locker ID")
):
    """Simulate car enter (for testing)"""
    result = await proxy_request(backend_id, "POST", f"/api/lockers/{lock_id}/simulate-car-enter")
    return {"success": True, "backend_id": backend_id, **result}


@router.post("/backends/{backend_id}/lockers/{lock_id}/simulate-car-exit")
async def simulate_car_exit(
    backend_id: str = Path(..., description="Backend ID"),
    lock_id: str = Path(..., description="Locker ID")
):
    """Simulate car exit (for testing)"""
    result = await proxy_request(backend_id, "POST", f"/api/lockers/{lock_id}/simulate-car-exit")
    return {"success": True, "backend_id": backend_id, **result}


# ============ AGGREGATE API (All Backends) ============

@router.get("/devices")
async def get_all_devices(
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: Optional[int] = Query(100, description="Limit per backend")
):
    """Get devices from all enabled backends"""
    backends = load_parking_backends()
    enabled_backends = [b for b in backends if b.get('enabled', True)]
    
    results = []
    for backend in enabled_backends:
        try:
            params = {}
            if status:
                params['status'] = status
            if limit:
                params['limit'] = limit
            
            result = await proxy_request(backend['id'], "GET", "/api/devices", params=params)
            if result.get('success') and result.get('data'):
                for device in result['data']:
                    device['backend_id'] = backend['id']
                    device['backend_name'] = backend['name']
                results.extend(result['data'])
        except Exception as e:
            # Skip failed backends
            continue
    
    return {"success": True, "total": len(results), "data": results}


@router.get("/lockers")
async def get_all_lockers(
    backend_id: Optional[str] = Query(None, description="Filter by backend_id"),
    device_id: Optional[str] = Query(None, description="Filter by device_id"),
    status: Optional[str] = Query(None, description="Filter by status"),
    mode: Optional[str] = Query(None, description="Filter by mode"),
    occupied: Optional[bool] = Query(None, description="Filter by occupied"),
    connected: Optional[bool] = Query(None, description="Filter by connected"),
    limit: Optional[int] = Query(100, description="Limit per backend")
):
    """Get lockers from all enabled backends"""
    backends = load_parking_backends()
    enabled_backends = [b for b in backends if b.get('enabled', True)]
    
    # Filter by backend_id if specified
    if backend_id:
        enabled_backends = [b for b in enabled_backends if b.get('id') == backend_id]
    
    results = []
    for backend in enabled_backends:
        try:
            params = {}
            if device_id:
                params['device_id'] = device_id
            if status:
                params['status'] = status
            if mode:
                params['mode'] = mode
            if occupied is not None:
                params['occupied'] = str(occupied).lower()
            if connected is not None:
                params['connected'] = str(connected).lower()
            if limit:
                params['limit'] = limit
            
            result = await proxy_request(backend['id'], "GET", "/api/lockers", params=params)
            if result.get('success') and result.get('data'):
                for locker in result['data']:
                    locker['backend_id'] = backend['id']
                    locker['backend_name'] = backend['name']
                results.extend(result['data'])
        except Exception as e:
            # Skip failed backends
            continue
    
    return {"success": True, "total": len(results), "data": results}









# ============ LOGS API ============

@router.get("/logs")
async def get_command_logs(
    backend_id: Optional[str] = Query(None, description="Filter by backend_id"),
    device_id: Optional[str] = Query(None, description="Filter by device_id"),
    lock_id: Optional[str] = Query(None, description="Filter by lock_id"),
    command_type: Optional[str] = Query(None, description="Filter by command_type"),
    status: Optional[str] = Query(None, description="Filter by status"),
    limit: Optional[int] = Query(100, description="Limit per backend")
):
    """Get command logs from all enabled backends"""
    backends = load_parking_backends()
    enabled_backends = [b for b in backends if b.get('enabled', True)]
    
    if backend_id:
        enabled_backends = [b for b in enabled_backends if b.get('id') == backend_id]
    
    results = []
    for backend in enabled_backends:
        try:
            params = {}
            if device_id: params['device_id'] = device_id
            if lock_id: params['lock_id'] = lock_id
            if command_type: params['command_type'] = command_type
            if status: params['status'] = status
            if limit: params['limit'] = limit
            
            result = await proxy_request(backend['id'], "GET", "/api/logs/commands", params=params)
            
            if result.get('success') and result.get('data'):
                for log in result['data']:
                    log['backend_id'] = backend['id']
                    log['backend_name'] = backend['name']
                results.extend(result['data'])
        except Exception as e:
            continue
            
    # Sort by created_at desc (logs usually have sent_at or created_at)
    # Assuming 'sent_at' is the field from parking-lock backend
    try:
        results.sort(key=lambda x: x.get('sent_at', ''), reverse=True)
    except:
        pass
        
    return {"success": True, "total": len(results), "data": results}


# ============ PAYMENT API ============

@router.get("/payments/history")
async def get_payment_history(
    backend_id: Optional[str] = Query(None, description="Filter by backend_id"),
    device_id: Optional[str] = Query(None, description="Filter by device_id"),
    lock_id: Optional[str] = Query(None, description="Filter by lock_id"),
    status: Optional[str] = Query(None, description="Filter by status"),
    start_date: Optional[str] = Query(None, description="Filter by start date"),
    end_date: Optional[str] = Query(None, description="Filter by end date"),
    limit: Optional[int] = Query(100, description="Limit per backend")
):
    """Get payment history (orders) from all enabled backends"""
    backends = load_parking_backends()
    enabled_backends = [b for b in backends if b.get('enabled', True)]
    
    if backend_id:
        enabled_backends = [b for b in enabled_backends if b.get('id') == backend_id]
        
    results = []
    total_revenue = 0
    
    for backend in enabled_backends:
        try:
            params = {}
            if device_id: params['device_id'] = device_id
            if lock_id: params['lock_id'] = lock_id
            if status: params['status'] = status
            if start_date: params['start_date'] = start_date
            if end_date: params['end_date'] = end_date
            if limit: params['limit'] = limit
            
            result = await proxy_request(backend['id'], "GET", "/api/payments/history", params=params)
            
            if result.get('success') and result.get('data'):
                for order in result['data']:
                    order['backend_id'] = backend['id']
                    order['backend_name'] = backend['name']
                results.extend(result['data'])
                
                # Check for summary/stats in response if available, otherwise sum manually maybe?
                # Actually let's trust the /stats endpoint for revenue, here just list
        except Exception:
            continue
            
    # Sort by created_at desc
    try:
        results.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    except:
        pass
        
    return {"success": True, "total": len(results), "data": results}

@router.get("/payments/sessions")
async def get_parking_sessions(
    backend_id: Optional[str] = Query(None, description="Filter by backend_id"),
    device_id: Optional[str] = Query(None, description="Filter by device_id"),
    lock_id: Optional[str] = Query(None, description="Filter by lock_id"),
    ticket_type: Optional[str] = Query(None, description="Filter by ticket type"),
    status: Optional[str] = Query(None, description="Filter by status"),
    start_date: Optional[str] = Query(None, description="Filter by start date"),
    end_date: Optional[str] = Query(None, description="Filter by end date"),
    limit: Optional[int] = Query(100, description="Limit per backend")
):
    """Get parking sessions from all enabled backends"""
    backends = load_parking_backends()
    enabled_backends = [b for b in backends if b.get('enabled', True)]
    
    if backend_id:
        enabled_backends = [b for b in enabled_backends if b.get('id') == backend_id]
        
    results = []
    
    for backend in enabled_backends:
        try:
            params = {}
            if device_id: params['device_id'] = device_id
            if lock_id: params['lock_id'] = lock_id
            if ticket_type: params['ticket_type'] = ticket_type
            if status: params['status'] = status
            if start_date: params['start_date'] = start_date
            if end_date: params['end_date'] = end_date
            if limit: params['limit'] = limit
            
            result = await proxy_request(backend['id'], "GET", "/api/payments/sessions", params=params)
            
            if result.get('success') and result.get('data'):
                for session in result['data']:
                    session['backend_id'] = backend['id']
                    session['backend_name'] = backend['name']
                results.extend(result['data'])
        except Exception:
            continue
            
    try:
        results.sort(key=lambda x: x.get('car_enter_time', ''), reverse=True)
    except:
        pass
        
    return {"success": True, "total": len(results), "data": results}

async def get_all_payment_stats(start_date: Optional[str] = None, end_date: Optional[str] = None):
    """
    Helper function to get aggregated stats from all backends.
    Reusable by other parts of the system (e.g., app.py dashboard).
    """
    backends = load_parking_backends()
    enabled_backends = [b for b in backends if b.get('enabled', True)]
    
    aggregated_stats = {
        "total_sessions": 0,
        "completed_sessions": 0,
        "in_progress_sessions": 0,
        "total_revenue": 0,
        "single_tickets": 0,
        "monthly_tickets": 0
    }
    
    import asyncio
    
    async def fetch_backend_stats(backend):
        try:
            params = {}
            if start_date: params['start_date'] = start_date
            if end_date: params['end_date'] = end_date
            
            # Try to get session stats (more comprehensive usually)
            result = await proxy_request(backend['id'], "GET", "/api/payments/sessions/statistics", params=params)
            
            if result.get('success') and result.get('data'):
                return result['data']
        except Exception:
            pass
        return None

    tasks = [fetch_backend_stats(b) for b in enabled_backends]
    results = await asyncio.gather(*tasks)
    
    for data in results:
        if data:
            aggregated_stats["total_sessions"] += data.get("total_sessions") or 0
            aggregated_stats["completed_sessions"] += data.get("completed_sessions") or 0
            aggregated_stats["in_progress_sessions"] += data.get("in_progress_sessions") or 0
            aggregated_stats["total_revenue"] += data.get("total_revenue") or 0
            aggregated_stats["single_tickets"] += data.get("single_tickets") or 0
            aggregated_stats["monthly_tickets"] += data.get("monthly_tickets") or 0
            
    return aggregated_stats


async def get_detailed_report_data(start_date: str, end_date: str):
    """
    Get DETAILED report data grouped by Backend -> Device -> Locker.
    Used for sending comprehensive reports to Drupal.
    """
    backends = load_parking_backends()
    enabled = [b for b in backends if b.get('enabled', True)]
    
    report_data = []
    
    # We can run backends in parallel
    import asyncio
    
    async def process_backend(b):
        b_data = {
            "backend_id": b["id"],
            "backend_name": b["name"],
            "devices": {}  # Temporary map: device_id -> { lockers: {} }
        }
        
        try:
            # 1. Fetch Lockers Structure
            # Only active/connected lockers (mirroring Frontend logic)
            lockers_res = await proxy_request(b["id"], "GET", "/api/lockers?connected=true&limit=1000")
            if lockers_res.get("success"):
                for l in lockers_res.get("data", []):
                    did = str(l.get("device_id") or "unknown")
                    lid = str(l.get("lock_id") or "unknown")
                    
                    if did not in b_data["devices"]:
                        b_data["devices"][did] = {
                            "device_id": did, 
                            "name": f"Device {did}",
                            "lockers": {}
                        }
                    
                    b_data["devices"][did]["lockers"][lid] = {
                        "lock_id": lid,
                        "label": l.get("label") or f"Lock {lid}",
                        "revenue": 0,
                        "sessions": 0,
                        "status": l.get("status"),
                        "session_list": []
                    }

            # 2. Fetch Payment/Session History (Stats)
            # Use /payments/sessions to get full entry/exit details
            # Pass start_date/end_date to filter sessions in that day
            # Assuming backend supports query params for sessions similar to history
            sessions_res = await proxy_request(b["id"], "GET", f"/api/payments/sessions?start_date={start_date}&end_date={end_date}&limit=10000")
            if sessions_res.get("success"):
                for s in sessions_res.get("data", []):
                    did = str(s.get("device_id") or "unknown")
                    lid = str(s.get("lock_id") or "unknown")
                    
                    # Fee / Revenue
                    fee = float(s.get("parking_fee") or s.get("fee") or 0)
                    
                    # Ensure structure exists
                    if did not in b_data["devices"]:
                         b_data["devices"][did] = {"device_id": did, "lockers": {}}
                    if lid not in b_data["devices"][did]["lockers"]:
                         b_data["devices"][did]["lockers"][lid] = {
                             "lock_id": lid, 
                             "revenue": 0, 
                             "sessions": 0,
                             "session_list": []
                         }
                    
                    locker_stats = b_data["devices"][did]["lockers"][lid]
                    if "session_list" not in locker_stats: locker_stats["session_list"] = []
                    
                    # Accumulate Revenue/Count
                    locker_stats["revenue"] += fee
                    locker_stats["sessions"] += 1
                    
                    # Create Session Detail Object
                    session_detail = {
                        "session_id": s.get("session_id") or s.get("id"),
                        "plate_number": s.get("plate_number") or s.get("plate") or "-",
                        "car_enter_time": s.get("car_enter_time"),
                        "car_exit_time": s.get("car_exit_time"),
                        "duration_minutes": s.get("duration") or 0, # Assuming backend gives duration or we calc
                        "ticket_type": s.get("ticket_type"),
                        "fee": fee,
                        "status": s.get("status"),
                        "order_id": s.get("order_id")
                    }
                    
                    # Calculate duration if missing and times exist
                    if not session_detail["duration_minutes"] and session_detail["car_enter_time"] and session_detail["car_exit_time"]:
                        try:
                            from datetime import datetime
                            fmt = "%Y-%m-%d %H:%M:%S"
                            t1 = datetime.strptime(session_detail["car_enter_time"], fmt)
                            t2 = datetime.strptime(session_detail["car_exit_time"], fmt)
                            diff = (t2 - t1).total_seconds() / 60
                            session_detail["duration_minutes"] = int(diff)
                        except:
                            pass

                    locker_stats["session_list"].append(session_detail)
            
            # 3. Convert Maps to Lists
            devices_list = []
            for did, d_obj in b_data["devices"].items():
                # Sort lockers by ID (numeric if possible)
                lockers = list(d_obj["lockers"].values())
                try:
                    lockers.sort(key=lambda x: int(x["lock_id"]) if x["lock_id"].isdigit() else x["lock_id"])
                except:
                    pass
                d_obj["lockers"] = lockers
                devices_list.append(d_obj)
            
            # Sort devices
            try:
                devices_list.sort(key=lambda x: int(x["device_id"]) if x["device_id"].isdigit() else x["device_id"])
            except:
                pass
                
            b_data["devices"] = devices_list
            b_data["total_revenue"] = sum(
                sum(l["revenue"] for l in d["lockers"]) 
                for d in devices_list
            )
            
            return b_data

        except Exception as e:
            # Return partial info with error
            b_data["error"] = str(e)
            return b_data

    tasks = [process_backend(b) for b in enabled]
    results = await asyncio.gather(*tasks)
    
    return [r for r in results if r]

@router.get("/payments/stats")
async def get_payment_stats(
    backend_id: Optional[str] = Query(None, description="Filter by backend_id"),
    start_date: Optional[str] = Query(None, description="Filter by start date"),
    end_date: Optional[str] = Query(None, description="Filter by end date")
):
    """Get aggregated payment statistics"""
    # If backend_id is provided, just proxy to that backend
    if backend_id:
        try:
            params = {}
            if start_date: params['start_date'] = start_date
            if end_date: params['end_date'] = end_date
            result = await proxy_request(backend_id, "GET", "/api/payments/sessions/statistics", params=params)
            if result.get('success'):
                return {"success": True, "data": result.get('data')}
            else:
                 # Return empty stats if failed
                 return {"success": True, "data": {
                    "total_sessions": 0, "completed_sessions": 0, "in_progress_sessions": 0,
                    "total_revenue": 0, "single_tickets": 0, "monthly_tickets": 0
                }}
        except:
             return {"success": False, "error": "Failed to fetch backend stats"}

    # Otherwise aggregate from all
    stats = await get_all_payment_stats(start_date, end_date)
    return {"success": True, "data": stats}


# ============ GLOBAL SETTINGS API ============

@router.get("/settings/global-config")
async def get_global_config():
    """
    Get current global config (applies to all backends).
    Returns the last applied config or default values.
    """
    config = load_global_config()
    return {
        "success": True,
        "data": config
    }


@router.post("/settings/global-config")
async def apply_global_config(
    config: Dict[str, Any] = Body(...)
):
    """
    Apply global config (price, free_time, warning_time) to ALL enabled backends and their lockers.
    Iterates through all backends -> all lockers and applies settings one by one.
    Saves config to persistent storage for future reference.
    """
    # 0. Load enabled backends
    backends = load_parking_backends()
    enabled_backends = [b for b in backends if b.get('enabled', True)]
    
    import asyncio
    
    total_results = {
        "total_backends": len(enabled_backends),
        "total_lockers": 0,
        "success": 0,
        "failed": 0,
        "errors": []
    }

    async def apply_to_backend(backend):
        backend_id = backend['id']
        backend_results = {"success": 0, "failed": 0, "total": 0}
        
        try:
            # 1. Get all lockers from backend
            lockers_result = await proxy_request(backend_id, "GET", "/api/lockers?connected=true&limit=1000")
            if not lockers_result.get('success'):
                total_results["errors"].append(f"Failed to fetch lockers from backend {backend_id}")
                return backend_results
                
            lockers = lockers_result.get('data', [])
            backend_results["total"] = len(lockers)
            
            # 2. Iterate and apply settings to lockers
            async def apply_to_locker(locker):
                locker_id = locker.get('lock_id')
                if not locker_id: return False
                
                try:
                    tasks = []
                    
                    # Free Time
                    if 'free_time' in config:
                        tasks.append(proxy_request(
                            backend_id, "POST", 
                            f"/api/lockers/{locker_id}/free-time", 
                            json_data={"time": int(config['free_time'])}
                        ))
                        
                    # Warning Time
                    if 'warning_time' in config:
                        tasks.append(proxy_request(
                            backend_id, "POST", 
                            f"/api/lockers/{locker_id}/warning-time", 
                            json_data={"time": int(config['warning_time'])}
                        ))
                        
                    # Hourly Rate (Price)
                    if 'price' in config:
                         tasks.append(proxy_request(
                            backend_id, "PUT", 
                            f"/api/lockers/{locker_id}", 
                            json_data={"hourly_rate": int(config['price'])}
                        ))

                    if tasks:
                        await asyncio.gather(*tasks)
                    return True
                    
                except Exception:
                    return False

            # Run in parallel chunks for this backend
            chunk_size = 10
            for i in range(0, len(lockers), chunk_size):
                chunk = lockers[i:i+chunk_size]
                locker_tasks = [apply_to_locker(l) for l in chunk]
                outcomes = await asyncio.gather(*locker_tasks)
                backend_results["success"] += outcomes.count(True)
                backend_results["failed"] += outcomes.count(False)
                
        except Exception as e:
             total_results["errors"].append(f"Error processing backend {backend_id}: {str(e)}")
             
        return backend_results

    # Run backends in parallel
    backend_tasks = [apply_to_backend(b) for b in enabled_backends]
    results_list = await asyncio.gather(*backend_tasks)
    
    # Aggregate results
    for r in results_list:
        total_results["total_lockers"] += r["total"]
        total_results["success"] += r["success"]
        total_results["failed"] += r["failed"]

    # Save config to persistent storage after applying
    try:
        save_global_config(config)
    except Exception as e:
        import logging
        logging.error(f"Failed to save config to storage: {e}")

    return {"success": True, "data": total_results}
