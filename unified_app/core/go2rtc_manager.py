"""
go2rtc Manager - Quản lý go2rtc process như media server
"""
import os
import subprocess
import logging
import threading
import time
import yaml
from pathlib import Path
from typing import Optional, Dict, Union, List

from .config import load_config, save_config

# File watcher để monitor go2rtc.yaml changes
try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
    WATCHDOG_AVAILABLE = True
except ImportError:
    WATCHDOG_AVAILABLE = False
    logging.warning("[go2rtc] watchdog not available, file monitoring disabled")


class Go2RTCConfigWatcher(FileSystemEventHandler):
    """File watcher để monitor go2rtc.yaml changes"""
    
    def __init__(self, manager):
        super().__init__()
        self.manager = manager
        self.last_modified = 0
        self.debounce_time = 2.0  # Đợi 2s sau khi file thay đổi để tránh spam
        self._is_writing = False  # Flag để tránh sync khi unified_app đang ghi file
    
    def on_modified(self, event):
        """Khi unified_app/go2rtc.yaml được modify"""
        if event.is_directory:
            return
        
        # Chỉ xử lý unified_app/go2rtc.yaml
        if event.src_path != str(self.manager.config_path):
            return
        
        current_time = time.time()
        # Debounce: chỉ xử lý nếu đã qua debounce_time
        if current_time - self.last_modified < self.debounce_time:
            return
        
        self.last_modified = current_time
        
        # 🔥 Bỏ qua nếu unified_app đang ghi file (tránh overwrite)
        if hasattr(self, '_is_writing') and self._is_writing:
            logging.debug(f"[go2rtc] Skipping file watcher - unified_app is writing file")
            return
        
        logging.info(f"[go2rtc] go2rtc.yaml changed: {event.src_path}")
        
        # Sync trong background thread để không block
        def _sync():
            time.sleep(0.5)  # Đợi file write hoàn tất
            
            # Reload go2rtc config nếu đang chạy (để go2rtc nhận streams mới)
            if self.manager.is_running():
                self.manager.reload_config()
                logging.info("[go2rtc] Reloaded go2rtc config after file change")
            
            # Sync từ go2rtc.yaml vào unified_app config (chỉ khi file được edit từ bên ngoài)
            if self.manager.sync_from_go2rtc_to_config():
                # Reload camera manager
                from .camera_manager import camera_manager
                camera_manager.reload_config()
                
                # Stop và remove cameras đã bị xóa khỏi go2rtc
                # (auto_start_all sẽ tự động start cameras mới và skip cameras đã có worker)
                camera_manager.auto_start_all(fps=20.0)
                
                logging.info("[go2rtc] ✅ Synced cameras from go2rtc.yaml (added/updated/deleted)")
                
                # Emit event để UI refresh
                try:
                    from .events import get_event_emitter
                    from PyQt6.QtCore import QTimer
                    event_emitter = get_event_emitter()
                    # Emit signal từ background thread sang main thread (thread-safe)
                    QTimer.singleShot(0, event_emitter.camera_list_changed.emit)
                except Exception as e:
                    logging.debug(f"[go2rtc] Failed to emit camera_list_changed event: {e}")
        
        thread = threading.Thread(target=_sync, daemon=True)
        thread.start()


