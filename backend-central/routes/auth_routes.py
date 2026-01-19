"""
Authentication routes for backend-central
"""
from fastapi import APIRouter, HTTPException, status, Depends
from pydantic import BaseModel
from auth import (
    create_access_token,
    get_current_user
)
import logging
import httpx


router = APIRouter(prefix="/api/auth", tags=["authentication"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    user: dict


from datetime import datetime
import json
import os
import config as config_module
from database import CentralDatabase
from auth import get_user_by_username, load_users

# ... existing code ...

WORK_LOGS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "work_logs.json")
DRUPAL_SESSION_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "drupal_session.json")

def save_drupal_session(cookies: dict):
    """Save Drupal session cookies to file"""
    try:
        with open(DRUPAL_SESSION_FILE, 'w', encoding='utf-8') as f:
            json.dump(cookies, f, ensure_ascii=False, indent=2)
        logging.info(f"[Drupal Session] Saved {len(cookies)} cookies")
    except Exception as e:
        logging.error(f"[Drupal Session] Failed to save: {e}")

def load_drupal_session() -> dict:
    """Load Drupal session cookies from file"""
    try:
        if os.path.exists(DRUPAL_SESSION_FILE):
            with open(DRUPAL_SESSION_FILE, 'r', encoding='utf-8') as f:
                cookies = json.load(f)
            logging.info(f"[Drupal Session] Loaded {len(cookies)} cookies")
            return cookies
    except Exception as e:
        logging.error(f"[Drupal Session] Failed to load: {e}")
    return {}

