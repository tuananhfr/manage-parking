"""
Report routes for sending reports to Drupal
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime
from urllib.parse import urlparse
import httpx
import json
import logging
import importlib
import os

from routes.auth_routes import load_drupal_session


router = APIRouter(prefix="/api/reports", tags=["reports"])


class TrafficFlowReportRequest(BaseModel):
    date: str  # Date in format "YYYY-MM-DD HH:mm:ss"
    data: Dict[str, Any]  # Report data (e.g., {"in": 150, "out": 140})


async def _get_drupal_csrf_token(client: httpx.AsyncClient, drupal_base_url: str) -> Optional[str]:
    """Get CSRF token from Drupal"""
    try:
        resp = await client.get(f"{drupal_base_url}/session/token")
        if resp.status_code == 200:
            return resp.text
        return None
    except Exception as e:
        logging.error(f"Failed to get CSRF token: {e}")
        return None


def _get_report_api_url() -> str:
    """Get report API URL from config"""
    import config
    importlib.reload(config)
    return getattr(config, "REPORT_API_URL", "")


def _get_today_records():
    """Get all records from today (entry or exit happened today)"""
    from database import CentralDatabase
    import sqlite3
    
    db = CentralDatabase()
    today = datetime.now().strftime("%Y-%m-%d")
    
    with db.lock:
        conn = sqlite3.connect(db.db_file)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Get records where:
        # 1. entry_time is today, OR
        # 2. exit_time is today, OR
        # 3. Still parked (status=IN, exit_time IS NULL) - even if entered on previous days
        cursor.execute("""
            SELECT * FROM history
            WHERE DATE(entry_time) = DATE(?)
               OR (exit_time IS NOT NULL AND DATE(exit_time) = DATE(?))
               OR (status = 'IN' AND exit_time IS NULL)
            ORDER BY entry_time DESC
        """, (today, today))
        
        results = cursor.fetchall()
        
        # Get summary stats
        cursor.execute("""
            SELECT COUNT(*) FROM history
            WHERE DATE(entry_time) = DATE(?)
        """, (today,))
        total_in = cursor.fetchone()[0]
        
        cursor.execute("""
            SELECT COUNT(*) FROM history
            WHERE status = 'OUT' AND DATE(exit_time) = DATE(?)
        """, (today,))
        total_out = cursor.fetchone()[0]
        
        cursor.execute("""
            SELECT COUNT(*) FROM history
            WHERE status = 'IN' AND exit_time IS NULL
        """)
        total_parked = cursor.fetchone()[0]
        
        conn.close()
    
    records = []
    for row in results:
        r = dict(row)
        records.append({
            "plate_id": r.get("plate_id"),
            "plate_view": r.get("plate_view"),
            "entry_time": r.get("entry_time"),
            "entry_camera": r.get("entry_camera_name"),
            "exit_time": r.get("exit_time"),
            "exit_camera": r.get("exit_camera_name"),
            "location": r.get("last_location"),
            "location_time": r.get("last_location_time"),
            "duration": r.get("duration"),
            "status": r.get("status"),
            "is_anomaly": bool(r.get("is_anomaly")),
            "customer_type": r.get("customer_type", "guest")
        })
    
    return {
        "date": today,
        "summary": {
            "total_in": total_in,
            "total_out": total_out,
            "total_parked": total_parked
        },
        "records": records
    }


@router.post("/send-today")
async def send_today_traffic_report():
    """
    Fetch today's records from database and send to Drupal.
    Includes summary (total_in, total_out, total_parked) and all record details.
    """
    # Get URL from config
    patch_url = _get_report_api_url()
    if not patch_url:
        raise HTTPException(status_code=400, detail="REPORT_API_URL not configured. Please set it in Settings.")
    
    # Ensure _format=json in URL
    if "_format=json" not in patch_url:
        patch_url = patch_url + ("&" if "?" in patch_url else "?") + "_format=json"
    
    # Extract base URL for CSRF token
    parsed = urlparse(patch_url)
    drupal_base_url = f"{parsed.scheme}://{parsed.netloc}"
    
    # Load Drupal session
    cookies = load_drupal_session()
    if not cookies:
        raise HTTPException(status_code=401, detail="No Drupal session found. Please login first.")
    
    # Get today's data from database
    report_data = _get_today_records()
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d %H:%M:%S")
    
    try:
        async with httpx.AsyncClient(timeout=60.0, cookies=cookies) as client:
            # Get CSRF token
            csrf_token = await _get_drupal_csrf_token(client, drupal_base_url)
            if not csrf_token:
                raise HTTPException(status_code=401, detail="Failed to get Drupal CSRF token")
            
            # Build PATCH payload
            payload = {
                "type": [{"target_id": "report"}],
                "field_traffic_flow_report": [
                    {
                        "date": date_str,
                        "data": json.dumps(report_data, ensure_ascii=False)
                    }
                ]
            }
            
            headers = {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf_token
            }
            
            logging.info(f"[Traffic Report] Sending today's report to {patch_url}")
            logging.info(f"[Traffic Report] Summary: {report_data['summary']}, Records: {len(report_data['records'])}")
            
            resp = await client.patch(patch_url, json=payload, headers=headers)
            
            if resp.status_code not in (200, 201):
                error_text = resp.text[:500] if resp.text else "Unknown error"
                logging.error(f"[Traffic Report] Drupal PATCH failed: {resp.status_code} - {error_text}")
                raise HTTPException(
                    status_code=502,
                    detail=f"Drupal update failed: {resp.status_code} - {error_text}"
                )
            
            logging.info(f"[Traffic Report] Successfully sent today's report")
            
            return {
                "success": True,
                "url": patch_url,
                "date": report_data["date"],
                "summary": report_data["summary"],
                "records_count": len(report_data["records"]),
                "message": "Traffic flow report sent successfully"
            }
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logging.error(f"[Traffic Report] Error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/traffic-flow")
async def update_traffic_flow_report(request: TrafficFlowReportRequest):
    """
    Update field_traffic_flow_report on a Drupal node.
    Uses REPORT_API_URL from config (e.g., https://paristechno.vn/node/131?_format=json)
    """
    # Get URL from config
    patch_url = _get_report_api_url()
    if not patch_url:
        raise HTTPException(status_code=400, detail="REPORT_API_URL not configured. Please set it in Settings.")
    
    # Ensure _format=json in URL
    if "_format=json" not in patch_url:
        patch_url = patch_url + ("&" if "?" in patch_url else "?") + "_format=json"
    
    # Extract base URL for CSRF token
    parsed = urlparse(patch_url)
    drupal_base_url = f"{parsed.scheme}://{parsed.netloc}"
    
    # Load Drupal session
    cookies = load_drupal_session()
    if not cookies:
        raise HTTPException(status_code=401, detail="No Drupal session found. Please login first.")
    
    try:
        async with httpx.AsyncClient(timeout=30.0, cookies=cookies) as client:
            # Get CSRF token
            csrf_token = await _get_drupal_csrf_token(client, drupal_base_url)
            if not csrf_token:
                raise HTTPException(status_code=401, detail="Failed to get Drupal CSRF token")
            
            # Build PATCH payload - include type for Drupal requirement
            payload = {
                "type": [{"target_id": "report"}],
                "field_traffic_flow_report": [
                    {
                        "date": request.date,
                        "data": json.dumps(request.data, ensure_ascii=False)
                    }
                ]
            }
            
            headers = {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf_token
            }
            
            logging.info(f"[Traffic Report] PATCH {patch_url}")
            logging.info(f"[Traffic Report] Payload: {payload}")
            
            resp = await client.patch(patch_url, json=payload, headers=headers)
            
            if resp.status_code not in (200, 201):
                error_text = resp.text[:500] if resp.text else "Unknown error"
                logging.error(f"[Traffic Report] Drupal PATCH failed: {resp.status_code} - {error_text}")
                raise HTTPException(
                    status_code=502,
                    detail=f"Drupal update failed: {resp.status_code} - {error_text}"
                )
            
            result = resp.json()
            logging.info(f"[Traffic Report] Successfully updated: {patch_url}")
            
            return {
                "success": True,
                "url": patch_url,
                "message": "Traffic flow report updated successfully"
            }
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logging.error(f"[Traffic Report] Error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/shift")
async def update_shift_report(request: TrafficFlowReportRequest):
    """
    Update field_shift_report on a Drupal node.
    """
    patch_url = _get_report_api_url()
    if not patch_url:
        raise HTTPException(status_code=400, detail="REPORT_API_URL not configured.")
    
    if "_format=json" not in patch_url:
        patch_url = patch_url + ("&" if "?" in patch_url else "?") + "_format=json"
    
    parsed = urlparse(patch_url)
    drupal_base_url = f"{parsed.scheme}://{parsed.netloc}"
    
    cookies = load_drupal_session()
    if not cookies:
        raise HTTPException(status_code=401, detail="No Drupal session found. Please login first.")
    
    try:
        async with httpx.AsyncClient(timeout=30.0, cookies=cookies) as client:
            csrf_token = await _get_drupal_csrf_token(client, drupal_base_url)
            if not csrf_token:
                raise HTTPException(status_code=401, detail="Failed to get Drupal CSRF token")
            
            payload = {
                "type": [{"target_id": "report"}],
                "field_shift_report": [
                    {
                        "date": request.date,
                        "data": json.dumps(request.data, ensure_ascii=False)
                    }
                ]
            }
            
            headers = {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf_token
            }
            
            resp = await client.patch(patch_url, json=payload, headers=headers)
            
            if resp.status_code not in (200, 201):
                error_text = resp.text[:500] if resp.text else "Unknown error"
                raise HTTPException(status_code=502, detail=f"Drupal update failed: {resp.status_code}")
            
            return {
                "success": True,
                "url": patch_url,
                "message": "Shift report updated successfully"
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/parking-lock")
async def update_parking_lock_report(request: TrafficFlowReportRequest):
    """
    Update field_parking_lock_report on a Drupal node.
    """
    patch_url = _get_report_api_url()
    if not patch_url:
        raise HTTPException(status_code=400, detail="REPORT_API_URL not configured.")
    
    if "_format=json" not in patch_url:
        patch_url = patch_url + ("&" if "?" in patch_url else "?") + "_format=json"
    
    parsed = urlparse(patch_url)
    drupal_base_url = f"{parsed.scheme}://{parsed.netloc}"
    
    cookies = load_drupal_session()
    if not cookies:
        raise HTTPException(status_code=401, detail="No Drupal session found. Please login first.")
    
    try:
        async with httpx.AsyncClient(timeout=30.0, cookies=cookies) as client:
            csrf_token = await _get_drupal_csrf_token(client, drupal_base_url)
            if not csrf_token:
                raise HTTPException(status_code=401, detail="Failed to get Drupal CSRF token")
            
            payload = {
                "type": [{"target_id": "report"}],
                "field_parking_lock_report": [
                    {
                        "date": request.date,
                        "data": json.dumps(request.data, ensure_ascii=False)
                    }
                ]
            }
            
            headers = {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf_token
            }
            
            resp = await client.patch(patch_url, json=payload, headers=headers)
            
            if resp.status_code not in (200, 201):
                error_text = resp.text[:500] if resp.text else "Unknown error"
                raise HTTPException(status_code=502, detail=f"Drupal update failed: {resp.status_code}")
            
            return {
                "success": True,
                "url": patch_url,
                "message": "Parking lock report updated successfully"
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/send-shift/{log_id}")
async def send_shift_report(log_id: str):
    """
    Send a specific completed shift report to Drupal.
    """
    from routes.auth_routes import load_work_logs
    
    logs = load_work_logs()
    log = next((l for l in logs if l["id"] == log_id), None)
    
    if not log:
        raise HTTPException(status_code=404, detail="Shift log not found")
    
    if log["status"] != "completed" or not log.get("details"):
        raise HTTPException(status_code=400, detail="Shift is not completed or missing details")
    
    # Format date: 'end_time' is ISO. Convert to 'YYYY-MM-DD HH:MM:SS'
    date_str = log["end_time"].replace("T", " ").split(".")[0] if log.get("end_time") else datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Reuse existing update_shift_report logic
    req = TrafficFlowReportRequest(
        date=date_str,
        data=log["details"]
    )
    
    return await update_shift_report(req)


@router.post("/send-today-shifts")
async def send_today_shifts():
    """
    Send ALL completed shift reports for TODAY to Drupal.
    """
    from routes.auth_routes import load_work_logs
    
    # Get today's date string matching log end_time format start (YYYY-MM-DD)
    today_str = datetime.now().strftime("%Y-%m-%d")
    
    logs = load_work_logs()
    
    # Filter: Status completed AND end_time starts with today
    todays_logs = [
        l for l in logs 
        if l.get("status") == "completed" 
        and l.get("end_time") 
        and l["end_time"].startswith(today_str)
    ]
    
    if not todays_logs:
        return {
            "success": False, 
            "message": "Không có ca trực nào đã hoàn thành trong hôm nay"
        }

    # Prepare configuration and session
    patch_url = _get_report_api_url()
    if not patch_url:
        raise HTTPException(status_code=400, detail="REPORT_API_URL not configured.")
    
    if "_format=json" not in patch_url:
        patch_url = patch_url + ("&" if "?" in patch_url else "?") + "_format=json"
    
    parsed = urlparse(patch_url)
    drupal_base_url = f"{parsed.scheme}://{parsed.netloc}"
    
    cookies = load_drupal_session()
    if not cookies:
        raise HTTPException(status_code=401, detail="No Drupal session found. Please login first.")

    # Build report items
    report_items = []
    for log in todays_logs:
        # Format date: '2026-01-16T13:47:23.554461' -> '2026-01-16 13:47:23'
        date_str = log["end_time"].replace("T", " ").split(".")[0]
        
        report_items.append({
            "date": date_str,
            "data": json.dumps(log.get("details") or {}, ensure_ascii=False)
        })

    try:
        async with httpx.AsyncClient(timeout=60.0, cookies=cookies) as client:
            csrf_token = await _get_drupal_csrf_token(client, drupal_base_url)
            if not csrf_token:
                raise HTTPException(status_code=401, detail="Failed to get Drupal CSRF token")
            
            payload = {
                "type": [{"target_id": "report"}],
                "field_shift_report": report_items
            }
            
            headers = {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf_token
            }
            
            logging.info(f"[Shift Report] Sending {len(report_items)} shifts to {patch_url}")
            resp = await client.patch(patch_url, json=payload, headers=headers)
            
            if resp.status_code not in (200, 201):
                error_text = resp.text[:500] if resp.text else "Unknown error"
                raise HTTPException(status_code=502, detail=f"Drupal update failed: {resp.status_code} - {error_text}")
            
            return {
                "success": True,
                "count": len(report_items),
                "message": f"Đã gửi thành công {len(report_items)} báo cáo ca trực"
            }
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logging.error(f"[Shift Report] Error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


PARKING_REPORT_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "parking_lock_reports.json")

@router.post("/send-parking-lock-today")
async def send_parking_lock_today_report():
    """
    Aggregate stats from all parking lock backends (Today), 
    save snapshot to local JSON, and send to Drupal.
    """
    from routes.parking_lock_proxy_routes import get_detailed_report_data
    
    # 1. Define time range (Today)
    now = datetime.now()
    start_date = now.strftime("%Y-%m-%d 00:00:00")
    end_date = now.strftime("%Y-%m-%d 23:59:59")
    date_formatted = now.strftime("%Y-%m-%d %H:%M:%S")
    
    # 2. Aggregate Stats
    try:
        details = await get_detailed_report_data(start_date=start_date, end_date=end_date)
        
        # Calculate Summary locally
        total_revenue = 0
        total_sessions = 0
        
        for b in details:
            total_revenue += b.get("total_revenue", 0)
            for d in b.get("devices", []):
                for l in d.get("lockers", []):
                    total_sessions += l.get("sessions", 0)
        
        stats = {
            "total_revenue": total_revenue,
            "total_sessions": total_sessions
        }
        
    except Exception as e:
         raise HTTPException(status_code=500, detail=f"Failed to aggregate stats: {e}")

    # 3. Create Report Entry
    report_entry = {
         "id": int(now.timestamp() * 1000),
         "date": now.strftime("%Y-%m-%d"),
         "created_at": date_formatted,
         "stats": stats,
         "details": details
    }

    # 4. Save Snapshot to File
    try:
        os.makedirs(os.path.dirname(PARKING_REPORT_FILE), exist_ok=True)
        reports = []
        if os.path.exists(PARKING_REPORT_FILE):
             try:
                 with open(PARKING_REPORT_FILE, 'r', encoding='utf-8') as f:
                     reports = json.load(f)
             except:
                 reports = []
        
        reports.append(report_entry)
        
        with open(PARKING_REPORT_FILE, 'w', encoding='utf-8') as f:
            json.dump(reports, f, ensure_ascii=False, indent=2)
            
    except Exception as e:
        logging.error(f"[Parking Report] Failed to save snapshot: {e}")
        # Continue to send even if save fails? Yes.

    # 5. Send to Drupal
    patch_url = _get_report_api_url()
    if not patch_url:
        return {
            "success": True, 
            "message": "Report saved locally but NOT sent (URL not configured)",
            "data": report_entry
        }

    if "_format=json" not in patch_url:
        patch_url = patch_url + ("&" if "?" in patch_url else "?") + "_format=json"
    
    parsed = urlparse(patch_url)
    drupal_base_url = f"{parsed.scheme}://{parsed.netloc}"
    
    cookies = load_drupal_session()
    if not cookies:
         return {
            "success": True, 
            "message": "Report saved locally but NOT sent (No Drupal session)",
            "data": report_entry
        }

    try:
        async with httpx.AsyncClient(timeout=60.0, cookies=cookies) as client:
            csrf_token = await _get_drupal_csrf_token(client, drupal_base_url)
            if not csrf_token:
                raise HTTPException(status_code=401, detail="Failed to get Drupal CSRF token")
            
            # Use 'data' field to store the stats JSON
            payload = {
                "type": [{"target_id": "report"}],
                "field_parking_lock_report": [
                    {
                        "date": date_formatted,
                        "data": json.dumps(report_entry, ensure_ascii=False)
                    }
                ]
            }
            
            headers = {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf_token
            }
            
            resp = await client.patch(patch_url, json=payload, headers=headers)
            
            if resp.status_code not in (200, 201):
                error_text = resp.text[:500] if resp.text else "Unknown error"
                raise HTTPException(status_code=502, detail=f"Drupal update failed: {resp.status_code} - {error_text}")
            
            return {
                "success": True,
                "message": "Đã gửi báo cáo Parking Lock thành công",
                "data": report_entry
            }
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/send-daily")
async def send_daily_report():
    """
    Create a new Drupal node containing all 3 report types for today:
    - Traffic flow report
    - Shift reports
    - Parking lock report
    
    Uses POST (create node) instead of PATCH (update existing).
    """
    from routes.auth_routes import load_work_logs
    from routes.parking_lock_proxy_routes import get_detailed_report_data
    
    now = datetime.now()
    date_formatted = now.strftime("%Y-%m-%d %H:%M:%S")
    today_str = now.strftime("%Y-%m-%d")
    
    # Get API URL from config
    post_url = _get_report_api_url()
    if not post_url:
        raise HTTPException(status_code=400, detail="REPORT_API_URL not configured. Please set it in Settings.")
    
    # Ensure _format=json in URL
    if "_format=json" not in post_url:
        post_url = post_url + ("&" if "?" in post_url else "?") + "_format=json"
    
    # Extract base URL for CSRF token
    parsed = urlparse(post_url)
    drupal_base_url = f"{parsed.scheme}://{parsed.netloc}"
    
    # Load Drupal session
    cookies = load_drupal_session()
    if not cookies:
        raise HTTPException(status_code=401, detail="No Drupal session found. Please login first.")
    
    # ========== 1. Traffic Flow Report ==========
    traffic_data = _get_today_records()
    traffic_report = {
        "date": date_formatted,
        "data": json.dumps(traffic_data, ensure_ascii=False)
    }
    
    # ========== 2. Shift Reports ==========
    logs = load_work_logs()
    todays_logs = [
        l for l in logs 
        if l.get("status") == "completed" 
        and l.get("end_time") 
        and l["end_time"].startswith(today_str)
    ]
    
    shift_reports = []
    for log in todays_logs:
        date_str = log["end_time"].replace("T", " ").split(".")[0]
        # Include full log data, not just details
        shift_data = {
            "id": log.get("id"),
            "user_id": log.get("user_id"),
            "user_name": log.get("user_name"),
            "start_time": log.get("start_time"),
            "end_time": log.get("end_time"),
            "status": log.get("status"),
            "stats": log.get("stats", {}),
            "handover": log.get("handover", {}),
            "details": log.get("details", {})
        }
        shift_reports.append({
            "date": date_str,
            "data": json.dumps(shift_data, ensure_ascii=False)
        })
    
    # If no shifts today, still include empty array
    if not shift_reports:
        shift_reports = [{
            "date": date_formatted,
            "data": json.dumps({"message": "Không có ca trực nào hoàn thành hôm nay"}, ensure_ascii=False)
        }]
    
    # ========== 3. Parking Lock Report ==========
    start_date = now.strftime("%Y-%m-%d 00:00:00")
    end_date = now.strftime("%Y-%m-%d 23:59:59")
    
    try:
        details = await get_detailed_report_data(start_date=start_date, end_date=end_date)
        
        total_revenue = 0
        total_sessions = 0
        for b in details:
            total_revenue += b.get("total_revenue", 0)
            for d in b.get("devices", []):
                for l in d.get("lockers", []):
                    total_sessions += l.get("sessions", 0)
        
        parking_entry = {
            "id": int(now.timestamp() * 1000),
            "date": today_str,
            "created_at": date_formatted,
            "stats": {"total_revenue": total_revenue, "total_sessions": total_sessions},
            "details": details
        }
    except Exception as e:
        logging.warning(f"[Daily Report] Failed to get parking lock data: {e}")
        parking_entry = {
            "date": today_str,
            "created_at": date_formatted,
            "stats": {"total_revenue": 0, "total_sessions": 0},
            "error": str(e)
        }
    
    parking_report = {
        "date": date_formatted,
        "data": json.dumps(parking_entry, ensure_ascii=False)
    }
    
    # Save parking snapshot locally
    try:
        os.makedirs(os.path.dirname(PARKING_REPORT_FILE), exist_ok=True)
        reports = []
        if os.path.exists(PARKING_REPORT_FILE):
            try:
                with open(PARKING_REPORT_FILE, 'r', encoding='utf-8') as f:
                    reports = json.load(f)
            except:
                reports = []
        reports.append(parking_entry)
        with open(PARKING_REPORT_FILE, 'w', encoding='utf-8') as f:
            json.dump(reports, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logging.error(f"[Daily Report] Failed to save parking snapshot: {e}")
    
    # ========== POST to Drupal ==========
    try:
        async with httpx.AsyncClient(timeout=60.0, cookies=cookies) as client:
            csrf_token = await _get_drupal_csrf_token(client, drupal_base_url)
            if not csrf_token:
                raise HTTPException(status_code=401, detail="Failed to get Drupal CSRF token")
            
            # Build POST payload for creating new node
            payload = {
                "type": [{"target_id": "report"}],
                "title": [{"value": f"Báo cáo {today_str}"}],
                "field_traffic_flow_report": [traffic_report],
                "field_shift_report": shift_reports,
                "field_parking_lock_report": [parking_report]
            }
            
            headers = {
                "Content-Type": "application/json",
                "X-CSRF-Token": csrf_token
            }
            
            logging.info(f"[Daily Report] POST to {post_url}")
            logging.info(f"[Daily Report] Traffic: {traffic_data['summary']}, Shifts: {len(shift_reports)}, Parking: {parking_entry.get('stats', {})}")
            
            resp = await client.post(post_url, json=payload, headers=headers)
            
            if resp.status_code not in (200, 201):
                error_text = resp.text[:500] if resp.text else "Unknown error"
                logging.error(f"[Daily Report] Drupal POST failed: {resp.status_code} - {error_text}")
                raise HTTPException(
                    status_code=502,
                    detail=f"Drupal create failed: {resp.status_code} - {error_text}"
                )
            
            result = resp.json()
            node_id = result.get("nid", [{}])[0].get("value", "unknown")
            
            logging.info(f"[Daily Report] Successfully created node {node_id}")
            
            return {
                "success": True,
                "node_id": node_id,
                "url": post_url,
                "date": today_str,
                "summary": {
                    "traffic": traffic_data["summary"],
                    "shifts_count": len(shift_reports),
                    "parking": parking_entry.get("stats", {})
                },
                "message": f"Đã tạo báo cáo thành công (Node #{node_id})"
            }
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        logging.error(f"[Daily Report] Error: {e}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

