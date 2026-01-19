"""
Timelapse Manager - Tạo timelapse từ recordings đã có
"""
import os
import subprocess
import time
import json
import logging
import shutil
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import json

from .recorder_manager import get_recorder_manager
from .config import load_config, save_config


class TimelapseCache:
    """
    Cache layer cho timelapse list để tránh scan filesystem liên tục.
    Cache có TTL 5 phút và tự động invalidate khi có video mới.
    LRU eviction policy để tránh memory leak.
    """
    def __init__(self, ttl_seconds: int = 300, max_size: int = 50):
        self.cache: Dict[str, Dict] = {}  # {camera_id: {data, timestamp, last_scan_time}}
        self.lock = threading.Lock()
        self.ttl_seconds = ttl_seconds
        self.max_size = max_size  # Max number of cameras to cache

    def get(self, camera_id: str) -> Optional[List[Dict]]:
        """Lấy cached data nếu còn valid"""
        with self.lock:
            if camera_id not in self.cache:
                return None

            cache_entry = self.cache[camera_id]
            age = time.time() - cache_entry["timestamp"]

            if age > self.ttl_seconds:
                # Cache expired
                return None

            return cache_entry["data"]

    def set(self, camera_id: str, data: List[Dict]):
        """Lưu data vào cache với LRU eviction"""
        with self.lock:
            # Evict oldest entry if cache is full
            if len(self.cache) >= self.max_size and camera_id not in self.cache:
                # Find oldest entry
                oldest_id = min(self.cache.keys(), key=lambda k: self.cache[k]["timestamp"])
                del self.cache[oldest_id]
                logging.debug(f"[TimelapseCache] Evicted oldest entry: {oldest_id}")

            self.cache[camera_id] = {
                "data": data,
                "timestamp": time.time()
            }

    def invalidate(self, camera_id: str):
        """Xóa cache cho 1 camera (khi có video mới)"""
        with self.lock:
            self.cache.pop(camera_id, None)

    def clear(self):
        """Xóa toàn bộ cache"""
        with self.lock:
            self.cache.clear()


