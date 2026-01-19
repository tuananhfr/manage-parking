"""
Cleanup routes - Configuration and execution of automatic file cleanup
"""
import logging
import yaml
from fastapi import APIRouter, HTTPException

from core.cleanup_scheduler import CleanupScheduler

router = APIRouter(prefix="/api/cleanup", tags=["cleanup"])

# Cleanup scheduler instance (will be set by main app)
cleanup_scheduler: CleanupScheduler = None


def set_cleanup_scheduler(scheduler: CleanupScheduler):
    """Set the cleanup scheduler instance (called by main app.py)"""
    global cleanup_scheduler
    cleanup_scheduler = scheduler


@router.get("/config")
async def get_cleanup_config():
    """Get current cleanup configuration"""
    try:
        config_path = "config.yaml"
        with open(config_path, 'r', encoding='utf-8') as f:
            cfg = yaml.safe_load(f)

        cleanup_cfg = cfg.get('cleanup', {})

        return {
            "success": True,
            "config": {
                "enabled": cleanup_cfg.get("enabled", True),
                "recordings_retention_days": cleanup_cfg.get("recordings_retention_days", 30),
                "timelapse_retention_days": cleanup_cfg.get("timelapse_retention_days", 90),
                "schedule": cleanup_cfg.get("schedule", "03:00")
            }
        }
    except Exception as e:
        logging.error(f"[API] Failed to get cleanup config: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to get cleanup config: {e}")


@router.put("/config")
async def update_cleanup_config(
    recordings_retention_days: int,
    timelapse_retention_days: int,
    enabled: bool = True,
    schedule: str = "03:00"
):
    """
    Update cleanup configuration.
    Called by backend-central to broadcast config changes to all NVRs.
    """
    try:
        # Validate inputs
        if recordings_retention_days < 1 or recordings_retention_days > 3650:
            raise HTTPException(
                status_code=400,
                detail="recordings_retention_days must be between 1 and 3650"
            )

        if timelapse_retention_days < 1 or timelapse_retention_days > 3650:
            raise HTTPException(
                status_code=400,
                detail="timelapse_retention_days must be between 1 and 3650"
            )

        # Validate schedule format (HH:MM)
        try:
            h, m = schedule.split(":")
            if len(h) != 2 or len(m) != 2:
                raise ValueError()
            int(h), int(m)
        except:
            raise HTTPException(status_code=400, detail="schedule must be in HH:MM format")

        # Load current config
        config_path = "config.yaml"
        with open(config_path, 'r', encoding='utf-8') as f:
            cfg = yaml.safe_load(f)

        # Update cleanup section
        if 'cleanup' not in cfg:
            cfg['cleanup'] = {}

        cfg['cleanup']['enabled'] = enabled
        cfg['cleanup']['recordings_retention_days'] = recordings_retention_days
        cfg['cleanup']['timelapse_retention_days'] = timelapse_retention_days
        cfg['cleanup']['schedule'] = schedule

        # Save config
        with open(config_path, 'w', encoding='utf-8') as f:
            yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True)

        logging.info(
            f"[API] Cleanup config updated: "
            f"recordings={recordings_retention_days}d, "
            f"timelapse={timelapse_retention_days}d"
        )

        return {
            "success": True,
            "config": cfg['cleanup']
        }
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"[API] Failed to update cleanup config: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update cleanup config: {e}")


@router.post("/execute")
async def execute_cleanup():
    """
    Execute cleanup immediately (manual trigger).
    Also called automatically by scheduler based on schedule.
    """
    try:
        if cleanup_scheduler is None:
            raise HTTPException(status_code=503, detail="Cleanup scheduler not initialized")

        # Execute cleanup in background
        cleanup_scheduler.execute_now()

        return {
            "success": True,
            "message": "Cleanup execution started"
        }
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"[API] Failed to execute cleanup: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to execute cleanup: {e}")
