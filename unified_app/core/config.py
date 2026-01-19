"""
Config management module
"""
import os
import threading
import logging
import time
from pathlib import Path
from typing import Dict
from tempfile import NamedTemporaryFile
import yaml

# Config path: unified_app/config.yaml (parent của core/)
CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.yaml"
DEFAULT_CONFIG = {"streams": {}, "metadata": {}}

# Global lock cho config writes
_config_lock = threading.Lock()


def load_config() -> dict:
    """Load config từ YAML file"""
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(yaml.safe_dump(DEFAULT_CONFIG, sort_keys=False), encoding="utf-8")
        return DEFAULT_CONFIG.copy()
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    # Handle YAML empty keys (e.g., "streams:" without value returns None, not missing key)
    if data.get("streams") is None:
        data["streams"] = {}
    if data.get("metadata") is None:
        data["metadata"] = {}
    return data


def save_config(cfg: dict, wait: bool = False) -> bool:
    """
    Save config to YAML file with atomic write

    Args:
        cfg: Config dictionary to save
        wait: If True, wait for save to complete (synchronous).
              If False, save in background thread (async, default).

    Returns:
        True if save succeeded, False if failed (only meaningful when wait=True)

    Uses temp file + os.replace() for atomic write to prevent corruption
    Thread-safe with global lock
    """
    save_success = [True]  # Use list to allow modification in nested function
    
    def _save():
        try:
            with _config_lock:
                # Write to temp file first
                with NamedTemporaryFile(mode='w', encoding='utf-8', delete=False,
                                       dir=CONFIG_PATH.parent, suffix='.tmp') as tmp:
                    yaml.safe_dump(cfg, tmp, sort_keys=False, allow_unicode=True)
                    tmp.flush()
                    os.fsync(tmp.fileno())
                    tmp_path = tmp.name

                # Thử atomic replace trước (an toàn hơn)
                # Nếu fail do Windows file lock → fallback sang direct write
                try:
                    os.replace(tmp_path, CONFIG_PATH)
                    logging.debug("Config saved successfully (atomic)")
                    return
                except PermissionError:
                    # Windows file lock - fallback to direct write
                    logging.warning("Atomic replace failed, using direct write...")
                    try:
                        os.remove(tmp_path)  # Cleanup temp file
                    except:
                        pass

                    # Direct write với retry
                    max_retries = 5
                    retry_delay = 0.2
                    for attempt in range(max_retries):
                        try:
                            with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
                                yaml.safe_dump(cfg, f, sort_keys=False, allow_unicode=True)
                            logging.debug("Config saved successfully (direct write)")
                            return
                        except PermissionError as pe:
                            if attempt < max_retries - 1:
                                delay = retry_delay * (2 ** attempt)
                                logging.warning(f"Permission denied (attempt {attempt + 1}/{max_retries}), retrying in {delay}s...")
                                time.sleep(delay)
                            else:
                                logging.error(f"Failed to save config after {max_retries} attempts: {pe}")
                                raise pe
        except Exception as e:
            logging.error(f"Failed to save config: {e}", exc_info=True)
            save_success[0] = False
            # Clean up temp file if exists
            try:
                if 'tmp_path' in locals() and Path(tmp_path).exists():
                    os.remove(tmp_path)
            except:
                pass

    if wait:
        # Synchronous mode: run immediately and wait for completion
        _save()
        return save_success[0]
    else:
        # Async mode: run in background thread (original behavior)
        thread = threading.Thread(target=_save, daemon=True)
        thread.start()
        return True  # Can't know result in async mode

