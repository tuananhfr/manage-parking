import os
import threading
import subprocess
import logging
import shutil
import json
import time
import re
from datetime import datetime
from typing import Dict, List, Optional

from ..go2rtc_manager import get_go2rtc_manager
from ..config import load_config


class CameraRecorder:
    """
    Quản lý ffmpeg process ghi hình 24/7 cho 1 camera (continuous recording).

    - Ghi từ go2rtc relay: rtsp://localhost:8554/{camera_id}
    - Chia file mỗi 30 giây (segment_seconds) bằng segment muxer
    - Layout thư mục:
        recordings/{camera_id}/{YYYYMMDD}/{YYYYMMDD_HHMMSS}.mp4
    """

    def __init__(self, camera_id: str, base_dir: str = None, segment_seconds: int = 30, source_url: Optional[str] = None):
        self.camera_id = camera_id
        self.segment_seconds = segment_seconds
        self.base_dir = base_dir or os.path.join(
            os.path.dirname(os.path.dirname(__file__)), "recordings"
        )
        self.process: Optional[subprocess.Popen] = None
        self.lock = threading.Lock()
        self.running = False
        self.last_error: Optional[str] = None
        # URL nguồn ghi hình (RTSP trực tiếp). Nếu None sẽ fallback sang go2rtc relay.
        self.source_url: Optional[str] = source_url

    def _build_output_pattern(self) -> str:
        """Xây dựng pattern path cho file output ffmpeg (dùng strftime)."""
        # Cấu trúc mới: recordings/{cid}/%Y%m%d/%Y%m%d_%H%M%S/%Y%m%d_%H%M%S.mp4
        # Mỗi video có folder riêng chứa: video.mp4, video_thumb.jpg, video_timelapse.mp4
        camera_dir = os.path.join(self.base_dir, self.camera_id)
        os.makedirs(camera_dir, exist_ok=True)
        
        # IMPORTANT: os.path.join uses backslash on Windows, we need forward slash for FFmpeg
        # We need absolute path for ffmpeg to be safe
        camera_dir_abs = os.path.abspath(camera_dir).replace("\\", "/")
        
        # Pattern: D:/path/to/recordings/v/%Y%m%d/%Y%m%d_%H%M%S.mp4
        # Note: FFmpeg segment muxer không tự động tạo nested directories
        # File sẽ được ghi vào date folder, sau đó được di chuyển vào folder riêng khi process
        pattern = f"{camera_dir_abs}/%Y%m%d/%Y%m%d_%H%M%S.mp4"
        return pattern

    def _ensure_current_date_dir(self):
        """Ensure folder for today exists (ffmpeg cannot create it)."""
        try:
            now = datetime.now()
            # Valid for today
            date_str = now.strftime("%Y%m%d")
            path = os.path.join(self.base_dir, self.camera_id, date_str)
            os.makedirs(path, exist_ok=True)
            
            # Pre-create for tomorrow (to handle midnight transition safely)
            import datetime as dt
            tomorrow = now + dt.timedelta(days=1)
            date_str_tom = tomorrow.strftime("%Y%m%d")
            path_tom = os.path.join(self.base_dir, self.camera_id, date_str_tom)
            os.makedirs(path_tom, exist_ok=True)
        except Exception as e:
            logging.error(f"[Recorder] Failed to create date directories: {e}")

    def _launch_process(self):
        """Internal method to launch ffmpeg process."""
        # Luôn ghi từ go2rtc relay: rtsp://localhost:8554/{camera_id}
        go2rtc_manager = get_go2rtc_manager()
        if not go2rtc_manager.is_running():
            logging.warning(f"[Recorder] {self.camera_id}: go2rtc not running")
            self.last_error = "go2rtc not running"
            return False

        # 🔥 CRITICAL: Đợi go2rtc stream ready trước khi start recorder
        # Điều này đặc biệt quan trọng cho camera stream-only (detection disabled)
        # vì không có detection thread để "warm up" stream
        max_retries = 30  # 30 lần x 1s = 30 giây timeout
        for attempt in range(max_retries):
            try:
                stream_ready = go2rtc_manager.check_stream_status(self.camera_id)
                if stream_ready:
                    logging.info(f"[Recorder] {self.camera_id}: go2rtc stream ready (attempt {attempt + 1}/{max_retries})")
                    break
            except Exception as e:
                logging.debug(f"[Recorder] {self.camera_id}: stream check error: {e}")

            if attempt < max_retries - 1:
                time.sleep(1.0)  # Đợi 1 giây trước khi retry
            else:
                logging.warning(f"[Recorder] {self.camera_id}: go2rtc stream not ready after {max_retries}s, will try anyway")
                # Không return False, vẫn thử start recorder (có thể stream ready sau đó)

        relay_url = go2rtc_manager.get_relay_url(self.camera_id)

        # Đảm bảo thư mục ngày hiện tại tồn tại
        self._ensure_current_date_dir()
        output_pattern = self._build_output_pattern()

        ffmpeg_path = "ffmpeg"
        if not shutil.which(ffmpeg_path):
            logging.error("[Recorder] ffmpeg binary not found")
            self.last_error = "ffmpeg not found in PATH"
            return False

        # Ghi từ go2rtc RTSP, ép TCP giống hệt script record_test.py (đã verify OK)
        # và CHỈ copy video stream, tắt audio để tránh lỗi pcm_alaw với MP4
        ffmpeg_cmd = [
            ffmpeg_path,
            "-rtsp_transport",
            "tcp",          # ép dùng TCP khi connect tới go2rtc relay
            "-use_wallclock_as_timestamps",
            "1",
            "-i",
            relay_url,
            "-map",
            "0:v:0",        # chỉ lấy video stream đầu tiên
            "-c:v",
            "copy",         # copy video, không re-encode
            "-an",          # tắt audio (MP4 không support pcm_alaw)
            "-f",
            "segment",
            "-segment_time",
            str(self.segment_seconds),
            "-reset_timestamps",
            "1",
            "-strftime",
            "1",
            "-loglevel",
            "warning",
            output_pattern,
        ]

        logging.info(f"[Recorder] Launching recorder for {self.camera_id}: {' '.join(ffmpeg_cmd)}")

        try:
            self.process = subprocess.Popen(
                ffmpeg_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1
            )
            
            # Log ffmpeg errors in background thread
            def _log_ffmpeg_stderr():
                if not self.process:
                    return
                try:
                    for line in self.process.stderr:
                        if "error" in line.lower() or "fail" in line.lower() or "warning" in line.lower():
                            logging.warning(f"[Recorder] {self.camera_id} ffmpeg: {line.strip()}")
                except Exception as e:
                    logging.error(f"[Recorder] Error reading ffmpeg stderr: {e}")

            threading.Thread(target=_log_ffmpeg_stderr, daemon=True).start()
            return True

        except Exception as e:
            logging.error(f"[Recorder] Failed to launch recorder for {self.camera_id}: {e}", exc_info=True)
            self.process = None
            self.last_error = str(e)
            return False

    def _generate_thumbnail_and_timelapse(self, video_path: str):
        """
        Tự động tạo thumbnail và timelapse cho video vừa ghi xong.
        
        Args:
            video_path: Đường dẫn đến file video MP4
        """
        if not os.path.exists(video_path):
            logging.warning(f"[Recorder] Video file not found: {video_path}")
            return
        
        # Kiểm tra file size > 0 (đảm bảo file hợp lệ, không phải empty file)
        try:
            file_size = os.path.getsize(video_path)
            if file_size == 0:
                logging.warning(f"[Recorder] Video file is empty: {video_path}")
                return
            if file_size < 1024:  # File quá nhỏ (< 1KB) có thể bị corrupt
                logging.warning(f"[Recorder] Video file too small (may be corrupt): {video_path} ({file_size} bytes)")
                return
        except Exception as e:
            logging.warning(f"[Recorder] Failed to check video file size: {e}")
            return
        
        # Validate video file integrity using ffprobe
        try:
            # Check duration and validity
            check_cmd = [
                "ffprobe", 
                "-v", "error", 
                "-select_streams", "v:0", 
                "-show_entries", "stream=codec_type", 
                "-of", "default=noprint_wrappers=1:nokey=1",
                video_path
            ]
            check_result = subprocess.run(
                check_cmd, 
                stdout=subprocess.PIPE, 
                stderr=subprocess.PIPE,
                timeout=5,
                text=True
            )
            
            # If ffprobe returns error or empty output, file is corrupt
            if check_result.returncode != 0 or not check_result.stdout.strip():
                logging.warning(f"[Recorder] Video file is corrupt (ffprobe failed): {video_path}. Error: {check_result.stderr}")
                # Optional: Delete or move corrupt file to avoid reprocessing loop
                try:
                    corrupt_dir = os.path.join(os.path.dirname(video_path), "corrupt")
                    os.makedirs(corrupt_dir, exist_ok=True)
                    shutil.move(video_path, os.path.join(corrupt_dir, os.path.basename(video_path)))
                    logging.info(f"[Recorder] Moved corrupt file to: {corrupt_dir}")
                except Exception as e:
                    logging.error(f"[Recorder] Failed to move corrupt file: {e}")
                return
                
        except Exception as e:
            logging.warning(f"[Recorder] Failed to validate video file: {e}")
            return
        
        try:
            video_dir = os.path.dirname(video_path)
            video_basename = os.path.basename(video_path)
            name_without_ext = os.path.splitext(video_basename)[0]
            
            thumbnail_path = os.path.join(video_dir, f"{name_without_ext}_thumb.jpg")
            timelapse_path = os.path.join(video_dir, f"{name_without_ext}_timelapse.mp4")
            
            # Check nếu đã có rồi thì skip (và verify files are valid)
            if os.path.exists(thumbnail_path) and os.path.exists(timelapse_path):
                try:
                    if os.path.getsize(thumbnail_path) > 0 and os.path.getsize(timelapse_path) > 0:
                        return  # Files đã tồn tại và valid
                except Exception:
                    pass  # Nếu có lỗi khi check size, tiếp tục generate lại
            
            logging.info(f"[Recorder] Generating thumbnail and timelapse for {video_basename} (size: {file_size} bytes)")
            
            # Generate thumbnail (frame đầu tiên tại 0.1s)
            # QUAN TRỌNG: Đặt -ss TRƯỚC -i để seek nhanh (input seeking), không phải output seeking
            # Input seeking nhanh hơn nhiều vì FFmpeg không cần decode toàn bộ file
            thumbnail_cmd = [
                "ffmpeg",
                "-y",
                "-ss", "0.1",  # Seek TRƯỚC -i (input seeking - nhanh)
                "-i", video_path,
                "-frames:v", "1",
                "-q:v", "3",
                "-vf", "scale=320:240",
                "-an",  # Bỏ qua audio để nhanh hơn
                thumbnail_path
            ]
            
            # Tăng timeout lên 30s và thêm error handling tốt hơn
            result = subprocess.run(
                thumbnail_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=30,  # Tăng timeout lên 30s
                text=True
            )
            
            if result.returncode == 0 and os.path.exists(thumbnail_path):
                # Verify thumbnail file size > 0
                if os.path.getsize(thumbnail_path) > 0:
                    logging.info(f"[Recorder] ✅ Created thumbnail: {thumbnail_path}")
                else:
                    logging.warning(f"[Recorder] Thumbnail created but file is empty: {thumbnail_path}")
                    if os.path.exists(thumbnail_path):
                        os.remove(thumbnail_path)
            else:
                error_msg = result.stderr if result.stderr else "Unknown error"
                logging.warning(f"[Recorder] Failed to create thumbnail: {error_msg}")
            
            # Generate timelapse (mỗi 2s 1 frame từ video gốc)
            # Extract frames mỗi 2s, sau đó tạo video timelapse từ frames
            temp_frames_dir = os.path.join(video_dir, f".temp_{name_without_ext}_frames")
            
            # QUAN TRỌNG: Đảm bảo thư mục tồn tại và có quyền ghi TRƯỚC KHI chạy FFmpeg
            try:
                # Normalize temp dir path for Windows/FFmpeg
                temp_frames_dir = os.path.abspath(temp_frames_dir).replace("\\", "/")
                os.makedirs(temp_frames_dir, exist_ok=True)
                
                # Test write permission bằng cách tạo một file test
                test_file = os.path.join(temp_frames_dir, ".test_write")
                try:
                    with open(test_file, 'w') as f:
                        f.write("test")
                    os.remove(test_file)
                    logging.debug(f"[Recorder] ✅ Temp directory writable: {temp_frames_dir}")
                except (OSError, IOError) as e:
                    raise Exception(f"Cannot write to temp directory {temp_frames_dir}: {e}")
            except Exception as e:
                logging.error(f"[Recorder] Failed to create/write to temp directory {temp_frames_dir}: {e}")
                return  # Skip timelapse generation nếu không thể tạo thư mục
            
            try:
                # Extract frames mỗi 2s (fps=0.5 = 1 frame mỗi 2 giây)
                # Sử dụng input seeking để tăng tốc: bắt đầu từ 0s, extract mỗi 2s
                # Ensure video_path is also normalized
                video_path_ffmpeg = os.path.abspath(video_path).replace("\\", "/")
                output_pattern = f"{temp_frames_dir}/frame_%04d.jpg"
                
                extract_cmd = [
                    "ffmpeg",
                    "-y",
                    "-loglevel", "error",  # Chỉ log errors để tránh spam
                    "-stats",  # Hiển thị progress
                    "-ss", "0",  # Bắt đầu từ đầu video
                    "-i", video_path_ffmpeg,
                    "-vf", "fps=0.5,scale=640:360",  # 0.5 fps = 1 frame mỗi 2s, resize về 640x360
                    "-q:v", "2",
                    "-an",  # Bỏ qua audio để nhanh hơn
                    output_pattern
                ]
                
                logging.info(f"[Recorder] Extracting frames from {video_basename} to {temp_frames_dir}")
                result = subprocess.run(
                    extract_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=120,  # Tăng timeout cho timelapse (có thể nhiều frames)
                    text=True
                )
                
                # QUAN TRỌNG: Chờ process hoàn toàn xong mới đọc frames
                # Kiểm tra returncode và stderr để xác định lỗi I/O
                if result.returncode != 0:
                    error_msg = result.stderr if result.stderr else "Unknown error"
                    logging.warning(f"[Recorder] Failed to extract frames from {video_basename}: {error_msg}")
                    # Kiểm tra xem có frames nào được extract không (partial success)
                    if os.path.exists(temp_frames_dir):
                        frames = sorted([f for f in os.listdir(temp_frames_dir) if f.endswith('.jpg')])
                        if len(frames) == 0:
                            # Không có frames nào, có thể là I/O error ngay từ đầu
                            logging.error(f"[Recorder] FFmpeg failed with I/O error, no frames extracted. Check permissions/antivirus for {temp_frames_dir}")
                            return
                        else:
                            # Có một số frames, có thể là I/O error ở giữa chừng
                            logging.warning(f"[Recorder] FFmpeg failed but extracted {len(frames)} frames (partial). Continuing with available frames...")
                    else:
                        # Thư mục bị xóa hoặc không tồn tại
                        logging.error(f"[Recorder] Temp directory disappeared: {temp_frames_dir}. Possible race condition or permission issue.")
                        return
                else:
                    logging.info(f"[Recorder] ✅ Frame extraction completed successfully")
                
                # Đếm số frames đã extract (sau khi FFmpeg hoàn toàn xong)
                if not os.path.exists(temp_frames_dir):
                    logging.error(f"[Recorder] Temp directory does not exist after extraction: {temp_frames_dir}")
                    return
                    
                frames = sorted([f for f in os.listdir(temp_frames_dir) if f.endswith('.jpg')])
                if len(frames) == 0:
                    logging.warning(f"[Recorder] No frames extracted from {video_basename} (video may be too short or corrupted)")
                    return  # Skip timelapse generation nếu không có frames
                
                logging.info(f"[Recorder] Extracted {len(frames)} frames from {video_basename}")
                
                # Sử dụng concat demuxer để tạo video an toàn nhất
                # Không phụ thuộc vào pattern frames (frame_%04d.jpg) hay start number
                
                concat_file = os.path.join(temp_frames_dir, "concat.txt").replace("\\", "/")
                with open(concat_file, 'w', encoding='utf-8') as f:
                    for frame_file in sorted(frames):  # Đảm bảo frames được sort theo thứ tự
                        frame_path = os.path.join(temp_frames_dir, frame_file)
                        # FFmpeg concat yêu cầu path:
                        # 1. Dấu \ được escape thành /
                        # 2. Dấu ' được escape
                        # 3. Path tuyệt đối an toàn nhất
                        frame_path_clean = frame_path.replace("\\", "/")
                        f.write(f"file '{frame_path_clean}'\n")
                        f.write(f"duration 0.033\n")  # 30fps = 1/30s per frame
                
                # Thêm duration cho frame cuối cùng (ffmpeg quirk)
                if frames:
                    last_frame_path = os.path.join(temp_frames_dir, sorted(frames)[-1])
                    last_frame_path_clean = last_frame_path.replace("\\", "/")
                    with open(concat_file, 'a', encoding='utf-8') as f:
                        f.write(f"file '{last_frame_path_clean}'\n")

                timelapse_cmd = [
                    "ffmpeg",
                    "-y",
                    "-f", "concat",
                    "-safe", "0",
                    "-i", concat_file,
                    "-c:v", "libx264",
                    "-pix_fmt", "yuv420p",
                    "-crf", "23",
                    "-framerate", "30",
                    timelapse_path
                ]
                
                result = subprocess.run(
                    timelapse_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=60,
                    text=True
                )
                
                if result.returncode == 0 and os.path.exists(timelapse_path):
                    # Verify timelapse file size > 0
                    if os.path.getsize(timelapse_path) > 0:
                        logging.info(f"[Recorder] ✅ Created timelapse: {timelapse_path} ({len(frames)} frames)")
                    else:
                        logging.warning(f"[Recorder] Timelapse created but file is empty: {timelapse_path}")
                        if os.path.exists(timelapse_path):
                            os.remove(timelapse_path)
                else:
                    error_msg = result.stderr if result.stderr else "Unknown error"
                    logging.warning(f"[Recorder] Failed to create timelapse video: {error_msg}")
                    logging.debug(f"[Recorder] Frames found: {frames[:5]}... (total: {len(frames)})")
                
            except Exception as e:
                logging.error(f"[Recorder] Exception during timelapse generation for {video_basename}: {e}", exc_info=True)
            finally:
                # QUAN TRỌNG: Chỉ cleanup temp frames SAU KHI tất cả operations xong
                # Đảm bảo FFmpeg đã hoàn toàn kết thúc và không còn ghi file
                if os.path.exists(temp_frames_dir):
                    try:
                        # Đợi một chút để đảm bảo tất cả file handles đã được đóng
                        time.sleep(0.1)
                        shutil.rmtree(temp_frames_dir, ignore_errors=True)
                        logging.debug(f"[Recorder] Cleaned up temp frames directory: {temp_frames_dir}")
                    except Exception as e:
                        logging.warning(f"[Recorder] Failed to cleanup temp frames directory {temp_frames_dir}: {e}. Will retry later.")
                        # Không raise exception, chỉ log warning để không ảnh hưởng đến main flow
            
            # Lưu metadata (duration, size) sau khi tạo thumbnail và timelapse xong
            # Đọc metadata bằng ffprobe và lưu vào metadata.json
            video_metadata = self._get_video_metadata(video_path)
            if video_metadata:
                # Thêm size_bytes từ file stat nếu chưa có
                if "size_bytes" not in video_metadata:
                    try:
                        stat = os.stat(video_path)
                        video_metadata["size_bytes"] = stat.st_size
                    except Exception:
                        pass
                
                # Parse start time từ tên file
                name_no_ext = os.path.splitext(video_basename)[0]
                try:
                    start_dt = datetime.strptime(name_no_ext, "%Y%m%d_%H%M%S")
                    video_metadata["start_time"] = start_dt.isoformat()
                except Exception:
                    pass
                
                self._save_metadata(video_path, video_metadata)
                logging.info(f"[Recorder] ✅ Saved metadata for {video_basename}")
            else:
                logging.warning(f"[Recorder] Failed to get metadata for {video_basename}")
                    
        except Exception as e:
            logging.error(f"[Recorder] Error generating thumbnail/timelapse for {video_path}: {e}", exc_info=True)
    
    def _get_video_metadata(self, file_path: str) -> Optional[Dict]:
        """
        Lấy metadata thực tế của video file bằng ffprobe (duration, size, etc).
        Method này thuộc CameraRecorder để có thể gọi từ _generate_thumbnail_and_timelapse.
        
        Returns:
            Dict chứa metadata hoặc None nếu không đọc được
        """
        if not shutil.which("ffprobe"):
            logging.warning("[Recorder] ffprobe not found, cannot get video metadata")
            return None
        
        try:
            # Dùng ffprobe để đọc metadata
            cmd = [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration,size",
                "-of", "json",
                file_path
            ]
            
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=3,
                text=True
            )
            
            if result.returncode != 0:
                logging.debug(f"[Recorder] ffprobe failed for {file_path}: {result.stderr}")
                return None
            
            data = json.loads(result.stdout)
            format_info = data.get("format", {})
            duration_str = format_info.get("duration")
            size_str = format_info.get("size")
            
            metadata = {}
            if duration_str:
                metadata["duration_sec"] = round(float(duration_str), 2)
            if size_str:
                metadata["size_bytes"] = int(size_str)
            
            return metadata if metadata else None
        except subprocess.TimeoutExpired:
            logging.warning(f"[Recorder] ffprobe timeout for {file_path}")
            return None
        except json.JSONDecodeError:
            logging.warning(f"[Recorder] Failed to parse ffprobe output for {file_path}")
            return None
        except Exception as e:
            logging.debug(f"[Recorder] Failed to get video metadata: {e}")
            return None
    
    def _save_metadata(self, video_path: str, metadata: Dict):
        """
        Lưu metadata vào file metadata.json trong cùng folder với video.
        Method này thuộc CameraRecorder để có thể gọi từ _generate_thumbnail_and_timelapse.
        
        Args:
            video_path: Đường dẫn đến file video
            metadata: Dict chứa metadata (duration_sec, size_bytes, start_time, etc.)
        """
        try:
            video_dir = os.path.dirname(video_path)
            metadata_path = os.path.join(video_dir, "metadata.json")
            
            # Thêm timestamp khi lưu metadata
            metadata_with_ts = {
                **metadata,
                "created_at": datetime.now().isoformat(),
                "video_file": os.path.basename(video_path)
            }
            
            with open(metadata_path, 'w', encoding='utf-8') as f:
                json.dump(metadata_with_ts, f, indent=2, ensure_ascii=False)
            
            logging.debug(f"[Recorder] Saved metadata to {metadata_path}")
        except Exception as e:
            logging.warning(f"[Recorder] Failed to save metadata: {e}")
    
    def start(self):
        """Start monitoring loop that maintains the ffmpeg process."""
        with self.lock:
            if self.running:
                logging.info(f"[Recorder] Camera {self.camera_id} recorder already active")
                return
            self.running = True
            
        def _scan_date_dir(date_dir, processed_files):
            """Helper to scan a specific date directory for processing needed"""
            if not os.path.exists(date_dir):
                return

            try:
                # Quét cả files trong date_dir (chưa di chuyển) và subfolders (đã di chuyển)
                for item in os.listdir(date_dir):
                    item_path = os.path.join(date_dir, item)
                    
                    # Case 1: Là folder (video đã được di chuyển vào folder riêng)
                    if os.path.isdir(item_path):
                        video_folder = item_path
                        # Tìm file video .mp4 trong folder này (không phải _timelapse.mp4)
                        for filename in os.listdir(video_folder):
                            if not filename.lower().endswith('.mp4') or filename.endswith('_timelapse.mp4'):
                                continue
                            
                            file_key = filename
                            if file_key in processed_files:
                                continue
                            
                            file_path = os.path.join(video_folder, filename)
                            name_without_ext = os.path.splitext(filename)[0]
                            thumbnail_path = os.path.join(video_folder, f"{name_without_ext}_thumb.jpg")
                            timelapse_path = os.path.join(video_folder, f"{name_without_ext}_timelapse.mp4")
                            
                            # Nếu đã có đầy đủ thì skip (add to processed set to skip fast next time)
                            if os.path.exists(thumbnail_path) and os.path.exists(timelapse_path):
                                processed_files.add(file_key)
                                continue
                            
                            # Generate thumbnail và timelapse
                            try:
                                file_mtime = os.path.getmtime(file_path)
                                file_age = time.time() - file_mtime
                                min_age = self.segment_seconds + 2
                                
                                if file_age >= min_age:
                                    def _generate():
                                        self._generate_thumbnail_and_timelapse(file_path)
                                    
                                    thread = threading.Thread(target=_generate, daemon=True)
                                    thread.start()
                                    processed_files.add(file_key)
                                    logging.info(f"[Recorder] Queued thumbnail/timelapse for {file_key}")
                            except Exception as e:
                                logging.debug(f"[Recorder] Error processing {file_path}: {e}")
                    
                    # Case 2: Là file MP4 (chưa di chuyển vào folder riêng)
                    elif os.path.isfile(item_path) and item.lower().endswith('.mp4') and not item.endswith('_timelapse.mp4'):
                        filename = item
                        file_key = filename
                        
                        if file_key in processed_files:
                            continue
                        
                        file_path = item_path
                        
                        # Check file age và di chuyển vào folder riêng
                        try:
                            file_mtime = os.path.getmtime(file_path)
                            file_age = time.time() - file_mtime
                            min_age = self.segment_seconds + 2
                            
                            if file_age >= min_age:
                                # Di chuyển file vào folder riêng
                                name_without_ext = os.path.splitext(filename)[0]
                                video_folder = os.path.join(date_dir, name_without_ext)
                                os.makedirs(video_folder, exist_ok=True)
                                
                                new_video_path = os.path.join(video_folder, filename)
                                thumbnail_path = os.path.join(video_folder, f"{name_without_ext}_thumb.jpg")
                                timelapse_path = os.path.join(video_folder, f"{name_without_ext}_timelapse.mp4")
                                
                                # Di chuyển file (nếu chưa di chuyển)
                                if not os.path.exists(new_video_path):
                                    try:
                                        shutil.move(file_path, new_video_path)
                                        logging.info(f"[Recorder] Moved video to folder: {name_without_ext}/")
                                    except Exception as e:
                                        logging.warning(f"[Recorder] Failed to move video: {e}")
                                        new_video_path = file_path
                                else:
                                    new_video_path = file_path
                                
                                # Check if file was actually moved successfully (exists at new path)
                                if os.path.exists(new_video_path):
                                     # Generate thumbnail và timelapse
                                    if not os.path.exists(thumbnail_path) or not os.path.exists(timelapse_path):
                                        def _generate():
                                            self._generate_thumbnail_and_timelapse(new_video_path)
                                        
                                        thread = threading.Thread(target=_generate, daemon=True)
                                        thread.start()
                                        processed_files.add(file_key)
                                        logging.info(f"[Recorder] Queued move and generate for {filename} (age: {file_age:.1f}s)")
                        except Exception as e:
                            logging.debug(f"[Recorder] Error processing {file_path}: {e}")
                            
            except Exception as e:
                logging.debug(f"[Recorder] Error scanning date dir {date_dir}: {e}")

        # --- Recovery Scan Job (Runs ONCE at startup) ---
        def _recovery_scan(processed_files_set):
            """
            Quét các video chưa hoàn thành (thiếu thumbnail/timelapse).
            CHỈ quét 5 VIDEO GẦN NHẤT cần recovery để tránh lag máy.
            
            3 trường hợp xử lý:
            1. Đang record thì tắt → FFmpeg segment tự handle, file vẫn valid (có thể ngắn hơn expected)
            2. Record xong nhưng chưa tạo folder → Di chuyển vào subfolder  
            3. Tạo folder rồi nhưng thiếu thumbnail/preview/metadata → Generate missing files
            """
            MAX_VIDEOS_TO_RECOVER = 5
            
            logging.info(f"[Recorder] Starting recovery scan for {self.camera_id} (max {MAX_VIDEOS_TO_RECOVER} videos)...")
            camera_dir = os.path.join(self.base_dir, self.camera_id)
            if not os.path.exists(camera_dir):
                return

            try:
                # Thu thập TẤT CẢ video cần recovery từ các date folders
                # Format: (mtime, file_path, is_in_subfolder, date_dir, filename)
                incomplete_videos = []
                
                # Lấy tất cả date folders
                all_date_folders = []
                for item in os.listdir(camera_dir):
                    item_path = os.path.join(camera_dir, item)
                    if os.path.isdir(item_path) and len(item) == 8 and item.isdigit():
                        all_date_folders.append(item)

                # Sort descending (ngày mới nhất trước) để ưu tiên quét ngày gần đây
                all_date_folders.sort(reverse=True)

                for date_str in all_date_folders:
                    if not self.running:
                        break
                    # Break sớm nếu đã có đủ videos cần recovery
                    if len(incomplete_videos) >= MAX_VIDEOS_TO_RECOVER * 2:
                        break

                    date_path = os.path.join(camera_dir, date_str)
                    
                    try:
                        for item in os.listdir(date_path):
                            item_path = os.path.join(date_path, item)
                            
                            # Case 1 & 3: Video trong subfolder (đã di chuyển)
                            if os.path.isdir(item_path):
                                video_folder = item_path
                                for filename in os.listdir(video_folder):
                                    if not filename.lower().endswith('.mp4') or filename.endswith('_timelapse.mp4'):
                                        continue
                                    
                                    file_path = os.path.join(video_folder, filename)
                                    name_without_ext = os.path.splitext(filename)[0]
                                    thumbnail_path = os.path.join(video_folder, f"{name_without_ext}_thumb.jpg")
                                    timelapse_path = os.path.join(video_folder, f"{name_without_ext}_timelapse.mp4")
                                    
                                    # Đã hoàn chỉnh → skip
                                    if os.path.exists(thumbnail_path) and os.path.exists(timelapse_path):
                                        continue
                                    
                                    # Cần recovery
                                    try:
                                        mtime = os.path.getmtime(file_path)
                                        incomplete_videos.append((mtime, file_path, True, date_path, filename))
                                    except Exception:
                                        pass
                            
                            # Case 2: Video nằm trực tiếp trong date folder (chưa di chuyển)
                            elif os.path.isfile(item_path) and item.lower().endswith('.mp4') and not item.endswith('_timelapse.mp4'):
                                try:
                                    mtime = os.path.getmtime(item_path)
                                    incomplete_videos.append((mtime, item_path, False, date_path, item))
                                except Exception:
                                    pass
                                    
                    except Exception as e:
                        logging.debug(f"[Recorder] Error scanning date dir {date_path}: {e}")

                # Sort theo mtime giảm dần (video mới nhất trước)
                incomplete_videos.sort(key=lambda x: x[0], reverse=True)
                
                # Chỉ xử lý MAX_VIDEOS_TO_RECOVER video đầu tiên
                videos_to_process = incomplete_videos[:MAX_VIDEOS_TO_RECOVER]
                
                logging.info(f"[Recorder] Found {len(incomplete_videos)} incomplete videos, processing {len(videos_to_process)} most recent")

                for mtime, file_path, is_in_subfolder, date_dir, filename in videos_to_process:
                    if not self.running:
                        break
                    
                    file_key = filename
                    if file_key in processed_files_set:
                        continue
                    
                    # Check file age
                    file_age = time.time() - mtime
                    min_age = self.segment_seconds + 2
                    
                    if file_age < min_age:
                        logging.debug(f"[Recorder] Skipping {filename}, file too new (age: {file_age:.1f}s < {min_age}s)")
                        continue
                    
                    if is_in_subfolder:
                        # Case 3: Đã trong subfolder, chỉ cần generate missing files
                        def _generate(fp=file_path):
                            self._generate_thumbnail_and_timelapse(fp)
                        
                        thread = threading.Thread(target=_generate, daemon=True)
                        thread.start()
                        processed_files_set.add(file_key)
                        logging.info(f"[Recorder] Recovery: generating missing files for {filename}")
                    else:
                        # Case 2: Cần di chuyển vào subfolder trước
                        name_without_ext = os.path.splitext(filename)[0]
                        video_folder = os.path.join(date_dir, name_without_ext)
                        
                        def _move_and_generate(fp=file_path, vf=video_folder, fn=filename):
                            try:
                                os.makedirs(vf, exist_ok=True)
                                new_path = os.path.join(vf, fn)
                                if not os.path.exists(new_path):
                                    shutil.move(fp, new_path)
                                    logging.info(f"[Recorder] Recovery: moved {fn} to subfolder")
                                else:
                                    new_path = fp
                                self._generate_thumbnail_and_timelapse(new_path)
                            except Exception as e:
                                logging.error(f"[Recorder] Recovery failed for {fn}: {e}")
                        
                        thread = threading.Thread(target=_move_and_generate, daemon=True)
                        thread.start()
                        processed_files_set.add(file_key)
                        logging.info(f"[Recorder] Recovery: moving and generating for {filename}")

            except Exception as e:
                logging.error(f"[Recorder] Recovery scan failed: {e}")

            logging.info(f"[Recorder] Recovery scan finished for {self.camera_id}")

        def _monitor_loop():
            logging.info(f"[Recorder] Start monitor loop for {self.camera_id}")
            import time
            
            # Track processed files to avoid re-processing
            processed_files = set()
            
            # 0. Launch Recovery Scan immediately (in separate temporary thread or just sequentially here? 
            # Sequential here is fine since valid playback/recording processes are independent)
            # Actually, let's run it in a separate thread so we jump to "monitor today" quickly
            threading.Thread(target=_recovery_scan, args=(processed_files,), daemon=True).start()
            
            while self.running:
                # 1. Maintenance: Ensure directories exist
                self._ensure_current_date_dir()
                
                # 2. Check process status
                is_alive = False
                if self.process and self.process.poll() is None:
                    is_alive = True
                
                if not is_alive:
                    if self.process:
                         logging.warning(f"[Recorder] Process for {self.camera_id} died, restarting...")
                    
                    # Try to launch with simple backoff
                    if self._launch_process():
                        logging.info(f"[Recorder] Launched successfully for {self.camera_id}")
                    else:
                        logging.warning(f"[Recorder] Launch failed for {self.camera_id}, retrying in 10s...")
                
                # 3. Check for new video files (TODAY only - fast loop)
                try:
                    now = datetime.now()
                    date_str = now.strftime("%Y%m%d")
                    date_dir = os.path.join(self.base_dir, self.camera_id, date_str)
                    
                    # Reuse the same scan logic
                    _scan_date_dir(date_dir, processed_files)
                
                except Exception as e:
                    logging.debug(f"[Recorder] Error checking for new files: {e}")
                
                # Sleep before next check
                time.sleep(10)
        
        threading.Thread(target=_monitor_loop, daemon=True).start()
    def stop(self):
        """Stop ffmpeg process nếu đang chạy."""
        with self.lock:
            self.running = False
            # maintenance loop checks self.running, so it will stop eventually (or daemon thread dies)
            if self.process and self.process.poll() is None:
                try:
                    logging.info(f"[Recorder] Stopping recorder for camera {self.camera_id}")
                    self.process.terminate()
                    self.process.wait(timeout=5)
                except Exception:
                    try:
                        self.process.kill()
                    except Exception:
                        pass
            self.process = None

    def is_running(self) -> bool:
        """Kiểm tra process ffmpeg có đang chạy không."""
        with self.lock:
            return self.process is not None and self.process.poll() is None