def load_work_logs():
    if not os.path.exists(WORK_LOGS_FILE):
        return []
    try:
        with open(WORK_LOGS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except:
        return []

def save_work_logs(logs):
    with open(WORK_LOGS_FILE, 'w', encoding='utf-8') as f:
        json.dump(logs, f, ensure_ascii=False, indent=2)

def start_work_session(user: dict):
    """Start a new work session"""
    logs = load_work_logs()
    
    # Close any open sessions for this user (just in case)
    for log in logs:
        if log["user_id"] == user["id"] and log["status"] == "ongoing":
            log["status"] = "force_closed"
            log["end_time"] = datetime.now().isoformat()
            log["notes"] = "System auto-closed due to new login"
            
    new_log = {
        "id": f"{user['id']}_{int(datetime.now().timestamp())}",
        "user_id": user["id"],
        "user_name": user["full_name"],
        "start_time": datetime.now().isoformat(),
        "end_time": None,
        "status": "ongoing",
        "stats": {
            "vehicles_in": None,
            "vehicles_out": None,
            "revenue": None,
            "vehicles_parked": None
        },
        "details": None,
        "handover": None
    }
    logs.append(new_log)
    save_work_logs(logs)
    return new_log["id"]

def end_work_session(user_id: int, handover_data: dict = None):
    """End current work session"""
    logs = load_work_logs()
    found = False
    
    for log in logs:
        if log["user_id"] == user_id and log["status"] == "ongoing":
            end_time = datetime.now().isoformat()
            log["end_time"] = end_time
            log["status"] = "completed"
            
            # Fetch full details from database to freeze the report
            try:
                import sqlite3
                db_path = os.path.join(os.path.dirname(__file__), "..", "data", "central.db")
                start_time = log["start_time"]
                
                conn = sqlite3.connect(db_path)
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                # 1. Fetch Records (Entry OR Exit within shift OR Currently Parked)
                cursor.execute("""
                    SELECT * FROM history
                    WHERE (DATETIME(entry_time) >= DATETIME(?) AND DATETIME(entry_time) <= DATETIME(?))
                       OR (exit_time IS NOT NULL AND DATETIME(exit_time) >= DATETIME(?) AND DATETIME(exit_time) <= DATETIME(?))
                       OR (status = 'IN' AND exit_time IS NULL)
                    ORDER BY entry_time DESC
                """, (start_time, end_time, start_time, end_time))
                records_rows = cursor.fetchall()
                
                records = []
                for row in records_rows:
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
                
                # 2. Calc Stats
                # Vehicles IN during shift
                cursor.execute("""
                    SELECT COUNT(*) FROM history 
                    WHERE DATETIME(entry_time) >= DATETIME(?) 
                    AND DATETIME(entry_time) <= DATETIME(?)
                """, (start_time, end_time))
                count_in = cursor.fetchone()[0]
                
                # Vehicles OUT during shift
                cursor.execute("""
                    SELECT COUNT(*) FROM history 
                    WHERE status='OUT' 
                    AND DATETIME(exit_time) >= DATETIME(?) 
                    AND DATETIME(exit_time) <= DATETIME(?)
                """, (start_time, end_time))
                count_out = cursor.fetchone()[0]
                
                # 3. Fetch Changes History during shift
                cursor.execute("""
                    SELECT * FROM history_changes
                    WHERE DATETIME(changed_at) >= DATETIME(?) 
                    AND DATETIME(changed_at) <= DATETIME(?)
                    ORDER BY changed_at DESC
                """, (start_time, end_time))
                changes_rows = cursor.fetchall()
                changes = [dict(row) for row in changes_rows]
                # Try to parse 'old_data' and 'new_data' json if possible, or leave as string
                import json
                for c in changes:
                    if c.get("old_data") and isinstance(c["old_data"], str):
                        try: c["old_data"] = json.loads(c["old_data"])
                        except: pass
                    if c.get("new_data") and isinstance(c["new_data"], str):
                        try: c["new_data"] = json.loads(c["new_data"])
                        except: pass

                # Vehicles currently parked (snapshot at end of shift)
                cursor.execute("SELECT COUNT(*) FROM history WHERE status='IN' AND exit_time IS NULL")
                count_parked = cursor.fetchone()[0]
                
                conn.close()
                
                # Store in log
                log["stats"] = {
                    "vehicles_in": count_in,
                    "vehicles_out": count_out,
                    "revenue": 0,
                    "vehicles_parked": count_parked
                }
                
                log["details"] = {
                    "date": start_time[:10],
                    "summary": log["stats"],
                    "records": records,
                    "changes": changes
                }
                

                
            except Exception as e:
                logging.error(f"Error generating final report for log {log['id']}: {e}")
                
            if handover_data:
                log["handover"] = handover_data
            
            found = True
            break
            
    if found:
        save_work_logs(logs)



async def sync_staff_from_api(client: httpx.AsyncClient):
    """
    Fetch staff/shift data from configured STAFF_API_URL and save to staff.json.
    Uses the authenticated httpx client session (with cookies from Drupal login).
    """
    try:
        import importlib
        importlib.reload(config_module)
        
        staff_api_url = config_module.STAFF_API_URL
        staff_json_file = config_module.STAFF_JSON_FILE
        
        if not staff_api_url or not staff_api_url.strip():
            logging.info("STAFF_API_URL not configured, skipping staff sync")
            return
        
        logging.info(f"Syncing staff from API: {staff_api_url}")
        
        # Call API with session cookies
        resp = await client.get(staff_api_url, timeout=10.0)
        
        if resp.status_code != 200:
            logging.warning(f"Staff API returned status {resp.status_code}")
            return
        
        api_data = resp.json()
        
        # API could return list directly or wrapped object
        shift_list = api_data if isinstance(api_data, list) else api_data.get("data", [])
        
        # Load existing staff.json to preserve IDs and phone numbers
        staff_file_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), staff_json_file)
        existing_staff = []
        if os.path.exists(staff_file_path):
            with open(staff_file_path, 'r', encoding='utf-8') as f:
                existing_staff = json.load(f)
        
        # Create lookup by name
        existing_by_name = {s.get("name", "").lower(): s for s in existing_staff}
        
        # Load users.json for ID lookup
        users_data = load_users()
        users_by_name = {u.get("username", "").lower(): u for u in users_data.get("users", [])}
        
        # Transform API data to staff.json format
        new_staff_list = []
        next_id = max([s.get("id", 0) for s in existing_staff], default=0) + 1
        
        for shift in shift_list:
            username = shift.get("name", "") or shift.get("field_user", "")
            if not username:
                continue
            
            username_lower = username.lower()
            
            # Determine ID
            staff_id = None
            if username_lower in existing_by_name:
                staff_id = existing_by_name[username_lower].get("id")
            elif username_lower in users_by_name:
                staff_id = users_by_name[username_lower].get("id")
            
            if staff_id is None:
                staff_id = next_id
                next_id += 1
            
            # Map position from roles
            role = shift.get("roles_target_id", "")
            position = "Quản lý" if role.lower() == "administrator" else "Bảo vệ"
            
            # Preserve phone if exists
            phone = existing_by_name.get(username_lower, {}).get("phone", "")
            
            # Shift title
            shift_title = shift.get("title", "")
            
            new_staff_list.append({
                "id": staff_id,
                "name": username,
                "position": position,
                "phone": phone,
                "shift": shift_title,
                "status": "inactive"  # Login handler will set current user to active
            })
        
        # Save to staff.json
        with open(staff_file_path, 'w', encoding='utf-8') as f:
            json.dump(new_staff_list, f, ensure_ascii=False, indent=2)
        
        logging.info(f"Synced {len(new_staff_list)} staff entries from API")
        
    except Exception as e:
        logging.error(f"Failed to sync staff from API: {e}")
        import traceback
        traceback.print_exc()