class TimelapseManager:
    """
    Quản lý timelapse generation từ recordings.

    Logic:
    - Nhận config từ central: interval (5s), cycle (1h)
    - Đọc recordings trong khoảng thời gian (1h)
    - Extract frames từ recordings theo interval (mỗi 5s 1 frame)
    - Tạo timelapse video mỗi 1h
    - Lặp lại liên tục
    """

    def __init__(self):
        self.base_dir = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), "timelapse"
        )
        os.makedirs(self.base_dir, exist_ok=True)

        # Config cho mỗi camera: {camera_id: {interval_seconds, cycle_seconds, enabled}}
        self.configs: Dict[str, Dict] = {}
        self.running = False
        self.lock = threading.Lock()
        self.thread: Optional[threading.Thread] = None

        # State tracking: {camera_id: {last_cycle_end, current_cycle_start}}
        self.states: Dict[str, Dict] = {}

        # Cache layer for list_timelapses
        self.cache = TimelapseCache(ttl_seconds=300)  # 5 phút cache

        logging.info(f"[Timelapse] Initialized, base_dir: {self.base_dir}")
    
    def set_config(self, camera_id: str, interval_seconds: int, cycle_seconds: int, enabled: bool = True):
        """
        Set config cho 1 camera.
        
        Args:
            camera_id: ID của camera
            interval_seconds: Mỗi bao nhiêu giây extract 1 frame (ví dụ: 5s)
            cycle_seconds: Chu kỳ tạo timelapse (ví dụ: 3600s = 1h)
            enabled: Bật/tắt timelapse cho camera này
        """
        with self.lock:
            self.configs[camera_id] = {
                "interval_seconds": interval_seconds,
                "cycle_seconds": cycle_seconds,
                "enabled": enabled
            }
            
            if not enabled:
                # Xóa state nếu disable
                self.states.pop(camera_id, None)
            
            logging.info(f"[Timelapse] Config updated for {camera_id}: interval={interval_seconds}s, cycle={cycle_seconds}s, enabled={enabled}")
    
    def get_config(self, camera_id: str) -> Optional[Dict]:
        """Lấy config của 1 camera"""
        with self.lock:
            return self.configs.get(camera_id)
    
    def remove_config(self, camera_id: str):
        """Xóa config của 1 camera"""
        with self.lock:
            self.configs.pop(camera_id, None)
            self.states.pop(camera_id, None)
            logging.info(f"[Timelapse] Config removed for {camera_id}")
    
    def _get_recordings_in_range(self, camera_id: str, start_time: datetime, end_time: datetime) -> List[Dict]:
        """
        Lấy tất cả recordings trong khoảng thời gian.
        
        Returns:
            List of recording dicts với path, start time, etc.
        """
        recorder_manager = get_recorder_manager()
        all_recordings = recorder_manager.list_recordings(camera_id)
        
        # Filter recordings trong range
        filtered = []
        for rec in all_recordings:
            if not rec.get("start"):
                continue
            
            try:
                rec_start = datetime.fromisoformat(rec["start"])
                rec_duration = rec.get("duration_sec", 0)
                rec_end = rec_start + timedelta(seconds=rec_duration)
                
                # Check overlap: (StartA < EndB) and (EndA > StartB)
                # where A is recording, B is required range
                if rec_start < end_time and rec_end > start_time:
                    filtered.append(rec)
            except Exception as e:
                logging.debug(f"[Timelapse] Failed to parse recording start time: {e}")
                continue
        
        return filtered
    
    def _extract_frames_from_recordings(
        self, 
        recordings: List[Dict], 
        interval_seconds: int,
        output_frames_dir: str
    ) -> int:
        """
        Extract frames từ recordings theo interval.
        
        Logic:
        - Đi qua tất cả recordings theo thứ tự thời gian
        - Extract 1 frame mỗi interval_seconds từ tổng thời gian
        - Ví dụ: interval=5s, có 3 videos mỗi video 30s
          → Extract frame tại: 0s, 5s, 10s, 15s, 20s, 25s, 30s, 35s, 40s, ...
        
        Args:
            recordings: List of recording dicts (đã sorted theo start time)
            interval_seconds: Mỗi bao nhiêu giây extract 1 frame
            output_frames_dir: Thư mục output cho frames
        
        Returns:
            Số lượng frames đã extract
        """
        os.makedirs(output_frames_dir, exist_ok=True)
        recorder_manager = get_recorder_manager()
        base_dir = recorder_manager.base_dir
        
        frame_count = 0
        global_time_offset = 0  # Tổng thời gian đã xử lý (từ đầu chu kỳ)
        
        for rec in recordings:
            file_path = os.path.join(base_dir, rec["path"])
            if not os.path.exists(file_path):
                continue
            
            # Get video duration
            duration = rec.get("duration_sec", 30)
            
            # Tính số frames cần extract từ video này
            # Dựa trên global_time_offset và interval_seconds
            start_offset = global_time_offset
            end_offset = global_time_offset + duration
            
            # Tìm các thời điểm extract trong video này
            # Frame đầu tiên >= start_offset và chia hết cho interval_seconds
            first_frame_time = ((start_offset // interval_seconds) + 1) * interval_seconds
            if first_frame_time < start_offset:
                first_frame_time += interval_seconds
            
            # Extract frames từ first_frame_time đến end_offset, mỗi interval_seconds
            current_extract_time = first_frame_time
            while current_extract_time < end_offset:
                # Thời gian trong video này (relative to video start)
                frame_time_in_video = current_extract_time - start_offset
                
                if frame_time_in_video >= 0 and frame_time_in_video < duration:
                    # Extract frame tại thời điểm này
                    frame_filename = f"frame_{frame_count + 1:06d}.jpg"
                    frame_path = os.path.join(output_frames_dir, frame_filename)
                    
                    # Dùng ffmpeg để extract frame
                    # QUAN TRỌNG: Đặt -ss TRƯỚC -i để seek nhanh (input seeking), không phải output seeking
                    # Input seeking nhanh hơn nhiều vì FFmpeg không cần decode toàn bộ file
                    cmd = [
                        "ffmpeg",
                        "-y",
                        "-ss", str(frame_time_in_video),  # Seek TRƯỚC -i (input seeking - nhanh)
                        "-i", file_path,
                        "-frames:v", "1",
                        "-q:v", "2",  # Quality 2 (high quality)
                        "-vf", "scale=1920:1080",  # Resize về 1080p
                        "-an",  # Bỏ qua audio để nhanh hơn
                        frame_path
                    ]
                    
                    try:
                        result = subprocess.run(
                            cmd,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            timeout=30,  # Tăng timeout từ 10s lên 30s (giống như thumbnail generation)
                            text=True
                        )
                        
                        if result.returncode == 0 and os.path.exists(frame_path):
                            frame_count += 1
                        else:
                            logging.debug(f"[Timelapse] Failed to extract frame at {frame_time_in_video}s from {file_path}")
                    except Exception as e:
                        logging.debug(f"[Timelapse] Error extracting frame: {e}")
                
                current_extract_time += interval_seconds
            
            global_time_offset += duration
        
        return frame_count
    
    def _create_timelapse_video(self, frames_dir: str, output_video: str, fps: int = 30) -> bool:
        """
        Tạo timelapse video từ frames.
        
        Args:
            frames_dir: Thư mục chứa frames
            output_video: Đường dẫn output video
            fps: FPS của timelapse video (mặc định 30)
        
        Returns:
            True nếu thành công
        """
        frames = sorted(Path(frames_dir).glob("frame_*.jpg"))
        if len(frames) == 0:
            logging.warning(f"[Timelapse] No frames found in {frames_dir}")
            return False
        
        # Tạo video từ frames
        cmd = [
            "ffmpeg",
            "-y",
            "-framerate", str(fps),
            "-i", os.path.join(frames_dir, "frame_%06d.jpg"),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-crf", "23",  # Quality
            output_video
        ]
        
        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=600,  # 10 phút timeout
                text=True
            )
            
            if result.returncode == 0 and os.path.exists(output_video):
                logging.info(f"[Timelapse] Created timelapse video: {output_video} ({len(frames)} frames)")
                return True
            else:
                logging.error(f"[Timelapse] Failed to create video: {result.stderr}")
                return False
        except Exception as e:
            logging.error(f"[Timelapse] Error creating timelapse video: {e}")
            return False
    
    def _generate_thumbnail(self, video_path: str, output_path: str = None) -> bool:
        """
        Tạo thumbnail cho video timelapse (frame đầu tiên).
        """
        try:
            video_dir = os.path.dirname(video_path)
            video_basename = os.path.basename(video_path)
            name_without_ext = os.path.splitext(video_basename)[0]
            
            if output_path:
                thumbnail_path = output_path
            else:
                thumbnail_path = os.path.join(video_dir, f"{name_without_ext}_thumb.jpg")
            
            # Use input seeking (-ss before -i) for speed
            cmd = [
                "ffmpeg",
                "-y",
                "-ss", "0.1", 
                "-i", video_path,
                "-frames:v", "1",
                "-q:v", "3",
                "-vf", "scale=320:240",
                "-an",
                thumbnail_path
            ]
            
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=30,
                text=True
            )
            
            if result.returncode == 0 and os.path.exists(thumbnail_path):
                if os.path.getsize(thumbnail_path) > 0:
                    logging.info(f"[Timelapse] ✅ Created thumbnail: {thumbnail_path}")
                    return True
            
            logging.warning(f"[Timelapse] Failed to create thumbnail for {video_basename}")
            return False
        except Exception as e:
            logging.error(f"[Timelapse] Error creating thumbnail: {e}")
            return False

    
    def generate_timelapse(self, camera_id: str, start_time: datetime, end_time: datetime) -> Optional[str]:
        """
        Tạo timelapse video cho 1 camera trong khoảng thời gian.
        
        Args:
            camera_id: ID của camera
            start_time: Thời gian bắt đầu
            end_time: Thời gian kết thúc
        
        Returns:
            Đường dẫn đến timelapse video nếu thành công, None nếu thất bại
        """
        config = self.get_config(camera_id)
        if not config or not config.get("enabled"):
            return None
        
        interval_seconds = config.get("interval_seconds", 5)
        
        # Determine output filename first to check existence
        cycle_seconds = config.get("cycle_seconds", 3600)
        if cycle_seconds < 86400:  # < 1 ngày
            folder_str = start_time.strftime("%Y%m%d")  # 20250109
        elif cycle_seconds < 2592000:  # < 1 tháng (~30 ngày)
            folder_str = start_time.strftime("%Y%m")  # 202501
        else:  # >= 1 tháng
            folder_str = start_time.strftime("%Y")  # 2025
        
        output_name = f"{camera_id}_{start_time.strftime('%Y%m%d_%H%M%S')}_{end_time.strftime('%Y%m%d_%H%M%S')}"
        output_dir = os.path.join(self.base_dir, camera_id, folder_str, output_name)
        output_video = os.path.join(output_dir, f"{output_name}.mp4")
        
        # Check folders existence (folder chieens video)
        if os.path.exists(output_video) and os.path.getsize(output_video) > 0:
            logging.info(f"[Timelapse] Skipping generation for {camera_id}: {output_name} already exists")
            return output_video
            
        # Lấy recordings trong range
        recordings = self._get_recordings_in_range(camera_id, start_time, end_time)
        if len(recordings) == 0:
            # logging.info(f"[Timelapse] No recordings found for {camera_id} in range {start_time} - {end_time} (gap)") # Reduce log spam
            return None
        
        # Check camera type from config to ensure we don't process non-RTSP sources intentionally
        try:
             app_config = load_config()
             meta = app_config.get("metadata", {}).get(camera_id, {})
             if meta.get("type") == "video":
                 logging.info(f"[Timelapse] Skipping timelapse for {camera_id} because it is a VIDEO FILE source")
                 return None
        except:
             pass
        
        logging.info(f"[Timelapse] Generating timelapse for {camera_id}: {len(recordings)} recordings, {start_time} - {end_time}")
        
        # Tạo thư mục tạm cho frames
        temp_id = f"{camera_id}_{start_time.strftime('%Y%m%d_%H%M%S')}_{end_time.strftime('%Y%m%d_%H%M%S')}"
        temp_dir = os.path.join(self.base_dir, "temp", temp_id)
        frames_dir = os.path.join(temp_dir, "frames")
        os.makedirs(frames_dir, exist_ok=True)
        
        try:
            # Extract frames từ recordings
            frame_count = self._extract_frames_from_recordings(recordings, interval_seconds, frames_dir)
            
            if frame_count == 0:
                logging.warning(f"[Timelapse] No frames extracted for {camera_id}")
                return None
            
            # Tạo folder output (folder con chứa video + metadata)
            os.makedirs(output_dir, exist_ok=True)
            
            success = self._create_timelapse_video(frames_dir, output_video)
            
            if success:
                # Generate thumbnail
                thumb_path = os.path.join(output_dir, f"{output_name}_thumb.jpg")
                self._generate_thumbnail(output_video, thumb_path)
                
                # Save Metadata
                try:
                    # Calculate actual video duration based on FPS (default 30)
                    fps = 30 
                    actual_duration = round(frame_count / fps, 2)
                    
                    meta = {
                        "camera_id": camera_id,
                        "start_time": start_time.isoformat(),
                        "end_time": end_time.isoformat(),
                        # "frame_count": frame_count, # Validated as redundant by user
                        "duration_seconds": actual_duration,
                        "created_at": datetime.now().isoformat(),
                        "size_bytes": os.path.getsize(output_video)
                    }
                    meta_path = os.path.join(output_dir, "metadata.json")
                    with open(meta_path, 'w') as f:
                        json.dump(meta, f, indent=2)
                except Exception as e:
                    logging.warning(f"[Timelapse] Failed to save metadata: {e}")

                # Cleanup temp frames
                try:
                    shutil.rmtree(temp_dir, ignore_errors=True)
                except Exception as e:
                    logging.debug(f"[Timelapse] Failed to cleanup temp dir: {e}")

                # Invalidate cache khi có video mới
                self.cache.invalidate(camera_id)

                return output_video
            else:
                # Cleanup output dir if failed
                try:
                     shutil.rmtree(output_dir, ignore_errors=True)
                except:
                     pass
                return None
                
        except Exception as e:
            logging.error(f"[Timelapse] Error generating timelapse for {camera_id}: {e}", exc_info=True)
            # Cleanup on error
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except:
                pass
            return None
    
    def _scheduler_loop(self):
        """Main scheduler loop - chạy mỗi 30 giây để check cycle"""
        logging.info("[Timelapse] Scheduler loop started")
        
        while self.running:
            try:
                # 1. Reload global config from yaml
                try:
                    app_config = load_config()
                    tl_conf = app_config.get("timelapse", {})
                    global_enabled = tl_conf.get("enabled", True)
                    global_interval = tl_conf.get("interval_seconds", 5)
                    global_cycle = tl_conf.get("cycle_seconds", 3600)
                    
                    # 2. Sync configs for active recorders
                    from .recorder_manager import get_recorder_manager
                    recorder_mgr = get_recorder_manager()
                    
                    # Convert dict keys to list to avoid runtime change error during iteration
                    active_cameras = list(recorder_mgr.recorders.keys())
                    
                    with self.lock:
                        # Add/Update active cameras
                        for cam_id in active_cameras:
                            # Nếu config chưa có hoặc khác -> update
                            curr = self.configs.get(cam_id, {})
                            if (curr.get("interval_seconds") != global_interval or
                                curr.get("cycle_seconds") != global_cycle or
                                curr.get("enabled") != global_enabled):
                                
                                self.configs[cam_id] = {
                                    "interval_seconds": global_interval,
                                    "cycle_seconds": global_cycle,
                                    "enabled": global_enabled
                                }
                                # Initialize state if new
                                if cam_id not in self.states:
                                    # Logic init state sẽ được xử lý ở bước dưới
                                    pass
                except Exception as e:
                    logging.warning(f"[Timelapse] Failed to sync config: {e}")

                with self.lock:
                    configs_copy = self.configs.copy()
                    states_copy = self.states.copy()
                
                now = datetime.now()
                
                for camera_id, config in configs_copy.items():
                    if not config.get("enabled"):
                        continue
                    
                    cycle_seconds = config.get("cycle_seconds", 3600)
                    
                    # Initialize state nếu chưa có
                    if camera_id not in states_copy or not states_copy[camera_id].get("current_cycle_start"):
                        # Backfill logic: Tìm thời điểm bắt đầu của video sớm nhất
                        earliest_start = now
                        try:
                             # Lazy import để tránh circular import nếu có
                            from .recorder_manager import get_recorder_manager
                            recorder = get_recorder_manager()
                            recs = recorder.list_recordings(camera_id)
                            
                            valid_starts = []
                            for r in recs:
                                if r.get("start"):
                                    try:
                                        valid_starts.append(datetime.fromisoformat(r["start"]))
                                    except:
                                        pass
                            
                            if valid_starts:
                                earliest_start = min(valid_starts)
                                logging.info(f"[Timelapse] Found historical data for {camera_id}, starting backfill from {earliest_start}")
                        except Exception as e:
                            logging.warning(f"[Timelapse] Failed to check history for {camera_id}: {e}")

                        states_copy[camera_id] = {
                            "last_cycle_end": None,
                            "current_cycle_start": earliest_start
                        }
                        self.states[camera_id] = states_copy[camera_id]
                        continue
                    
                    state = states_copy[camera_id]
                    cycle_start = state.get("current_cycle_start")
                    
                    # Sanity check
                    if not cycle_start:
                        state["current_cycle_start"] = now
                        self.states[camera_id] = state
                        continue
                    
                    # Check nếu đã hết cycle
                    elapsed = (now - cycle_start).total_seconds()
                    
                    if elapsed >= cycle_seconds:
                        # Check if already generating to enforce sequential processing
                        if state.get("is_generating"):
                            # logging.debug(f"[Timelapse] Waiting for previous generation to finish for {camera_id}")
                            continue

                        # Cycle kết thúc - tạo timelapse
                        cycle_end = cycle_start + timedelta(seconds=cycle_seconds)
                        
                        # Chỉ log info nếu đây là cycle hiện tại (gần now), còn backfill thì log debug cho đỡ spam
                        is_catchup = (now - cycle_end).total_seconds() > cycle_seconds * 2
                        
                        if not is_catchup:
                             logging.info(f"[Timelapse] Cycle ended for {camera_id}: {cycle_start} - {cycle_end}")
                        
                        # Set lock flag
                        state["is_generating"] = True
                        self.states[camera_id] = state # Update global state immediately

                        # Generate timelapse trong background thread để không block scheduler
                        def _generate(c_id, c_start, c_end):
                            try:
                                video_path = self.generate_timelapse(c_id, c_start, c_end)
                                if video_path:
                                    logging.info(f"[Timelapse] ✅ Created timelapse for {c_id}: {video_path}")
                                # Suppress failure warnings during backfill if gap is empty
                            except Exception as e:
                                logging.error(f"[Timelapse] Thread error for {c_id}: {e}")
                            finally:
                                # Release lock and advance state (only on finish)
                                # Need to acquire lock to update shared state safely
                                with self.lock:
                                    # Reload state to get latest
                                    current_state = self.states.get(c_id, {})
                                    if current_state:
                                        current_state["is_generating"] = False
                                        # Advance to next cycle ONLY after finish
                                        current_state["current_cycle_start"] = c_end
                                        current_state["last_cycle_end"] = c_end
                                        self.states[c_id] = current_state
                        
                        thread = threading.Thread(target=_generate, args=(camera_id, cycle_start, cycle_end), daemon=True)
                        thread.start()
                        
                        # DO NOT update current_cycle_start here regardless, wait for thread
                        continue
                    
            except Exception as e:
                logging.error(f"[Timelapse] Error in scheduler loop: {e}", exc_info=True)
            
            # Sleep 30 giây trước khi check lại
            time.sleep(30)
        
        logging.info("[Timelapse] Scheduler loop stopped")
    
    def start(self):
        """Start timelapse scheduler"""
        with self.lock:
            if self.running:
                return
            self.running = True
        
        self.thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self.thread.start()
        logging.info("[Timelapse] ✅ Scheduler started")
    
    def stop(self):
        """Stop timelapse scheduler"""
        with self.lock:
            self.running = False
        
        if self.thread:
            self.thread.join(timeout=5)
        logging.info("[Timelapse] Scheduler stopped")
    
    def _scan_timelapses_optimized(self, camera_id: str) -> List[Dict]:
        """
        Quét timelapse videos với optimization:
        - Scan folders theo thứ tự mới nhất trước (date folders sorted descending)
        - Đọc metadata song song nếu có nhiều files
        - Cache kết quả để tránh re-scan liên tục

        Returns:
            List of dicts sorted by created_at descending (mới nhất trước)
        """
        camera_dir = os.path.join(self.base_dir, camera_id)
        if not os.path.exists(camera_dir):
            return []

        timelapses = []

        try:
            # Lấy danh sách date folders và sort descending (mới nhất trước)
            # Date folders có format: YYYYMMDD, YYYYMM, hoặc YYYY
            date_folders = []
            for item in os.listdir(camera_dir):
                item_path = os.path.join(camera_dir, item)
                if os.path.isdir(item_path):
                    date_folders.append((item, item_path))
                elif item.lower().endswith(".mp4"):
                    # Backward compatibility: files ở root
                    self._add_timelapse_entry(camera_dir, item, camera_id, timelapses)

            # Sort date folders descending (mới nhất trước)
            date_folders.sort(key=lambda x: x[0], reverse=True)

            # Scan từng date folder
            for date_folder_name, date_folder_path in date_folders:
                try:
                    # Trong date folder có thể có:
                    # 1. Video folders (camera_id_start_end)
                    # 2. Video files trực tiếp (backward compatibility)
                    items = os.listdir(date_folder_path)

                    # Collect video folders first, sort by name descending
                    video_folders = []
                    for item in items:
                        item_path = os.path.join(date_folder_path, item)
                        if os.path.isdir(item_path):
                            video_folders.append((item, item_path))
                        elif item.lower().endswith(".mp4"):
                            self._add_timelapse_entry(date_folder_path, item, camera_id, timelapses)

                    # Sort video folders descending
                    video_folders.sort(key=lambda x: x[0], reverse=True)

                    # Scan video folders
                    for folder_name, folder_path in video_folders:
                        for filename in os.listdir(folder_path):
                            if filename.lower().endswith(".mp4"):
                                self._add_timelapse_entry(folder_path, filename, camera_id, timelapses)

                except (PermissionError, OSError) as e:
                    logging.debug(f"[Timelapse] Cannot scan date folder {date_folder_path}: {e}")
                    continue

        except Exception as e:
            logging.error(f"[Timelapse] Error scanning timelapses for {camera_id}: {e}", exc_info=True)

        # Sort toàn bộ list theo created_at descending (mới nhất trước)
        # Sử dụng start_time từ metadata nếu có, fallback về created_at
        timelapses.sort(
            key=lambda x: x.get("start_time") or x.get("created_at") or "",
            reverse=True
        )

        return timelapses

    def _add_timelapse_entry(self, directory_path: str, filename: str, camera_id: str, timelapses: List[Dict]):
        """
        Helper method để thêm 1 timelapse entry vào list.
        Đọc metadata nhanh hơn bằng cách chỉ đọc khi cần.
        """
        try:
            item_path = os.path.join(directory_path, filename)
            stat = os.stat(item_path)
            size = stat.st_size
            created_at = datetime.fromtimestamp(stat.st_mtime).isoformat()

            entry = {
                "camera_id": camera_id,
                "filename": filename,
                "path": os.path.relpath(item_path, self.base_dir).replace("\\", "/"),
                "size_bytes": size,
                "created_at": created_at
            }

            # Check for thumbnail
            name_without_ext = os.path.splitext(filename)[0]
            thumb_name = f"{name_without_ext}_thumb.jpg"
            thumb_path = os.path.join(directory_path, thumb_name)
            if os.path.exists(thumb_path):
                entry["has_thumbnail"] = True
                entry["thumbnail_path"] = os.path.relpath(thumb_path, self.base_dir).replace("\\", "/")

            # Check for metadata.json (trong cùng folder)
            meta_path = os.path.join(directory_path, "metadata.json")
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, 'r', encoding='utf-8') as f:
                        meta = json.load(f)
                        # Merge metadata info
                        if "duration_seconds" in meta:
                            entry["duration_seconds"] = meta["duration_seconds"]
                        if "frame_count" in meta:
                            entry["frame_count"] = meta["frame_count"]
                        if "start_time" in meta:
                            entry["start_time"] = meta["start_time"]
                        if "end_time" in meta:
                            entry["end_time"] = meta["end_time"]
                except Exception as e:
                    logging.debug(f"[Timelapse] Failed to read metadata for {filename}: {e}")

            timelapses.append(entry)

        except Exception as e:
            logging.debug(f"[Timelapse] Failed to add entry for {filename}: {e}")

    def list_timelapses(self, camera_id: str, use_cache: bool = True) -> List[Dict]:
        """
        Liệt kê timelapse videos của 1 camera.

        Args:
            camera_id: ID của camera
            use_cache: Có sử dụng cache không (default: True)

        Returns:
            List of dicts với path, filename, created_at, size_bytes (sorted mới nhất trước)
        """
        # Check cache first
        if use_cache:
            cached = self.cache.get(camera_id)
            if cached is not None:
                logging.debug(f"[Timelapse] Cache hit for {camera_id}")
                return cached

        # Cache miss - scan filesystem
        logging.debug(f"[Timelapse] Cache miss for {camera_id}, scanning filesystem...")
        timelapses = self._scan_timelapses_optimized(camera_id)

        # Save to cache
        if use_cache:
            self.cache.set(camera_id, timelapses)

        return timelapses
    
    def get_status(self, camera_id: str) -> Dict:
        """
        Lấy trạng thái timelapse của 1 camera.
        
        Returns:
            Dict với thông tin về config, cycle, state
        """
        with self.lock:
            config = self.configs.get(camera_id)
            state = self.states.get(camera_id)
        
        if not config:
            return {
                "camera_id": camera_id,
                "enabled": False,
                "reason": "no_config",
                "message": "Timelapse chưa được cấu hình cho camera này"
            }
        
        if not config.get("enabled"):
            return {
                "camera_id": camera_id,
                "enabled": False,
                "reason": "disabled",
                "interval_seconds": config.get("interval_seconds"),
                "cycle_seconds": config.get("cycle_seconds"),
                "message": "Timelapse đã được cấu hình nhưng đang tắt"
            }
        
        # Camera có config và enabled
        now = datetime.now()
        cycle_start = state.get("current_cycle_start") if state else None
        cycle_seconds = config.get("cycle_seconds", 3600)
        interval_seconds = config.get("interval_seconds", 5)
        
        if not cycle_start:
            return {
                "camera_id": camera_id,
                "enabled": True,
                "is_active": False,
                "reason": "not_started",
                "interval_seconds": interval_seconds,
                "cycle_seconds": cycle_seconds,
                "message": "Chờ khởi tạo cycle đầu tiên"
            }
        
        # Tính toán thời gian
        elapsed = (now - cycle_start).total_seconds()
        remaining = max(0, cycle_seconds - elapsed)
        progress_percent = min(100, (elapsed / cycle_seconds) * 100) if cycle_seconds > 0 else 0
        
        # Check xem có đang generate timelapse không (nếu cycle vừa kết thúc)
        is_generating = False
        if elapsed >= cycle_seconds:
            is_generating = True
        
        # Lấy số lượng timelapse videos đã tạo
        timelapse_count = len(self.list_timelapses(camera_id))
        
        return {
            "camera_id": camera_id,
            "enabled": True,
            "is_active": True,
            "interval_seconds": interval_seconds,
            "cycle_seconds": cycle_seconds,
            "current_cycle_start": cycle_start.isoformat() if isinstance(cycle_start, datetime) else str(cycle_start),
            "current_time": now.isoformat(),
            "elapsed_seconds": round(elapsed, 1),
            "remaining_seconds": round(remaining, 1),
            "progress_percent": round(progress_percent, 1),
            "is_generating": is_generating,
            "timelapse_count": timelapse_count,
            "base_dir": self.base_dir,
            "message": f"Đang chạy cycle: {round(elapsed)}s / {cycle_seconds}s ({round(progress_percent)}%)" if not is_generating else "Đang tạo timelapse video..."
        }


_timelapse_manager: Optional[TimelapseManager] = None


def get_timelapse_manager() -> TimelapseManager:
    global _timelapse_manager
    if _timelapse_manager is None:
        _timelapse_manager = TimelapseManager()
        _timelapse_manager.start()
    return _timelapse_manager

