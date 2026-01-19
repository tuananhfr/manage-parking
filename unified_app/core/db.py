"""
Local DB module để lưu log OCR (biển số, thời gian, vị trí).
"""
import sqlite3
import time
import logging
from pathlib import Path
from typing import List, Dict, Any
from contextlib import contextmanager

from .config import load_config


DB_PATH = Path(__file__).resolve().parent.parent / "ocr_logs.db"


@contextmanager
def _get_conn(timeout: float = 10.0, retries: int = 3):
    """
    Get database connection with retry logic

    Args:
        timeout: Database timeout in seconds
        retries: Number of retry attempts

    Yields:
        sqlite3.Connection
    """
    conn = None
    last_error = None

    for attempt in range(retries):
        try:
            conn = sqlite3.connect(DB_PATH, timeout=timeout, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            # Enable WAL mode for better concurrency
            conn.execute("PRAGMA journal_mode=WAL")
            yield conn
            conn.commit()
            return
        except sqlite3.OperationalError as e:
            last_error = e
            if "locked" in str(e).lower() and attempt < retries - 1:
                # Database locked, retry with exponential backoff
                wait_time = 0.1 * (2 ** attempt)
                logging.warning(f"DB locked, retrying in {wait_time}s (attempt {attempt + 1}/{retries})")
                time.sleep(wait_time)
                continue
            raise
        except Exception as e:
            logging.error(f"DB connection error: {e}", exc_info=True)
            raise
        finally:
            if conn:
                conn.close()

    # All retries failed
    if last_error:
        raise last_error


def init_db() -> None:
    """Khởi tạo DB và bảng nếu chưa tồn tại."""
    with _get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ocr_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plate_text TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                camera_id TEXT NOT NULL,
                camera_name TEXT NOT NULL,
                synced INTEGER DEFAULT 0,
                retry_count INTEGER DEFAULT 0
            )
            """
        )

        # Migration: Thêm cột synced và retry_count nếu chưa có (cho DB cũ)
        try:
            cur.execute("ALTER TABLE ocr_logs ADD COLUMN synced INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass  # Cột đã tồn tại

        try:
            cur.execute("ALTER TABLE ocr_logs ADD COLUMN retry_count INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass  # Cột đã tồn tại

        # Migration: Thêm cột camera_type nếu chưa có
        try:
            cur.execute("ALTER TABLE ocr_logs ADD COLUMN camera_type TEXT")
        except sqlite3.OperationalError:
            pass  # Cột đã tồn tại


def insert_ocr_log(camera_id: str, plate_text: str, timestamp: str, camera_type: str = None) -> None:
    """
    Lưu 1 bản ghi OCR vào DB.
    - Tự động lấy camera_name từ config (metadata) nếu không có.
    - Lưu camera_type để retry đúng loại camera.
    """
    if not plate_text:
        return

    cfg = load_config()
    meta = cfg.get("metadata", {}).get(camera_id, {})
    camera_name = meta.get("name") or camera_id
    
    # Nếu không có camera_type, lấy từ config
    if not camera_type:
        camera_type = meta.get("camera_type") or "internal"

    with _get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO ocr_logs (plate_text, timestamp, camera_id, camera_name, camera_type)
            VALUES (?, ?, ?, ?, ?)
            """,
            (plate_text, timestamp, camera_id, camera_name, camera_type),
        )


def get_ocr_logs(limit: int = 200) -> List[Dict[str, Any]]:
    """
    Lấy danh sách log OCR mới nhất.
    Trả về list dict: {id, plate_text, timestamp, camera_id, camera_name}
    """
    with _get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, plate_text, timestamp, camera_id, camera_name
            FROM ocr_logs
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = cur.fetchall()
        return [
            {
                "id": r["id"],
                "plate_text": r["plate_text"],
                "timestamp": r["timestamp"],
                "camera_id": r["camera_id"],
                "camera_name": r["camera_name"],
            }
            for r in rows
        ]


def delete_ocr_log(log_id: int) -> None:
    """
    Xóa 1 bản ghi OCR theo ID.
    """
    with _get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM ocr_logs WHERE id = ?", (log_id,))


def delete_all_ocr_logs() -> int:
    """
    Xóa TẤT CẢ bản ghi OCR.

    Returns:
        Số lượng records đã xóa
    """
    with _get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM ocr_logs")
        count = cur.fetchone()[0]
        cur.execute("DELETE FROM ocr_logs")
        return count


def get_unsynced_logs(limit: int = 100) -> List[Dict[str, Any]]:
    """
    Lấy danh sách log chưa sync (synced=0).

    Returns:
        List of unsynced records
    """
    with _get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, plate_text, timestamp, camera_id, camera_name, camera_type, retry_count
            FROM ocr_logs
            WHERE synced = 0 AND retry_count < 5
            ORDER BY id ASC
            LIMIT ?
            """,
            (limit,),
        )
        rows = cur.fetchall()
        return [
            {
                "id": r["id"],
                "plate_text": r["plate_text"],
                "timestamp": r["timestamp"],
                "camera_id": r["camera_id"],
                "camera_name": r["camera_name"],
                "camera_type": r["camera_type"],  # Có thể là None cho DB cũ
                "retry_count": r["retry_count"],
            }
            for r in rows
        ]


def mark_log_synced(log_id: int) -> None:
    """
    Đánh dấu log đã sync thành công → Xóa khỏi DB.
    """
    with _get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM ocr_logs WHERE id = ?", (log_id,))


def increment_retry_count(log_id: int) -> None:
    """
    Tăng retry_count khi sync fail.
    """
    with _get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE ocr_logs
            SET retry_count = retry_count + 1
            WHERE id = ?
            """,
            (log_id,),
        )


