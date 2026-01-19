"""
Camera Manager module - manages cameras and workers
"""
import logging
import threading
import time
from typing import Dict, Optional, Tuple, List, Union

import numpy as np
from fastapi import HTTPException

from .config import load_config, save_config
from .camera_worker import CameraWorker
from .video_worker import VideoSourceWorker
from .recorder_manager import get_recorder_manager
from api.models import CameraCreate, CameraUpdate, CameraOut


class CameraManager:
    def __init__(self):
        print("[CameraManager] Initializing...", flush=True)
        logging.info("[CameraManager] Initializing...")
        self.cfg = load_config()
        print(f"[CameraManager] Loaded config: {self.cfg.get('streams', {})}", flush=True)
        logging.info(f"[CameraManager] Loaded config: {self.cfg.get('streams', {})}")
        self.workers: Dict[str, Union[CameraWorker, VideoSourceWorker]] = {}
        self.lock = threading.Lock()
        # Recorder manager cho continuous recording (24/7)
        self.recorder_manager = get_recorder_manager()
        print("[CameraManager] Initialization complete", flush=True)
        logging.info("[CameraManager] Initialization complete")
    
    def _emit_camera_list_changed(self):
        """Emit camera list changed signal"""
        try:
            from .events import get_event_emitter
            from PyQt6.QtCore import QTimer
            event_emitter = get_event_emitter()
            
            # Use QTimer.singleShot to schedule emit on main thread loop
            QTimer.singleShot(0, event_emitter.camera_list_changed.emit)
            logging.info(f"[CameraManager] ✅ camera_list_changed signal scheduled via QTimer")
        except Exception as e:
            logging.debug(f"[CameraManager] Failed to emit camera_list_changed: {e}")
    
    def _stop_worker_threads(self, worker):
        """Stop and join all worker threads"""
        worker.stop()
        threads_to_join = [
            ('reader_thread', 2.0),
            ('stream_thread', 2.0),
            ('detector_thread', 2.0),
            ('detection_thread', 2.0),
            ('ocr_thread', 2.0)
        ]
        for thread_attr, timeout in threads_to_join:
            if hasattr(worker, thread_attr):
                thread = getattr(worker, thread_attr, None)
                if thread and thread.is_alive():
                    thread.join(timeout=timeout)
    
    def _reload_go2rtc_config(self, go2rtc_manager, wait_for_stream: str = None):
        """Reload go2rtc config and wait for stream ready if specified"""
        if not go2rtc_manager.is_running():
            return
        
        reloaded = go2rtc_manager.reload_config()
        if not reloaded:
            go2rtc_manager._restart_go2rtc_process()
            go2rtc_manager._wait_for_go2rtc_ready(max_retries=20, retry_interval=0.5)

        if wait_for_stream:
            go2rtc_manager.wait_for_stream_ready(wait_for_stream, max_retries=20, retry_interval=0.5)

    def list_cameras(self) -> List[CameraOut]:
        cams = []
        for cid, url in self.cfg.get("streams", {}).items():
            # Skip substreams và low streams (chỉ expose main streams)
            if cid.endswith("_sub") or cid.endswith("_low"):
                continue

            meta = self.cfg.get("metadata", {}).get(cid, {})
            # Phân loại: rtsp (Camera) vs video (File upload)
            source_type = meta.get("type", "rtsp")
            # camera_type là: internal, external, v.v. (business logic)
            camera_type = meta.get("camera_type", "internal")
            
            # Lấy snapshot URL từ go2rtc (nếu là RTSP camera)
            # Frontend-central dùng snapshot JPEG cho thumbnail, không dùng video stream
            # Dùng raw stream và để go2rtc tự decode/resize về 640x360
            snapshot_url = None
            
            # CHỈ lấy snapshot cho RTSP Camera - Video File không cần preview realtime
            if source_type == "rtsp":
                try:
                    from .go2rtc_manager import get_go2rtc_manager
                    go2rtc_manager = get_go2rtc_manager()
                    
                    if go2rtc_manager.is_running():
                        # Dùng raw stream, go2rtc tự decode và resize về 640x360
                        snapshot_url = go2rtc_manager.get_snapshot_url(cid, width=640, height=360)
                except Exception as e:
                    logging.debug(f"[CameraManager] Failed to get snapshot URL for {cid}: {e}")
            
            # Get enable_detection flag (default: True)
            enable_detection = meta.get("enable_detection", True)

            cams.append(
                CameraOut(
                    id=cid,
                    url=url,
                    name=meta.get("name") or cid,
                    type=source_type,  # "rtsp" hoặc "video"
                    camera_type=camera_type,
                    snapshot_url=snapshot_url,
                    enable_detection=enable_detection,
                )
            )
        return cams

    def add_camera(self, cam: CameraCreate):
        with self.lock:
            if cam.id in self.cfg["streams"]:
                raise HTTPException(status_code=400, detail="Camera ID exists")

            # Validate URL scheme for security (prevent SSRF attacks)
            url_lower = cam.url.lower()
            allowed_schemes = ['rtsp://', 'rtmp://', 'http://', 'https://']
            allowed_extensions = ('.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv')

            # Check if URL has allowed scheme or is a video file path
            is_valid_url = any(url_lower.startswith(scheme) for scheme in allowed_schemes)
            is_video_file = url_lower.endswith(allowed_extensions)

            if not is_valid_url and not is_video_file:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid URL scheme. Only rtsp://, rtmp://, http://, https:// or video files are allowed"
                )

            # Auto-detect type dựa trên URL
            if is_video_file:
                detected_type = "video"
            elif is_valid_url:
                # Handle http mjpeg or rtsp
                detected_type = "rtsp"
            else:
                # Default to user's choice or rtsp
                detected_type = cam.type if cam.type else "rtsp"

            # Add RTSP stream to go2rtc (same as backend-central)
            if detected_type == "rtsp":
                try:
                    from .go2rtc_manager import get_go2rtc_manager
                    go2rtc_manager = get_go2rtc_manager()

                    camera_exists = cam.id in self.cfg.get("streams", {})

                    # Add main stream with TCP transport to avoid packet loss
                    main_stream_url = cam.url
                    if main_stream_url.startswith("rtsp://"):
                        main_stream_url = f"{main_stream_url}#input=rtsp_tcp"

                    # 🚀 NEW: Dùng API để add stream động (không cần restart go2rtc)
                    api_success = go2rtc_manager.add_stream_via_api(cam.id, main_stream_url)

                    if api_success:
                        logging.info(f"[CameraManager] ✅ Added camera via API (instant): {cam.id}")
                    else:
                        # Fallback: dùng file + reload (cách cũ)
                        logging.warning(f"[CameraManager] API failed, falling back to file method for {cam.id}")
                        go2rtc_manager.add_stream_to_go2rtc(
                            stream_id=cam.id,
                            stream_url=main_stream_url,
                            name=cam.name or cam.id,
                            has_audio=False
                        )
                        # Reload go2rtc config và đợi stream ready cho camera mới
                        wait_stream = cam.id if not camera_exists else None
                        self._reload_go2rtc_config(go2rtc_manager, wait_for_stream=wait_stream)

                    # Persist stream to go2rtc.yaml (cho restart sau)
                    # QUAN TRỌNG: Phải persist XONG rồi mới sync vào config.yaml
                    if api_success:
                        # Persist stream vào go2rtc.yaml ĐỒNG BỘ (không background)
                        # Để đảm bảo sync_from_go2rtc_to_config thấy được stream mới
                        try:
                            go2rtc_manager.add_stream_to_go2rtc(
                                stream_id=cam.id,
                                stream_url=main_stream_url,
                                name=cam.name or cam.id,
                                has_audio=False
                            )
                            logging.info(f"[CameraManager] ✅ Persisted stream to go2rtc.yaml: {cam.id}")
                        except Exception as e:
                            logging.error(f"[CameraManager] Failed to persist stream to file: {e}")

                    # Use raw stream - go2rtc handles decode/resize
                    snapshot_url = go2rtc_manager.get_snapshot_url(cam.id, width=640, height=360)
                    logging.info(f"[CameraManager] 📸 Snapshot URL for {cam.id}: {snapshot_url}")

                    # Sync from go2rtc.yaml to config.yaml (sau khi đã persist go2rtc.yaml)
                    go2rtc_manager.sync_from_go2rtc_to_config()
                    self.cfg = load_config()

                    # Save metadata not handled by go2rtc sync (e.g., enable_detection)
                    if hasattr(cam, 'enable_detection') and cam.enable_detection is not None:
                        if cam.id not in self.cfg.get("metadata", {}):
                            if "metadata" not in self.cfg:
                                self.cfg["metadata"] = {}
                            self.cfg["metadata"][cam.id] = {}

                        self.cfg["metadata"][cam.id]["enable_detection"] = cam.enable_detection
                        # Save config immediately to persist metadata
                        save_config(self.cfg)
                        logging.info(f"[CameraManager] Persisted metadata for {cam.id}: enable_detection={cam.enable_detection}")

                    # Emit signal ngay sau khi sync xong để UI update (trước khi start detection)
                    self._emit_camera_list_changed()

                    # Nếu camera đã tồn tại trong config → không start detection lại
                    if camera_exists:
                        logging.info(f"[CameraManager] Camera {cam.id} already exists, skipping auto-start")
                        return
                except Exception as e:
                    logging.error(f"[CameraManager] Failed to add camera to go2rtc: {e}", exc_info=True)
                    raise HTTPException(status_code=500, detail=f"Failed to add camera: {e}")
            else:
                # Video file → lưu trực tiếp vào config.yaml
                self.cfg["streams"][cam.id] = cam.url
                self.cfg["metadata"][cam.id] = {
                    "name": cam.name or cam.id,
                    "type": detected_type,
                    "camera_type": cam.camera_type or "internal",
                    "enable_detection": cam.enable_detection if hasattr(cam, 'enable_detection') and cam.enable_detection is not None else True
                }
                
                # Save config synchronously and check result
                save_success = save_config(self.cfg, wait=True)
                if not save_success:
                    # Rollback in-memory changes if save failed
                    del self.cfg["streams"][cam.id]
                    del self.cfg["metadata"][cam.id]
                    raise HTTPException(
                        status_code=500, 
                        detail="Failed to save config file. Please check file permissions."
                    )
                
                # Emit signal only after successful save
                self._emit_camera_list_changed()
        
        # Start detection trong background thread (signal đã được emit ở trên)
        def _start_detection():
            try:
                # Đợi go2rtc sẵn sàng nếu là RTSP camera
                if detected_type == "rtsp":
                    from .go2rtc_manager import get_go2rtc_manager
                    go2rtc_manager = get_go2rtc_manager()
                    if go2rtc_manager.is_running():
                        go2rtc_manager._wait_for_go2rtc_ready(max_retries=20, retry_interval=0.5)

                # Reload config để đảm bảo có camera mới
                self.cfg = load_config()

                if cam.id not in self.cfg.get("streams", {}):
                    logging.error(f"[AUTO-START] Camera {cam.id} not found in config")
                    return

                # Check enable_detection flag (default: True nếu không có)
                meta = self.cfg.get("metadata", {}).get(cam.id, {})
                enable_detection = meta.get("enable_detection", True)

                # Start detection chỉ khi enable_detection = True
                if enable_detection:
                    self.start_detection(cam.id, fps=5.0)
                    logging.info(f"[CameraManager] Detection enabled for camera {cam.id}")
                else:
                    logging.info(f"[CameraManager] Detection disabled for camera {cam.id} (stream-only mode)")

                # Start continuous recording 24/7 (RTSP cameras) - LUÔN start bất kể detection có được enable hay không
                if detected_type == "rtsp":
                    try:
                        logging.info(f"[CameraManager] Starting recorder for camera {cam.id}")
                        self.recorder_manager.start_recorder(cam.id)
                    except Exception as e:
                        logging.error(f"[CameraManager] Failed to start recorder for {cam.id}: {e}", exc_info=True)

                # Emit signal để UI update (sau khi go2rtc ready và detection started)
                time.sleep(0.5)  # Delay để đảm bảo detection đã start xong
                self._emit_camera_list_changed()
            except Exception as e:
                logging.error(f"[AUTO-START] Failed to start camera {cam.id}: {e}", exc_info=True)
        
        # Start trong background thread để không block UI
        thread = threading.Thread(target=_start_detection, daemon=True)
        thread.start()

    def update_camera(self, cid: str, cam: CameraUpdate):
        with self.lock:
            if cid not in self.cfg["streams"]:
                raise HTTPException(status_code=404, detail="Camera not found")
            
            # Lấy type hiện tại để check xem có phải RTSP không
            meta = self.cfg.get("metadata", {}).get(cid, {})
            current_type = meta.get("type", "rtsp")
            old_url = self.cfg["streams"].get(cid)
            
            # Xử lý rename camera (newId) - xóa camera cũ và tạo camera mới với ID mới
            new_id = cam.newId
            is_rename = new_id and new_id != cid
            if is_rename:
                if new_id in self.cfg["streams"]:
                    raise HTTPException(status_code=400, detail=f"Camera ID {new_id} already exists")
                
                # Lưu thông tin camera cũ để tạo camera mới
                old_meta = self.cfg["metadata"].get(cid, {})
                camera_data = {
                    "id": new_id,
                    "url": cam.url if cam.url else self.cfg["streams"][cid],
                    "name": cam.name if cam.name is not None else old_meta.get("name", new_id),
                    "type": cam.type if cam.type is not None else old_meta.get("type", "rtsp"),
                    "camera_type": cam.camera_type if cam.camera_type is not None else old_meta.get("camera_type", "internal")
                }
            else:
                camera_data = None
            
            # Nếu đang rename → skip update go2rtc (sẽ xóa và tạo mới)
            # Update go2rtc if RTSP camera and not renaming
            url_changed = False
            if current_type == "rtsp" and not is_rename:
                try:
                    from .go2rtc_manager import get_go2rtc_manager
                    go2rtc_manager = get_go2rtc_manager()

                    # Check URL change
                    if cam.url:
                        url_changed = (old_url != cam.url)

                    # 🚀 NEW: Nếu URL thay đổi, dùng API để update stream động
                    if url_changed:
                        new_url = cam.url
                        if new_url.startswith("rtsp://"):
                            new_url = f"{new_url}#input=rtsp_tcp"

                        api_success = go2rtc_manager.update_stream_via_api(cid, new_url)

                        if api_success:
                            logging.info(f"[CameraManager] ✅ Updated camera URL via API (instant): {cid}")
                        else:
                            # Fallback: dùng file + reload
                            logging.warning(f"[CameraManager] API failed, falling back to file method for {cid}")
                            go2rtc_manager.update_stream_in_go2rtc(
                                stream_id=cid,
                                stream_url=cam.url,
                                name=cam.name if cam.name is not None else None,
                                has_audio=None
                            )
                            self._reload_go2rtc_config(go2rtc_manager)

                        # Persist to go2rtc.yaml ĐỒNG BỘ (để sync_from_go2rtc_to_config thấy)
                        if api_success:
                            try:
                                go2rtc_manager.update_stream_in_go2rtc(
                                    stream_id=cid,
                                    stream_url=new_url,
                                    name=cam.name if cam.name is not None else None,
                                    has_audio=None
                                )
                                logging.info(f"[CameraManager] ✅ Persisted stream update to go2rtc.yaml: {cid}")
                            except Exception as e:
                                logging.error(f"[CameraManager] Failed to persist stream update: {e}")
                    else:
                        # Chỉ update metadata (name), không cần reload go2rtc
                        go2rtc_manager.update_stream_in_go2rtc(
                            stream_id=cid,
                            stream_url=None,
                            name=cam.name if cam.name is not None else None,
                            has_audio=None
                        )

                    # Sync từ go2rtc.yaml → config.yaml
                    go2rtc_manager.sync_from_go2rtc_to_config()
                    self.cfg = load_config()

                    # Save metadata not handled by go2rtc sync (RTSP cameras)
                    need_save = False
                    if cid not in self.cfg.get("metadata", {}):
                        if "metadata" not in self.cfg:
                            self.cfg["metadata"] = {}
                        self.cfg["metadata"][cid] = {}
                        need_save = True

                    if hasattr(cam, 'enable_detection') and cam.enable_detection is not None:
                        self.cfg["metadata"][cid]["enable_detection"] = cam.enable_detection
                        need_save = True

                    if cam.camera_type is not None:
                        self.cfg["metadata"][cid]["camera_type"] = cam.camera_type
                        need_save = True

                    if need_save:
                        save_config(self.cfg)
                        logging.info(f"[CameraManager] Persisted metadata update for {cid}")
                except Exception as e:
                    logging.error(f"[CameraManager] Failed to update camera: {e}", exc_info=True)
                    raise HTTPException(status_code=500, detail=f"Failed to update camera: {e}")
            else:
                # Video file → update trực tiếp trong config.yaml
                if cam.url:
                    self.cfg["streams"][cid] = cam.url
                if cid not in self.cfg["metadata"]:
                    self.cfg["metadata"][cid] = {}
                if cam.name is not None:
                    self.cfg["metadata"][cid]["name"] = cam.name
                if cam.type is not None:
                    self.cfg["metadata"][cid]["type"] = cam.type
                if cam.camera_type is not None:
                    self.cfg["metadata"][cid]["camera_type"] = cam.camera_type
                if hasattr(cam, 'enable_detection') and cam.enable_detection is not None:
                    self.cfg["metadata"][cid]["enable_detection"] = cam.enable_detection
                save_config(self.cfg)
            
            # Emit signal để UI update (chỉ khi không phải rename)
            if not is_rename:
                self._emit_camera_list_changed()
                
                # Handle enable_detection toggle
                # Check nếu enable_detection thay đổi
                meta = self.cfg.get("metadata", {}).get(cid, {})
                old_enable = self.cfg["metadata"].get(cid, {}).get("enable_detection", True) if "enable_detection" in self.cfg["metadata"].get(cid, {}) else True
                # Note: self.cfg đã được update ở trên (line 330), nên chúng ta cần logic so sánh thông minh hơn
                # hoặc chấp nhận check current state của worker
                
                new_enable = meta.get("enable_detection", True)
                
                # Check worker status
                is_running = cid in self.workers and self.workers[cid].running
                
                if new_enable and not is_running:
                    # Enable turned ON -> Start worker
                    logging.info(f"[CameraManager] Enable detection toggled ON for {cid} -> Starting worker")
                    # Start trong background thread
                    thread = threading.Thread(target=self.start_detection, args=(cid, 5.0), daemon=True)
                    thread.start()
                    
                elif not new_enable and is_running:
                    # Enable turned OFF -> Stop worker
                    logging.info(f"[CameraManager] Enable detection toggled OFF for {cid} -> Stopping worker")
                    worker = self.workers[cid]
                    self._stop_worker_threads(worker)
                    del self.workers[cid]
        
        # Xử lý rename camera (ngoài lock để tránh deadlock)
        if camera_data:
            # Xóa camera cũ và tạo camera mới với ID mới
            new_id = camera_data['id']
            self.remove_camera(cid)
            from api.models import CameraCreate
            new_cam = CameraCreate(**camera_data)
            self.add_camera(new_cam)
            return  # Đã xử lý rename, return sớm
        
        # Nếu URL thay đổi → restart worker với URL mới (ngoài lock để tránh deadlock)
        if url_changed and current_type == "rtsp":
            with self.lock:
                if cid in self.workers:
                    logging.info(f"[CameraManager] Restarting worker for updated camera: {cid}")
                    worker = self.workers[cid]
                    self._stop_worker_threads(worker)
                    del self.workers[cid]
            
            # Restart với URL mới (ngoài lock)
            def _restart():
                try:
                    self.start_detection(cid, fps=5.0)
                    logging.info(f"[CameraManager] ✅ Restarted worker for updated camera: {cid}")
                except Exception as e:
                    logging.error(f"[CameraManager] Failed to restart camera {cid}: {e}")
            
            thread = threading.Thread(target=_restart, daemon=True)
            thread.start()

    def remove_camera(self, cid: str):
        with self.lock:
            # Lấy type để check xem có phải RTSP không
            meta = self.cfg.get("metadata", {}).get(cid, {})
            camera_type = meta.get("type", "rtsp")
            
            # Stop worker trước khi xóa (để tránh màn hình đen do stream bị ngắt)
            if cid in self.workers:
                worker = self.workers[cid]
                self._stop_worker_threads(worker)
                del self.workers[cid]

            # Stop recorder if running before deleting
            if camera_type == "rtsp":
                try:
                    logging.info(f"[CameraManager] Stopping recorder for camera: {cid}")
                    self.recorder_manager.stop_recorder(cid)
                except Exception as e:
                    logging.error(f"[CameraManager] Failed to stop recorder for {cid}: {e}", exc_info=True)

            # Delete from both go2rtc and config.yaml
            if camera_type == "rtsp":
                try:
                    from .go2rtc_manager import get_go2rtc_manager
                    go2rtc_manager = get_go2rtc_manager()

                    # 🚀 NEW: Dùng API để remove stream động (không cần restart go2rtc)
                    api_success = go2rtc_manager.remove_stream_via_api(cid)

                    if api_success:
                        logging.info(f"[CameraManager] ✅ Removed camera via API (instant): {cid}")
                    else:
                        logging.warning(f"[CameraManager] API failed for {cid}, will remove from file")

                    # Remove from go2rtc.yaml ĐỒNG BỘ (để sync_from_go2rtc_to_config thấy)
                    try:
                        go2rtc_manager.remove_stream_from_go2rtc(stream_id=cid)
                        # Cleanup old substreams
                        try:
                            go2rtc_manager.remove_stream_from_go2rtc(stream_id=f"{cid}_low")
                        except ValueError:
                            pass
                        try:
                            go2rtc_manager.remove_stream_from_go2rtc(stream_id=f"{cid}_sub")
                        except ValueError:
                            pass
                        logging.info(f"[CameraManager] ✅ Removed stream from go2rtc.yaml: {cid}")
                    except Exception as e:
                        logging.debug(f"[CameraManager] Stream already removed from file: {e}")

                    # Sync config (go2rtc.yaml → config.yaml)
                    go2rtc_manager.sync_from_go2rtc_to_config()
                    self.cfg = load_config()
                except Exception as e:
                    logging.error(f"[CameraManager] Failed to remove camera from go2rtc: {e}", exc_info=True)

            # FORCE DELETE from config.yaml (Source of Truth)
            # Remove directly to ensure config is updated regardless of go2rtc sync status
            config_changed = False
            if cid in self.cfg["streams"]:
                del self.cfg["streams"][cid]
                config_changed = True
            if cid in self.cfg["metadata"]:
                del self.cfg["metadata"][cid]
                config_changed = True
            
            if config_changed:
                save_config(self.cfg)
                logging.info(f"[CameraManager] ✅ Force deleted camera {cid} from config.yaml")

            # Final Sync config (just to be safe)
            try:
                go2rtc_manager.sync_from_go2rtc_to_config()
                self.cfg = load_config()
            except Exception:
                pass
            else:
                # Video file → xóa trực tiếp khỏi config.yaml
                if cid in self.cfg["streams"]:
                    del self.cfg["streams"][cid]
                if cid in self.cfg["metadata"]:
                    del self.cfg["metadata"][cid]
                save_config(self.cfg)
            
            # Emit signal để UI update NGAY LẬP TỨC (sau khi đã xóa config)
            self._emit_camera_list_changed()

    def start_detection(self, cid: str, fps: float = 5.0):
        logging.info(f"[start_detection] Entering for camera: {cid}")
        with self.lock:
            logging.info(f"[start_detection] Lock acquired for {cid}")
            if cid in self.workers and self.workers[cid].running:
                logging.info(f"[start_detection] Camera {cid} already running, returning")
                return
            url = self.cfg["streams"].get(cid)
            if not url:
                logging.error(f"[start_detection] Camera {cid} not found in config")
                raise HTTPException(status_code=404, detail="Camera not found")

            # Check source type from metadata
            meta = self.cfg.get("metadata", {}).get(cid, {})
            source_type = meta.get("type", "rtsp")
            
            # Always use go2rtc relay URL for RTSP streams (no fallback to direct camera)
            if source_type == "rtsp":
                try:
                    from .go2rtc_manager import get_go2rtc_manager
                    go2rtc_manager = get_go2rtc_manager()
                    if not go2rtc_manager.is_running():
                        raise RuntimeError("go2rtc is not running. Please ensure go2rtc is started before starting cameras.")
                    
                    # Sử dụng go2rtc relay URL thay vì camera URL trực tiếp
                    relay_url = go2rtc_manager.get_relay_url(cid)
                    logging.info(f"[start_detection] Using go2rtc relay: {cid} -> {relay_url} (original camera: {url})")
                    url = relay_url
                except Exception as e:
                    logging.error(f"[start_detection] Failed to get go2rtc relay URL for {cid}: {e}")
                    raise HTTPException(
                        status_code=503,
                        detail=f"Cannot start camera {cid}: go2rtc media server is required but not available. Error: {str(e)}"
                    )
            
            logging.info(f"[start_detection] Camera {cid}: url={url}, type={source_type}")

            # Get enable_detection flag từ metadata
            enable_detection = meta.get("enable_detection", True)

            # Create appropriate worker based on source type
            if source_type == "video":
                # Video file worker
                logging.info(f"[start_detection] Creating VideoSourceWorker for {cid}")
                worker = VideoSourceWorker(
                    video_id=cid,
                    video_path=url,
                    target_fps=fps
                )
            else:
                # RTSP camera worker (default)
                logging.info(f"[start_detection] Creating CameraWorker for {cid} (enable_detection={enable_detection})")
                worker = CameraWorker(
                    camera_id=cid,
                    url=url,
                    detection_fps=fps,
                    enable_detection=enable_detection
                )

            self.workers[cid] = worker
            logging.info(f"[start_detection] Worker created for {cid}, calling start()")
            worker.start()
            logging.info(f"[start_detection] Worker.start() completed for {cid}")

        # Ngoài lock: nếu là RTSP camera thì start luôn recorder 24/7 (ghi từ go2rtc relay)
        if source_type == "rtsp":
            try:
                logging.info(f"[start_detection] Starting recorder for camera: {cid}")
                self.recorder_manager.start_recorder(cid)
            except Exception as e:
                logging.error(f"[start_detection] Failed to start recorder for {cid}: {e}", exc_info=True)

    def stop_detection(self, cid: str):
        with self.lock:
            worker = self.workers.get(cid)
            if worker:
                worker.stop()
                del self.workers[cid]

    def get_frame(self, cid: str) -> Tuple[Optional[np.ndarray], List[dict]]:
        worker = self.workers.get(cid)
        if not worker:
            return None, []

        # Both workers now use get_frame() method (unified interface)
        if isinstance(worker, VideoSourceWorker):
            frame, detection_info = worker.get_frame()
            # Convert detection_info format to match CameraWorker
            detections = detection_info.get("vehicles", []) if detection_info else []
            return frame, detections

        # CameraWorker now also has get_frame() method
        if isinstance(worker, CameraWorker):
            frame, detection_info = worker.get_frame()
            # Convert detection_info format
            detections = detection_info.get("vehicles", []) if detection_info else []
            return frame, detections

        # Fallback to legacy method (shouldn't happen)
        return worker.latest_frame, worker.latest_detections
    
    def get_cropped_image(self, cid: str) -> Optional[np.ndarray]:
        """Lấy ảnh crop từ detection mới nhất"""
        worker = self.workers.get(cid)
        if not worker:
            return None

        # VideoSourceWorker không có latest_cropped_image
        if isinstance(worker, VideoSourceWorker):
            return None

        return worker.latest_cropped_image

    def get_ocr_text(self, cid: str) -> str:
        """Lấy OCR text từ detection mới nhất"""
        worker = self.workers.get(cid)
        if not worker:
            return ""

        # Cả 2 workers đều có latest_ocr_text
        return worker.latest_ocr_text
    
    def get_stats(self):
        out = {}
        for cid, w in self.workers.items():
            # VideoSourceWorker có stats format khác
            if isinstance(w, VideoSourceWorker):
                out[cid] = {
                    "fps": w.stats.get("stream_fps", 0),  # VideoWorker dùng stream_fps
                    "errors": w.stats.get("errors", 0),
                    "last_err": w.stats.get("last_err", ""),
                    "last_update_ts": time.time(),  # VideoWorker không có last_update_ts
                }
            else:
                # CameraWorker
                out[cid] = {
                    "fps": w.stats.get("fps", 0),
                    "errors": w.stats.get("errors", 0),
                    "last_err": w.stats.get("last_err", ""),
                    "last_update_ts": w.last_update_ts,
                }
        return out

    def auto_start_all(self, fps: float = 5.0):
        """Tự động start detection cho tất cả camera có trong config"""
        print(f"[AUTO-START] ====== ENTERING auto_start_all with fps={fps} ======", flush=True)
        logging.info(f"[AUTO-START] Starting auto_start_all with fps={fps}")
        streams = self.cfg.get("streams", {})
        print(f"[AUTO-START] Found {len(streams)} streams in config: {list(streams.keys())}", flush=True)
        logging.info(f"[AUTO-START] Found {len(streams)} streams in config: {list(streams.keys())}")

        for cid in streams.keys():
            print(f"[AUTO-START] >>> Processing camera: {cid}", flush=True)
            logging.info(f"[AUTO-START] Processing camera: {cid}")

            # Check enable_detection flag (default: True nếu không có)
            meta = self.cfg.get("metadata", {}).get(cid, {})
            enable_detection = meta.get("enable_detection", True)

            if cid not in self.workers or not self.workers[cid].running:
                try:
                    # LUÔN start detection/worker (để có stream preview)
                    # Nếu enable_detection = False, worker sẽ chạy nhưng không detect
                    print(f"[AUTO-START] >>> Calling start_detection for {cid} (enable_detection={enable_detection})", flush=True)
                    logging.info(f"[AUTO-START] Calling start_detection for {cid} (enable_detection={enable_detection})")
                    self.start_detection(cid, fps=fps)
                    print(f"[AUTO-START] >>> Started worker for camera: {cid} (detection={'enabled' if enable_detection else 'disabled'})", flush=True)
                    logging.info(f"[AUTO-START] Started worker for camera: {cid} (detection={'enabled' if enable_detection else 'disabled'})")

                    # Sau khi start detection, nếu là RTSP camera thì start luôn recorder 24/7
                    # LUÔN start recorder bất kể detection có được enable hay không
                    if meta.get("type", "rtsp") == "rtsp":
                        try:
                            logging.info(f"[AUTO-START] Starting recorder for camera: {cid}")
                            self.recorder_manager.start_recorder(cid)
                        except Exception as e:
                            logging.error(f"[AUTO-START] Failed to start recorder for {cid}: {e}", exc_info=True)
                except Exception as e:
                    print(f"[AUTO-START] >>> EXCEPTION for {cid}: {e}", flush=True)
                    logging.error(f"[AUTO-START] Failed to start {cid}: {e}", exc_info=True)
            else:
                print(f"[AUTO-START] >>> Camera {cid} already running, skipping", flush=True)
                logging.info(f"[AUTO-START] Camera {cid} already running, skipping")

        print(f"[AUTO-START] ====== EXITING auto_start_all ======", flush=True)

    def reload_config(self):
        """
        Reload config từ file và cập nhật internal state
        Tự động stop và remove workers cho cameras không còn trong config
        """
        with self.lock:
            old_cfg = self.cfg.copy()
            old_streams = set(old_cfg.get("streams", {}).keys())
            old_urls = {sid: old_cfg["streams"][sid] for sid in old_streams}
            
            self.cfg = load_config()
            new_streams = set(self.cfg.get("streams", {}).keys())
            new_urls = {sid: self.cfg["streams"][sid] for sid in new_streams}
            
            # Tìm cameras đã bị xóa
            deleted_streams = old_streams - new_streams
            
            # Tìm cameras có URL thay đổi (EDIT) - chỉ RTSP cameras
            edited_streams = []
            for stream_id in old_streams & new_streams:  # Cameras có trong cả 2
                meta = self.cfg.get("metadata", {}).get(stream_id, {})
                stream_type = meta.get("type", "rtsp")
                # Chỉ restart RTSP cameras khi URL thay đổi
                if stream_type == "rtsp" and old_urls.get(stream_id) != new_urls.get(stream_id):
                    edited_streams.append(stream_id)
            
            # Stop và remove workers cho cameras đã bị xóa
            for stream_id in deleted_streams:
                if stream_id in self.workers:
                    logging.info(f"[CameraManager] Stopping worker for deleted camera: {stream_id}")
                    worker = self.workers[stream_id]
                    self._stop_worker_threads(worker)
                    del self.workers[stream_id]
                    logging.info(f"[CameraManager] ✅ Removed worker for deleted camera: {stream_id}")
            
            # Stop workers cho cameras có URL thay đổi (EDIT) - sẽ restart với URL mới trong auto_start_all
            for stream_id in edited_streams:
                if stream_id in self.workers:
                    logging.info(f"[CameraManager] Stopping worker for edited camera: {stream_id} (URL changed)")
                    worker = self.workers[stream_id]
                    self._stop_worker_threads(worker)
                    del self.workers[stream_id]
                    logging.info(f"[CameraManager] ✅ Stopped worker for edited camera: {stream_id} (will restart with new URL)")
            
            logging.info(f"[CameraManager] Config reloaded: {len(self.cfg.get('streams', {}))} cameras")
            if deleted_streams:
                logging.info(f"[CameraManager] Removed {len(deleted_streams)} cameras: {list(deleted_streams)}")
            if edited_streams:
                logging.info(f"[CameraManager] Edited {len(edited_streams)} cameras (will restart): {list(edited_streams)}")
            print(f"[CameraManager] Config reloaded: {len(self.cfg.get('streams', {}))} cameras", flush=True)
            return self.cfg


# Global camera manager instance
camera_manager = CameraManager()