class Go2RTCManager:
    """Quản lý go2rtc process - Media server cho unified_app"""
    
    def __init__(self):
        self.process: Optional[subprocess.Popen] = None
        self.running = False
        # Unified_app LUÔN dùng go2rtc.yaml của chính nó
        self.config_path = Path(__file__).resolve().parent.parent / "go2rtc.yaml"
        self.go2rtc_binary = self._find_go2rtc_binary()
        self.observer: Optional[Observer] = None  # File watcher observer
        
    def _find_go2rtc_binary(self) -> Optional[str]:
        """Tìm go2rtc binary trong PATH hoặc cùng thư mục"""
        # Thử tìm trong PATH
        import shutil
        go2rtc_path = shutil.which("go2rtc")
        if go2rtc_path:
            return go2rtc_path
        
        # Thử tìm trong cùng thư mục với app
        app_dir = Path(__file__).resolve().parent.parent
        possible_paths = [
            app_dir / "go2rtc.exe",  # Windows
            app_dir / "go2rtc",      # Linux/Mac
            app_dir / "bin" / "go2rtc.exe",
            app_dir / "bin" / "go2rtc",
        ]
        
        for path in possible_paths:
            if path.exists():
                return str(path)
        
        return None
    
    def _load_streams_from_config(self) -> Dict[str, str]:
        """Load streams từ config.yaml và convert sang go2rtc format"""
        cfg = load_config()
        streams = {}
        
        # Lấy streams từ config.yaml
        config_streams = cfg.get("streams", {})
        logging.info(f"[go2rtc] _load_streams_from_config: Found {len(config_streams)} streams in config.yaml")
        
        for stream_id, stream_url in config_streams.items():
            # Chỉ thêm RTSP streams (không thêm video files)
            meta = cfg.get("metadata", {}).get(stream_id, {})
            stream_type = meta.get("type", "rtsp")
            
            logging.info(f"[go2rtc] Checking stream {stream_id}: type={stream_type}, url={stream_url[:50]}...")
            
            if stream_type == "rtsp" and stream_url.startswith("rtsp://"):
                streams[stream_id] = stream_url
                logging.info(f"[go2rtc] ✅ Added RTSP stream: {stream_id}")
            else:
                logging.info(f"[go2rtc] ⏭️ Skipped stream {stream_id}: type={stream_type}, is_rtsp_url={stream_url.startswith('rtsp://')}")
        
        logging.info(f"[go2rtc] _load_streams_from_config: Returning {len(streams)} RTSP streams")
        return streams
    
    def sync_from_go2rtc_to_config(self):
        """
        🔥 SYNC NGƯỢC: Load tất cả streams từ unified_app/go2rtc.yaml vào unified_app config.yaml
        Đảm bảo unified_app có tất cả cameras từ go2rtc
        """
        if not self.config_path.exists():
            logging.warning(f"[go2rtc] Config file not found: {self.config_path}")
            return False
        
        try:
            # Load go2rtc config từ unified_app/go2rtc.yaml
            logging.info(f"[go2rtc] Loading go2rtc config from: {self.config_path}")
            with open(self.config_path, 'r', encoding='utf-8') as f:
                go2rtc_cfg = yaml.safe_load(f) or {}
            
            go2rtc_streams = go2rtc_cfg.get("streams", {})
            go2rtc_metadata = go2rtc_cfg.get("metadata", {})
            
            if not go2rtc_streams:
                logging.info("[go2rtc] No streams found in go2rtc.yaml")
                return False
            
            # Load unified_app config
            cfg = load_config()
            config_streams = cfg.get("streams", {})
            config_metadata = cfg.get("metadata", {})
            
            # Sync: Thêm/Update/Delete streams từ go2rtc vào unified_app config
            added_count = 0
            updated_count = 0
            deleted_count = 0
            
            # Tìm cameras cần xóa (có trong config nhưng không có trong go2rtc)
            cameras_to_delete = []
            for stream_id in list(config_streams.keys()):
                meta = config_metadata.get(stream_id, {})
                stream_type = meta.get("type", "rtsp")
                stream_url = config_streams.get(stream_id, "")
                is_rtsp_url = isinstance(stream_url, str) and stream_url.startswith("rtsp://")
                
                # Chỉ xóa RTSP cameras (không xóa video files)
                # Check cả type HOẶC url bắt đầu bằng rtsp://
                should_delete = (stream_type == "rtsp" or is_rtsp_url) and (stream_id not in go2rtc_streams)
                
                if should_delete:
                    cameras_to_delete.append(stream_id)
                else:
                    if stream_id not in go2rtc_streams:
                        logging.warning(f"[go2rtc] Sync: Stream {stream_id} not in go2rtc BUT ignored delete (type={stream_type}, is_rtsp={is_rtsp_url})")
            
            # Xóa cameras không còn trong go2rtc
            for stream_id in cameras_to_delete:
                del config_streams[stream_id]
                if stream_id in config_metadata:
                    del config_metadata[stream_id]
                deleted_count += 1
                logging.info(f"[go2rtc] Removed stream from unified_app (not in go2rtc): {stream_id}")
            
            # Thêm/Update streams từ go2rtc
            for stream_id, stream_url in go2rtc_streams.items():
                # Chỉ sync RTSP streams (không sync video files hoặc transcoding configs dạng list)
                if not isinstance(stream_url, str) or not stream_url.startswith("rtsp://"):
                    continue
                
                # Lấy metadata từ go2rtc
                go2rtc_meta = go2rtc_metadata.get(stream_id, {})
                
                # Nếu stream chưa có trong unified_app config → thêm vào
                if stream_id not in config_streams:
                    config_streams[stream_id] = stream_url
                    config_metadata[stream_id] = {
                        "name": go2rtc_meta.get("name", stream_id),
                        "type": "rtsp",
                        "camera_type": "internal"  # Default, có thể update sau
                    }
                    added_count += 1
                    logging.info(f"[go2rtc] Synced new stream to unified_app: {stream_id}")
                else:
                    # Stream đã có → update URL nếu khác (EDIT camera)
                    if config_streams[stream_id] != stream_url:
                        config_streams[stream_id] = stream_url
                        updated_count += 1
                        logging.info(f"[go2rtc] Updated stream URL in unified_app (EDIT): {stream_id} -> {stream_url}")
                    # Update metadata name nếu có thay đổi
                    current_name = config_metadata.get(stream_id, {}).get("name", stream_id)
                    new_name = go2rtc_meta.get("name", stream_id)
                    if current_name != new_name:
                        if stream_id not in config_metadata:
                            config_metadata[stream_id] = {}
                        config_metadata[stream_id]["name"] = new_name
                        logging.info(f"[go2rtc] Updated stream name in unified_app (EDIT): {stream_id} -> {new_name}")
            
            # Save updated config (LUÔN save để đảm bảo config.yaml được overwrite)
            # Dùng wait=True để đảm bảo save xong trước khi return (tránh race condition)
            cfg["streams"] = config_streams
            cfg["metadata"] = config_metadata
            save_success = save_config(cfg, wait=True)
            if not save_success:
                logging.error(f"[go2rtc] Failed to save config.yaml")
                return False
            logging.info(f"[go2rtc] ✅ Saved config.yaml with {len(config_streams)} streams: {list(config_streams.keys())}")
            
            if added_count > 0 or updated_count > 0 or deleted_count > 0:
                logging.info(f"[go2rtc] ✅ Synced: +{added_count} new, ~{updated_count} updated, -{deleted_count} deleted from go2rtc.yaml")
            else:
                logging.info(f"[go2rtc] ✅ Config.yaml synced (no changes needed, but config saved)")
            
            return True  # Luôn return True để caller biết sync đã hoàn thành
                
        except Exception as e:
            logging.error(f"[go2rtc] Failed to sync from go2rtc.yaml: {e}", exc_info=True)
            return False
            
    def sync_config_to_go2rtc(self) -> int:
        """
        🔥 SYNC CHÍNH: Load tất cả RTSP streams từ config.yaml và add vào go2rtc
        
        config.yaml là SOURCE OF TRUTH cho cameras.
        go2rtc.yaml chỉ là mirror (được update khi add_stream_via_api thành công và manual persistence).
        
        Returns:
            Số streams đã sync thành công
        """
        logging.info("[go2rtc] Syncing cameras from config.yaml to go2rtc...")
        
        # Load streams from config.yaml
        streams = self._load_streams_from_config()
        
        if not streams:
            logging.info("[go2rtc] No RTSP streams found in config.yaml")
            return 0
        
        synced_count = 0
        
        for stream_id, stream_url in streams.items():
            try:
                # Thêm #input=rtsp_tcp nếu chưa có
                if stream_url.startswith("rtsp://") and "#input=" not in stream_url:
                    stream_url = f"{stream_url}#input=rtsp_tcp"
                
                # Add via API (instant, không cần restart go2rtc)
                # Dùng API đễ đảm bảo go2rtc runtime có stream
                api_success = self.add_stream_via_api(stream_id, stream_url)
                
                if api_success:
                    logging.info(f"[go2rtc] ✅ Synced stream via API: {stream_id}")
                    synced_count += 1
                else:
                    logging.warning(f"[go2rtc] ⚠️ API failed for {stream_id}, stream not synced to runtime")
                    # Không dùng fallback file ở đây để tránh race condition/overwrite sai
                    
            except Exception as e:
                logging.error(f"[go2rtc] Failed to sync stream {stream_id}: {e}")
        
        logging.info(f"[go2rtc] ✅ Synced {synced_count}/{len(streams)} streams from config.yaml to go2rtc")
        return synced_count
    
    def _ensure_go2rtc_config_exists(self):
        """Đảm bảo go2rtc.yaml tồn tại với cấu trúc mặc định"""
        if not self.config_path.exists():
            logging.info(f"[go2rtc] Creating go2rtc.yaml: {self.config_path}")
            default_config = {
                "api": {"listen": ":1984", "origin": "*"},
                "log": {"format": "text", "level": "info"},
                "rtsp": {"listen": ":8554"},
                "webrtc": {
                    "candidates": ["stun:8555"],
                    "ice_servers": [{"urls": ["stun:stun.l.google.com:19302"]}],
                    "listen": ":8555"
                },
                "streams": {},
                "metadata": {}
            }
            os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
            with open(self.config_path, 'w', encoding='utf-8') as f:
                yaml.dump(default_config, f, default_flow_style=False, allow_unicode=True)
    
    def _load_go2rtc_config(self) -> dict:
        """Load go2rtc.yaml config"""
        self._ensure_go2rtc_config_exists()
        with open(self.config_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f) or {}

        # Đảm bảo streams và metadata luôn là dict (không phải None)
        if config.get('streams') is None:
            config['streams'] = {}
        if config.get('metadata') is None:
            config['metadata'] = {}

        return config
    
    def _save_go2rtc_config(self, config: dict):
        """Save go2rtc.yaml config"""
        try:
            # Set flag để file watcher biết unified_app đang ghi file
            if self.observer and hasattr(self.observer, '_event_handler'):
                event_handler = self.observer._event_handler
                if hasattr(event_handler, '_is_writing'):
                    event_handler._is_writing = True
                    logging.debug(f"[go2rtc] Set _is_writing flag to prevent file watcher")
            
            os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
            
            # Verify streams trước khi save
            streams = config.get('streams', {})
            logging.info(f"[go2rtc] Saving go2rtc.yaml with {len(streams)} streams: {list(streams.keys())}")
            
            with open(self.config_path, 'w', encoding='utf-8') as f:
                yaml.dump(config, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
            
            # Verify file sau khi save
            if self.config_path.exists():
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    verify_cfg = yaml.safe_load(f) or {}
                    verify_streams = verify_cfg.get("streams", {})
                    if len(verify_streams) != len(streams):
                        logging.error(f"[go2rtc] ❌ MISMATCH after save! Expected {len(streams)} streams, got {len(verify_streams)}")
                        logging.error(f"[go2rtc] Expected: {list(streams.keys())}")
                        logging.error(f"[go2rtc] Got: {list(verify_streams.keys())}")
                    else:
                        logging.info(f"[go2rtc] ✅ Verified: go2rtc.yaml saved with {len(verify_streams)} streams: {list(verify_streams.keys())}")
            else:
                logging.error(f"[go2rtc] ❌ File does not exist after save!")
            
            logging.info(f"[go2rtc] ✅ Saved go2rtc.yaml: {len(streams)} streams")
            
            # Reset flag sau khi save xong (đợi một chút để file write hoàn tất và tránh file watcher trigger)
            if self.observer and hasattr(self.observer, '_event_handler'):
                event_handler = self.observer._event_handler
                if hasattr(event_handler, '_is_writing'):
                    time.sleep(1.0)  # Đợi lâu hơn để đảm bảo file watcher không trigger khi add camera từ UI
                    event_handler._is_writing = False
                    logging.debug(f"[go2rtc] Reset _is_writing flag")
        except Exception as e:
            logging.error(f"[go2rtc] ❌ Failed to save go2rtc.yaml: {e}", exc_info=True)
            # Reset flag nếu có lỗi
            if self.observer and hasattr(self.observer, '_event_handler'):
                event_handler = self.observer._event_handler
                if hasattr(event_handler, '_is_writing'):
                    event_handler._is_writing = False
            raise
    
    def add_stream_to_go2rtc(self, stream_id: str, stream_url: Union[str, List[str]], name: str = None, has_audio: bool = False):
        """Thêm stream vào go2rtc.yaml (hoặc update nếu đã tồn tại)
        
        Args:
            stream_id: Stream ID
            stream_url: Stream URL (string) hoặc FFmpeg config (list of strings)
            name: Stream name
            has_audio: Has audio or not
        """
        config = self._load_go2rtc_config()
        
        if 'streams' not in config:
            config['streams'] = {}
        if 'metadata' not in config:
            config['metadata'] = {}
        
        # Nếu stream đã tồn tại → update thay vì raise error
        if stream_id in config['streams']:
            logging.info(f"[go2rtc] Stream {stream_id} already exists, updating instead of adding...")
            # Update stream URL nếu khác
            if config['streams'][stream_id] != stream_url:
                config['streams'][stream_id] = stream_url
                logging.info(f"[go2rtc] Updated stream URL: {stream_id} -> {stream_url}")
            # Update metadata
            if stream_id not in config['metadata']:
                config['metadata'][stream_id] = {}
            if name:
                config['metadata'][stream_id]['name'] = name
            if has_audio is not None:
                config['metadata'][stream_id]['hasAudio'] = has_audio
            # Giữ nguyên order nếu đã có (central quản lý order, không tự tính toán)
            self._save_go2rtc_config(config)
            logging.info(f"[go2rtc] ✅ Updated existing stream in go2rtc.yaml: {stream_id}")
            
            # Reload go2rtc config
            if self.is_running():
                reloaded = self.reload_config()
                if not reloaded:
                    logging.warning(f"[go2rtc] Reload API failed, restarting go2rtc process to reload config...")
                    self._restart_go2rtc_process()
            return
        
        # Add stream mới
        config['streams'][stream_id] = stream_url
        
        # Không tự tính toán order - central sẽ xử lý order sau
        config['metadata'][stream_id] = {
            'name': name or stream_id,
            'type': 'rtsp',
            'hasAudio': has_audio
            # Không set order - central sẽ set sau
        }
        
        self._save_go2rtc_config(config)
        logging.info(f"[go2rtc] ✅ Added stream to go2rtc.yaml: {stream_id}")
        
        # 🔥 Force reload go2rtc config ngay lập tức
        if self.is_running():
            # Thử reload qua API
            reloaded = self.reload_config()
            # Nếu API không work (404), restart go2rtc process để reload config
            if not reloaded:
                logging.warning(f"[go2rtc] Reload API failed, restarting go2rtc process to reload config...")
                self._restart_go2rtc_process()
    
    def update_stream_in_go2rtc(self, stream_id: str, stream_url: str = None, name: str = None, has_audio: bool = None):
        """Update stream trong go2rtc.yaml (order được xử lý bởi central, không update ở đây)"""
        config = self._load_go2rtc_config()
        
        if 'streams' not in config or stream_id not in config['streams']:
            raise ValueError(f"Stream {stream_id} not found in go2rtc.yaml")
        
        if 'metadata' not in config:
            config['metadata'] = {}
        if stream_id not in config['metadata']:
            config['metadata'][stream_id] = {}
        
        # Update URL
        if stream_url:
            config['streams'][stream_id] = stream_url
        
        # Update metadata (không update order - central quản lý)
        if name is not None:
            config['metadata'][stream_id]['name'] = name
        if has_audio is not None:
            config['metadata'][stream_id]['hasAudio'] = has_audio
        # Giữ nguyên order nếu đã có (central quản lý)
        
        self._save_go2rtc_config(config)
        logging.info(f"[go2rtc] ✅ Updated stream in go2rtc.yaml: {stream_id}")
    
    def remove_stream_from_go2rtc(self, stream_id: str):
        """Xóa stream khỏi go2rtc.yaml"""
        config = self._load_go2rtc_config()
        
        if 'streams' not in config or stream_id not in config['streams']:
            raise ValueError(f"Stream {stream_id} not found in go2rtc.yaml")
        
        # Remove stream
        del config['streams'][stream_id]
        if 'metadata' in config and stream_id in config['metadata']:
            del config['metadata'][stream_id]
        
        self._save_go2rtc_config(config)
        logging.info(f"[go2rtc] ✅ Removed stream from go2rtc.yaml: {stream_id}")
    
    def _update_go2rtc_config(self):
        """DEPRECATED: Cập nhật unified_app/go2rtc.yaml với streams từ config.yaml (sync từ config.yaml)"""
        # Giữ lại để backward compatibility, nhưng không dùng nữa
        # Thay vào đó dùng add_stream_to_go2rtc/update_stream_in_go2rtc/remove_stream_from_go2rtc
        pass
    
    def reload_config(self):
        """Reload go2rtc config (gọi API reload nếu go2rtc đang chạy)"""
        if not self.is_running():
            logging.warning("[go2rtc] Cannot reload: go2rtc is not running")
            return False
        
        try:
            import requests
            # go2rtc API reload endpoint - thử cả GET và POST
            try:
                # Thử POST trước
                response = requests.post("http://localhost:1984/api/reload", timeout=2)
                if response.status_code == 200:
                    logging.info("[go2rtc] Config reloaded successfully (POST)")
                    return True
            except:
                pass
            
            # Thử GET nếu POST không work
            try:
                response = requests.get("http://localhost:1984/api/reload", timeout=2)
                if response.status_code == 200:
                    logging.info("[go2rtc] Config reloaded successfully (GET)")
                    return True
            except:
                pass
            
            # Nếu cả 2 đều không work, return False để caller biết cần restart
            logging.warning(f"[go2rtc] Reload API not available (404), go2rtc needs restart to reload config")
            return False  # Return False để caller biết cần restart
        except Exception as e:
            logging.warning(f"[go2rtc] Failed to reload config via API: {e}")
            return False  # Return False để caller biết cần restart
    
    def start(self) -> bool:
        """Start go2rtc process"""
        if self.running:
            logging.warning("[go2rtc] Already running")
            return True
        
        if not self.go2rtc_binary:
            logging.error("[go2rtc] go2rtc binary not found. Please install go2rtc or set path in config")
            return False
        
        if not self.config_path.exists():
            logging.error(f"[go2rtc] Config file not found: {self.config_path}")
            return False
        
        # Cập nhật config với streams từ config.yaml
        self._update_go2rtc_config()
        
        try:
            # Start go2rtc process
            logging.info(f"[go2rtc] Starting go2rtc: {self.go2rtc_binary}")
            logging.info(f"[go2rtc] Config: {self.config_path}")
            
            self.process = subprocess.Popen(
                [self.go2rtc_binary, "-config", str(self.config_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )
            
            self.running = True
            
            # Start thread để log output
            log_thread = threading.Thread(target=self._log_output, daemon=True)
            log_thread.start()
            
            # Wait a bit để check if process started successfully
            time.sleep(1)
            if self.process.poll() is not None:
                # Process đã exit
                stdout, stderr = self.process.communicate()
                logging.error(f"[go2rtc] Process exited immediately. stdout: {stdout}, stderr: {stderr}")
                self.running = False
                return False
            
            logging.info("[go2rtc] ✅ Started successfully")
            logging.info("[go2rtc] RTSP server: rtsp://localhost:8554")
            logging.info("[go2rtc] API server: http://localhost:1984")
            
            # Start file watcher để monitor go2rtc.yaml changes
            self._start_file_watcher()
            
            return True
            
        except Exception as e:
            logging.error(f"[go2rtc] Failed to start: {e}", exc_info=True)
            self.running = False
            return False
    
    def stop(self):
        """Stop go2rtc process"""
        if not self.running or not self.process:
            return
        
        logging.info("[go2rtc] Stopping...")
        self.running = False
        
        # Stop file watcher
        self._stop_file_watcher()
        
        try:
            if self.process:
                self.process.terminate()
                # Wait up to 5 seconds
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    logging.warning("[go2rtc] Process didn't terminate, forcing kill")
                    self.process.kill()
                    self.process.wait()
                
                self.process = None
                logging.info("[go2rtc] ✅ Stopped")
        except Exception as e:
            logging.error(f"[go2rtc] Error stopping: {e}")
    
    def _wait_for_go2rtc_ready(self, max_retries: int = 10, retry_interval: float = 0.5) -> bool:
        """Đợi go2rtc sẵn sàng nhận connections (check API health)"""
        import requests
        for i in range(max_retries):
            try:
                # Check API health endpoint
                response = requests.get("http://localhost:1984/api/streams", timeout=1)
                if response.status_code == 200:
                    logging.info(f"[go2rtc] ✅ go2rtc API is ready (attempt {i+1}/{max_retries})")
                    return True
            except:
                pass
                
            if i < max_retries - 1:
                time.sleep(retry_interval)
        
        logging.warning(f"[go2rtc] ⚠️ go2rtc API not ready after {max_retries} attempts")
        return False
    
    def wait_for_stream_ready(self, stream_id: str, max_retries: int = 20, retry_interval: float = 0.5) -> bool:
        """
        Đợi stream sẵn sàng trong go2rtc (có thể lấy snapshot)
        
        Args:
            stream_id: Stream ID cần check
            max_retries: Số lần retry tối đa
            retry_interval: Khoảng thời gian giữa các lần retry (giây)
            
        Returns:
            True nếu stream sẵn sàng, False nếu không
        """
        import requests
        for i in range(max_retries):
            try:
                # Thử lấy snapshot để check stream có sẵn sàng không
                snapshot_url = f"http://localhost:1984/api/frame.jpeg?src={stream_id}&width=640&height=360"
                response = requests.get(snapshot_url, timeout=2)
                if response.status_code == 200 and response.headers.get('content-type', '').startswith('image/'):
                    logging.info(f"[go2rtc] ✅ Stream {stream_id} is ready (attempt {i+1}/{max_retries})")
                    return True
            except:
                pass
            
            if i < max_retries - 1:
                time.sleep(retry_interval)
        
        logging.warning(f"[go2rtc] ⚠️ Stream {stream_id} not ready after {max_retries} attempts")
        return False
    
    def _restart_go2rtc_process(self):
        """Restart go2rtc process để reload config"""
        logging.info("[go2rtc] Restarting go2rtc process to reload config...")
        was_running = self.running
        if was_running:
            # Stop process (không stop file watcher)
            try:
                if self.process:
                    self.process.terminate()
                    try:
                        self.process.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        self.process.kill()
                        self.process.wait()
                    self.process = None
            except Exception as e:
                logging.error(f"[go2rtc] Error stopping process: {e}")
            
            self.running = False
            time.sleep(1)  # Đợi process stop hoàn toàn
        
        # Start lại
        if was_running:
            success = self.start()
            if success:
                logging.info("[go2rtc] ✅ Restarted go2rtc process successfully")
            else:
                logging.error("[go2rtc] ❌ Failed to restart go2rtc process")
    
    def _start_file_watcher(self):
        """Start file watcher để monitor go2rtc.yaml changes"""
        if not WATCHDOG_AVAILABLE:
            logging.warning("[go2rtc] File watcher not available (watchdog not installed)")
            return
        
        try:
            self.observer = Observer()
            event_handler = Go2RTCConfigWatcher(self)
            # Store reference để có thể set flag khi ghi file
            self.observer._event_handler = event_handler
            
            # Watch unified_app/go2rtc.yaml
            watch_dir = str(self.config_path.parent)
            self.observer.schedule(event_handler, watch_dir, recursive=False)
            self.observer.start()
            logging.info(f"[go2rtc] File watcher started: monitoring {self.config_path.name}")
        except Exception as e:
            logging.error(f"[go2rtc] Failed to start file watcher: {e}")
    
    def _stop_file_watcher(self):
        """Stop file watcher"""
        if self.observer:
            try:
                self.observer.stop()
                self.observer.join(timeout=2)
                self.observer = None
                logging.info("[go2rtc] File watcher stopped")
            except Exception as e:
                logging.error(f"[go2rtc] Error stopping file watcher: {e}")
    
    def _log_output(self):
        """Log go2rtc output"""
        if not self.process:
            return
        
        try:
            for line in self.process.stdout:
                if line:
                    logging.debug(f"[go2rtc] {line.strip()}")
        except Exception as e:
            logging.debug(f"[go2rtc] Log thread error: {e}")
    
    def is_running(self) -> bool:
        """Check if go2rtc is running"""
        if not self.process:
            return False
        
        return self.process.poll() is None
    
    def get_relay_url(self, stream_id: str) -> str:
        """Get RTSP relay URL từ go2rtc cho stream_id"""
        # go2rtc relay URL format: rtsp://localhost:8554/{stream_id}
        return f"rtsp://localhost:8554/{stream_id}"
    
    def get_snapshot_url(self, stream_id: str, width: int = None, height: int = None) -> str:
        """
        Get snapshot URL từ go2rtc cho stream_id (JPEG image)
        go2rtc tự decode raw stream và resize về width/height nếu có

        Args:
            stream_id: Stream ID (raw stream)
            width: Optional width để resize snapshot
            height: Optional height để resize snapshot

        Returns:
            Snapshot URL
        """
        # go2rtc snapshot API: http://localhost:1984/api/frame.jpeg?src={stream_id}
        url = f"http://localhost:1984/api/frame.jpeg?src={stream_id}"

        # Thêm width/height nếu có (go2rtc tự decode và resize)
        if width:
            url += f"&width={width}"
        if height:
            url += f"&height={height}"

        return url

    # ========== NEW: Dynamic Stream API (không cần restart go2rtc) ==========

    def add_stream_via_api(self, stream_id: str, stream_url: str) -> bool:
        """
        Add stream động qua go2rtc REST API (không cần restart/reload)

        API: PUT /api/streams?src={stream_url}&name={stream_id}

        Note: go2rtc dùng `name` là stream ID, `src` là source URL

        Args:
            stream_id: Stream ID (name)
            stream_url: RTSP URL của camera (src)

        Returns:
            True nếu thành công, False nếu thất bại
        """
        if not self.is_running():
            logging.warning("[go2rtc] Cannot add stream via API: go2rtc is not running")
            return False

        try:
            import requests
            from urllib.parse import quote

            # go2rtc API: PUT /api/streams?name={stream_id}&src={URL}
            # Or send src in body to avoid encoding issues with complex URLs
            api_url = f"http://localhost:1984/api/streams?name={quote(stream_id, safe='')}"

            logging.info(f"[go2rtc] Adding stream via API: {stream_id} -> {stream_url[:50]}...")
            
            # Send URL in body
            response = requests.put(api_url, data=stream_url, timeout=5)

            if response.status_code in (200, 201):
                logging.info(f"[go2rtc] ✅ Added stream via API: {stream_id} (instant, no restart)")
                return True
            else:
                logging.warning(f"[go2rtc] ⚠️ Add stream API returned {response.status_code}: {response.text}")
                return False

        except Exception as e:
            logging.error(f"[go2rtc] ❌ Failed to add stream via API: {e}")
            return False

    def remove_stream_via_api(self, stream_id: str) -> bool:
        """
        Remove stream động qua go2rtc REST API (không cần restart/reload)

        API: DELETE /api/streams?name={stream_id}

        Args:
            stream_id: Stream ID cần xóa

        Returns:
            True n���u thành công, False nếu thất bại
        """
        if not self.is_running():
            logging.warning("[go2rtc] Cannot remove stream via API: go2rtc is not running")
            return False

        try:
            import requests
            from urllib.parse import quote

            # go2rtc API: DELETE /api/streams?name={stream_id}
            api_url = f"http://localhost:1984/api/streams?name={quote(stream_id, safe='')}"

            logging.info(f"[go2rtc] Removing stream via API: {stream_id}")
            response = requests.delete(api_url, timeout=5)

            if response.status_code in (200, 204):
                logging.info(f"[go2rtc] ✅ Removed stream via API: {stream_id} (instant, no restart)")
                return True
            else:
                logging.warning(f"[go2rtc] ⚠️ Remove stream API returned {response.status_code}: {response.text}")
                return False

        except Exception as e:
            logging.error(f"[go2rtc] ❌ Failed to remove stream via API: {e}")
            return False

    def update_stream_via_api(self, stream_id: str, new_url: str) -> bool:
        """
        Update stream URL động qua go2rtc REST API
        Thực chất là remove rồi add lại với URL mới

        Args:
            stream_id: Stream ID cần update
            new_url: URL mới

        Returns:
            True nếu thành công, False nếu thất bại
        """
        # go2rtc không có update API riêng, dùng PUT sẽ tự overwrite
        return self.add_stream_via_api(stream_id, new_url)

    def check_stream_exists_via_api(self, stream_id: str) -> bool:
        """
        Check xem stream có tồn tại trong go2rtc không (qua API)

        Args:
            stream_id: Stream ID cần check

        Returns:
            True nếu stream tồn tại, False nếu không
        """
        if not self.is_running():
            return False

        try:
            import requests

            response = requests.get("http://localhost:1984/api/streams", timeout=2)
            if response.status_code == 200:
                streams = response.json()
                return stream_id in streams
            return False
        except:
            return False


# Global go2rtc manager instance
_go2rtc_manager: Optional[Go2RTCManager] = None


def get_go2rtc_manager() -> Go2RTCManager:
    """Get global go2rtc manager instance"""
    global _go2rtc_manager
    if _go2rtc_manager is None:
        _go2rtc_manager = Go2RTCManager()
    return _go2rtc_manager


def init_go2rtc() -> bool:
    """Initialize và start go2rtc"""
    manager = get_go2rtc_manager()
    return manager.start()


def stop_go2rtc():
    """Stop go2rtc"""
    manager = get_go2rtc_manager()
    manager.stop()