@router.post("/login", response_model=LoginResponse)
async def login(credentials: LoginRequest):
    # Try Drupal Login first
    drupal_url = "https://paristechno.vn/user/login?_format=json"
    drupal_user = None
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                drupal_url, 
                json={"name": credentials.username, "pass": credentials.password},
                headers={"Content-Type": "application/json"}
            )
            
            if resp.status_code == 200:
                data = resp.json()
                drupal_user = data.get("current_user")
                
                # Save session cookies for later use (staff sync, etc.)
                save_drupal_session(dict(client.cookies))
                
                # OPTIMIZATION: Do NOT sync staff on every login.
                # User requested to sync only once/manually.
                # Login only updates status.
                # await sync_staff_from_api(client)
    except Exception as e:
        logging.error(f"Drupal login error: {e}")
        # No fallback - Drupal is the only auth source
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Không thể kết nối đến máy chủ xác thực")
    
    if not drupal_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sai tên đăng nhập hoặc mật khẩu")
    
    # Build user object directly from Drupal response (no file storage)
    role = "guard"
    if "administrator" in drupal_user.get("roles", []):
        role = "manager"
    
    user = {
        "id": int(drupal_user["uid"]),
        "username": drupal_user["name"],
        "full_name": drupal_user["name"],
        "role": role
    }
    
    # Create JWT
    access_token = create_access_token(data={"user_id": user["id"], "username": user["username"], "role": user["role"]})
    
    # Update logic: Staff Active & Start Work Session
    try:
        update_staff_status(user["username"], "active")
        start_work_session(user)
        logging.info(f"Work session started for {user['username']}")
    except Exception as e:
        logging.error(f"Failed to start work session: {e}")
        
    user_data = {
        "id": user["id"],
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"]
    }
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user_data
    }

class LogoutRequest(BaseModel):
    notes: str = ""
    revenue: int = 0
    # Add other handover fields if needed

@router.post("/logout")
async def logout(handover: LogoutRequest = None, current_user: dict = Depends(get_current_user)):
    """
    Logout with optional handover data
    """
    try:
        handover_dict = None
        if handover:
            handover_dict = handover.dict()
            
        update_staff_status(current_user["username"], "inactive")
        end_work_session(current_user["id"], handover_dict)
        
        logging.info(f"User logged out: {current_user['username']} (Session ended)")
    except Exception as e:
        logging.error(f"Failed to process logout payload: {e}")
        
    return {"success": True, "message": "Logged out successfully"}

@router.get("/work-stats/current")
async def get_current_work_stats(current_user: dict = Depends(get_current_user)):
    """
    Calculate stats for the current ongoing session
    """
    logs = load_work_logs()
    current_log = None
    for log in logs:
        if log["user_id"] == current_user["id"] and log["status"] == "ongoing":
            current_log = log
            break
            
    if not current_log:
        return {"active": False, "stats": {}}
        
    start_time_str = current_log["start_time"]
    
    # Calculate stats from Database
    # Query events > start_time
    # This requires access to CentralDatabase
    # We will instantiate a temp db connection or reuse global if available (but global is in app.py)
    # Better to create a new instance or move this logic to a service.
    # For simplicity, we create a new CentralDatabase instance here.
    
    try:
        db = CentralDatabase()
        # count entries
        # This is pseudo-code, assuming db has methods or we run raw sql
        # Actually CentralDatabase has `get_events`.
        # We need to filter by time.
        
        # Let's fetch all events after start_time (Not efficient but works for MVP)
        # Optimziation: Add filter to get_events
        
        # Since get_events might not support time filter efficiently, we do it python side for now
        # or assuming list is not huge. 
        # Actually get_events has limit.
        
        # We need a proper count query.
        # Let's define a helper in CentralDatabase or just raw query here if possible.
        db = CentralDatabase()
        
        # CentralDatabase doesn't expose self.conn, it manages connections internally.
        # We should create a new connection here manually.
        import sqlite3
        conn = sqlite3.connect(db.db_file)
        cursor = conn.cursor()
        
        # Logic đếm IN/OUT trong ca:
        # Dùng `history` table (table of truth): 
        # IN: count records where entry_time >= start_time
        # OUT: count records where exit_time >= start_time (status='OUT')
        
        # 1. Vehicles IN during shift
        cursor.execute("SELECT COUNT(*) FROM history WHERE DATETIME(entry_time) >= DATETIME(?)", (start_time_str,))
        count_in = cursor.fetchone()[0]
        
        # 2. Vehicles OUT during shift
        cursor.execute("SELECT COUNT(*), SUM(fee) FROM history WHERE status='OUT' AND DATETIME(exit_time) >= DATETIME(?)", (start_time_str,))
        row = cursor.fetchone()
        count_out = row[0] or 0
        revenue = row[1] or 0
        
        # 3. Vehicles Currently Parked (Total)
        cursor.execute("SELECT COUNT(*) FROM history WHERE status='IN' AND exit_time IS NULL")
        count_parked = cursor.fetchone()[0]
        
        return {
            "active": True,
            "start_time": start_time_str,
            "current_time": datetime.now().isoformat(),
            "session_id": current_log["id"],
            "stats": {
                "vehicles_in": count_in,
                "vehicles_out": count_out,
                "revenue": revenue,
                "vehicles_parked": count_parked
            }
        }
    except Exception as e:
        logging.error(f"Error calcing stats: {e}")
        return {"active": True, "error": str(e), "stats": {"vehicles_in": 0, "vehicles_out": 0, "revenue": 0, "vehicles_parked": 0}}

