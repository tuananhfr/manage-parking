from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import yaml
import os
import logging

router = APIRouter(prefix="/api/config", tags=["config"])

class CentralConfigUpdate(BaseModel):
    central_url: str

@router.post("/central")
async def update_central_config(config: CentralConfigUpdate):
    """
    Update Central URL in config.yaml
    """
    try:
        config_path = "config.yaml"
        if not os.path.exists(config_path):
            raise HTTPException(status_code=500, detail="config.yaml not found")

        # Load existing config
        with open(config_path, "r", encoding="utf-8") as f:
            yaml_config = yaml.safe_load(f) or {}

        # Update fields
        # Note: We update both 'central.url' and 'target_server' (for OCR) 
        # because usually they are the same server.
        
        # 1. Update central.url
        if "central" not in yaml_config:
            yaml_config["central"] = {}
        
        yaml_config["central"]["url"] = config.central_url
        yaml_config["central"]["enabled"] = True # Auto enable if configured
        
        # 2. Update target_server if it looks like a URL (extract IP/Port)
        # Parse http://192.168.0.48:8000 -> IP: 192.168.0.48, Port: 8000
        try:
            from urllib.parse import urlparse
            parsed = urlparse(config.central_url)
            host = parsed.hostname
            port = parsed.port or 80
            
            if "target_server" not in yaml_config:
                yaml_config["target_server"] = {}
            
            if host:
                yaml_config["target_server"]["ip"] = host
                yaml_config["target_server"]["port"] = port
        except Exception as e:
            logging.warning(f"Failed to parse central_url for target_server update: {e}")

        # Save config
        with open(config_path, "w", encoding="utf-8") as f:
            yaml.dump(yaml_config, f, default_flow_style=False, allow_unicode=True)
            
        logging.info(f"[Config] Updated central URL to {config.central_url}")
        
        # Trigger Hot-Reload
        try:
            # 1. OCR Sender
            from core.ocr_sender import reload_ocr_sender
            reload_ocr_sender()
            
            # 2. Central Sync Service
            from core.central_manager import central_manager
            central_manager.reload_config()
            
            logging.info("[Config] Hot-reloaded OCR Sender and Central Sync")
        except Exception as e:
            logging.error(f"[Config] Failed to hot-reload services: {e}")

        return {
            "success": True, 
            "message": "Config updated. Services reloaded.",
            "central_url": config.central_url
        }

    except Exception as e:
        logging.error(f"[Config] Failed to update config: {e}")
        raise HTTPException(status_code=500, detail=str(e))