@router.get("/work-logs")
async def get_work_logs(current_user: dict = Depends(get_current_user)):
    """
    Get all work logs (Admin only)
    Stats are calculated dynamically based on shift time range
    """
    if current_user.get("role") not in ["admin", "manager"]:
        raise HTTPException(status_code=403, detail="Not authorized")
        
    logs = load_work_logs()
    # Sort by start_time desc
    logs.sort(key=lambda x: x["start_time"], reverse=True)
    
    # Calculate stats for each log dynamically
    try:
        import sqlite3
        db_path = os.path.join(os.path.dirname(__file__), "..", "data", "central.db")
        
        for log in logs:
            # If log is completed and has detailed report stored, use it (frozen data)
            if log.get("status") == "completed" and log.get("details"):
                # Ensure stats are populated from details if missing from top-level
                if not log.get("stats") or log["stats"]["vehicles_in"] == 0:
                     log["stats"] = log["details"].get("summary", log.get("stats"))
                continue

            start_time = log.get("start_time")
            end_time = log.get("end_time") or datetime.now().isoformat()
            
            if start_time:
                try:
                    conn = sqlite3.connect(db_path)
                    cursor = conn.cursor()
                    
                    # Vehicles IN during shift (entry_time within shift range)
                    cursor.execute("""
                        SELECT COUNT(*) FROM history 
                        WHERE DATETIME(entry_time) >= DATETIME(?) 
                        AND DATETIME(entry_time) <= DATETIME(?)
                    """, (start_time, end_time))
                    count_in = cursor.fetchone()[0]
                    
                    # Vehicles OUT during shift (exit_time within shift range)
                    cursor.execute("""
                        SELECT COUNT(*) FROM history 
                        WHERE status='OUT' 
                        AND DATETIME(exit_time) >= DATETIME(?) 
                        AND DATETIME(exit_time) <= DATETIME(?)
                    """, (start_time, end_time))
                    count_out = cursor.fetchone()[0]
                    
                    # Vehicles currently parked (total, not time-filtered)
                    cursor.execute("SELECT COUNT(*) FROM history WHERE status='IN' AND exit_time IS NULL")
                    count_parked = cursor.fetchone()[0]
                    
                    conn.close()
                    
                    log["stats"] = {
                        "vehicles_in": count_in,
                        "vehicles_out": count_out,
                        "revenue": 0,  # Fee is managed by parking lock
                        "vehicles_parked": count_parked
                    }
                except Exception as e:
                    logging.error(f"Error calculating stats for log {log.get('id')}: {e}")
    except Exception as e:
        logging.error(f"Error in work-logs stats calculation: {e}")
    
    return logs



@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """
    Get current authenticated user info.
    """
    return {
        "success": True,
        "user": {
            "id": current_user["id"],
            "username": current_user["username"],
            "full_name": current_user["full_name"],
            "role": current_user["role"]
        }
    }


def update_staff_status(username: str, status_val: str):
    """
    Update status of staff member with matching name in staff.json
    """
    import os
    import json
    
    staff_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "staff.json")
    
    try:
        if not os.path.exists(staff_file):
            return
            
        with open(staff_file, 'r', encoding='utf-8') as f:
            staff_list = json.load(f)
            
        updated = False
        for staff in staff_list:
            # Match by name (case-insensitive)
            if staff.get("name", "").lower() == username.lower():
                staff["status"] = status_val
                updated = True
                
        if updated:
            with open(staff_file, 'w', encoding='utf-8') as f:
                json.dump(staff_list, f, ensure_ascii=False, indent=2)
                
    except Exception as e:
        logging.error(f"Error updating staff file: {e}")
        raise e

