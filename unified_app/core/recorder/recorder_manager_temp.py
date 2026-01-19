class RecorderManager:
    """Quản lý tất cả CameraRecorder (theo camera_id)."""

    def __init__(self):
        self.recorders: Dict[str, CameraRecorder] = {}
        self.lock = threading.Lock()
        # recordings base dir
        self.base_dir = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), "recordings"
        )
        os.makedirs(self.base_dir, exist_ok=True)
        
        # Đọc segment_seconds từ config.yaml
        try:
            cfg = load_config()
            recording_config = cfg.get("recording", {})
            self.segment_seconds = recording_config.get("segment_seconds", 30)  # Mặc định 30s
        except Exception as e:
            logging.warning(f"[Recorder] Failed to load recording config, using default 30s: {e}")
            self.segment_seconds = 30
        
        logging.info(f"[Recorder] Base recordings dir: {self.base_dir}")
        logging.info(f"[Recorder] Segment duration: {self.segment_seconds}s (from config.yaml)")

    def start_recorder(self, camera_id: str):
        """Start recorder 24/7 cho 1 camera (ghi từ go2rtc relay)."""
        with self.lock:
            recorder = self.recorders.get(camera_id)
            if not recorder:
                recorder = CameraRecorder(
                    camera_id=camera_id,
                    base_dir=self.base_dir,
                    segment_seconds=self.segment_seconds  # Dùng giá trị từ config
                )
                self.recorders[camera_id] = recorder
        logging.info(f"[Recorder] start_recorder for {camera_id} (segment={self.segment_seconds}s)")
        # Start ngoài lock để tránh block
        recorder.start()

    def stop_recorder(self, camera_id: str):
        """Stop recorder cho 1 camera và xoá khỏi map."""
        with self.lock:
            recorder = self.recorders.get(camera_id)
        if recorder:
            recorder.stop()
            with self.lock:
                self.recorders.pop(camera_id, None)

    def _load_metadata(self, video_path: str) -> Optional[Dict]:
        """
        Đọc metadata từ file metadata.json trong cùng folder với video.
        
        Args:
            video_path: Đường dẫn đến file video
            
        Returns:
            Dict chứa metadata hoặc None nếu không đọc được
        """
        try:
            video_dir = os.path.dirname(video_path)
            metadata_path = os.path.join(video_dir, "metadata.json")
            
            if not os.path.exists(metadata_path):
                return None
            
            with open(metadata_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
            
            # Xóa các field không cần thiết (created_at, video_file)
            metadata.pop("created_at", None)
            metadata.pop("video_file", None)
            
            return metadata
        except Exception as e:
            logging.debug(f"[Recorder] Failed to load metadata from {metadata_path}: {e}")
            return None
    
    def _get_video_duration(self, file_path: str) -> Optional[float]:
        """
        DEPRECATED: Dùng _load_metadata thay vì method này.
        Lấy duration từ metadata.json nếu có, nếu không thì fallback về ffprobe.
        """
        # Thử đọc từ metadata.json trước
        metadata = self._load_metadata(file_path)
        if metadata and "duration_sec" in metadata:
            return metadata["duration_sec"]
        
        # Fallback về ffprobe (cho backward compatibility) - chỉ dùng khi không có metadata.json
        # Note: Method này thuộc RecorderManager, không có _get_video_metadata ở đây
        # Nếu cần fallback, có thể gọi từ CameraRecorder instance, nhưng tốt nhất là bỏ fallback
        return None

    def list_recordings(self, camera_id: str) -> List[dict]:
        """
        Liệt kê recordings cho 1 camera theo layout thư mục.
        Chỉ đọc filesystem, chưa có DB index.
        """
        camera_dir = os.path.join(self.base_dir, camera_id)
        if not os.path.exists(camera_dir):
            return []

        recordings: List[dict] = []
        for root, dirs, files in os.walk(camera_dir):
            for filename in files:
                if not filename.lower().endswith(".mp4"):
                    continue
                
                # Skip timelapse files (chỉ lấy video gốc, không lấy _timelapse.mp4)
                if filename.endswith("_timelapse.mp4"):
                    continue
                
                file_path = os.path.join(root, filename)
                rel_path = os.path.relpath(file_path, self.base_dir)
                
                # Cấu trúc mới: recordings/{camera_id}/{YYYYMMDD}/{YYYYMMDD_HHMMSS}/{filename}.mp4
                # Chỉ lấy files trong subfolders {YYYYMMDD_HHMMSS}/ (đã di chuyển vào folder riêng)
                # Skip files trực tiếp trong date folder (chưa di chuyển - đang ghi)
                path_parts = rel_path.replace("\\", "/").split("/")
                # path_parts: ["camera_id", "YYYYMMDD", "YYYYMMDD_HHMMSS", "YYYYMMDD_HHMMSS.mp4"]
                # Phải có ít nhất 4 parts (camera_id, date, folder, file)
                if len(path_parts) < 4:
                    continue  # Skip files ở level date folder (chưa di chuyển)
                
                # Kiểm tra folder name phải giống với filename (không có extension)
                folder_name = path_parts[-2]  # Folder name: YYYYMMDD_HHMMSS
                file_name_no_ext = os.path.splitext(filename)[0]  # File name: YYYYMMDD_HHMMSS
                if folder_name != file_name_no_ext:
                    continue  # Skip nếu folder name không khớp với file name
                
                # Đọc metadata từ metadata.json (nhanh hơn nhiều so với ffprobe)
                metadata = self._load_metadata(file_path)
                
                # Parse thời gian từ tên file: YYYYMMDD_HHMMSS.mp4
                name_no_ext = os.path.splitext(filename)[0]
                start_ts = None
                try:
                    # name_no_ext dạng 20250109_120000
                    start_dt = datetime.strptime(name_no_ext, "%Y%m%d_%H%M%S")
                    start_ts = start_dt.isoformat()
                except Exception:
                    # Nếu parse từ filename thất bại, thử đọc từ metadata
                    if metadata and "start_time" in metadata:
                        start_ts = metadata["start_time"]
                
                # Lấy size và duration từ metadata, fallback về file stat nếu không có
                size = 0
                if metadata and "size_bytes" in metadata:
                    size = metadata["size_bytes"]
                else:
                    try:
                        stat = os.stat(file_path)
                        size = stat.st_size
                    except Exception:
                        pass
                
                duration_sec = None
                if metadata and "duration_sec" in metadata:
                    duration_sec = metadata["duration_sec"]
                else:
                    # Fallback: dùng segment_seconds nếu không có metadata
                    duration_sec = self.segment_seconds

                recordings.append(
                    {
                        "camera_id": camera_id,
                        "path": rel_path.replace("\\", "/"),
                        "filename": filename,
                        "size_bytes": size,
                        "start": start_ts,
                        "duration_sec": duration_sec,
                        "_file_path": file_path,  # Lưu path để filter files chưa hoàn thiện
                    }
                )

        # Sort theo start time nếu có, ngược lại theo tên file
        recordings.sort(key=lambda r: (r.get("start") or "", r["filename"]))

        # Filter files chưa hoàn thiện (chưa có thumbnail/timelapse hoặc đang được ghi)
        # File cuối cùng (mới nhất) có thể:
        # 1. Đang được ghi (FFmpeg vẫn ghi vào file)
        # 2. Vừa mới tạo xong (< segment_seconds + 2) → chưa đủ age để generate thumbnail/timelapse
        # 3. Đã được di chuyển vào folder nhưng chưa generate thumbnail/timelapse
        
        filtered_recordings = []
        with self.lock:
            recorder = self.recorders.get(camera_id)
            is_recording = recorder and recorder.is_running() if recorder else False
        
        for rec in recordings:
            file_path = rec.get("_file_path")
            if not file_path or not os.path.exists(file_path):
                continue
            
            # Kiểm tra file age
            try:
                file_mtime = os.path.getmtime(file_path)
                file_age = time.time() - file_mtime
                min_age = self.segment_seconds + 2  # Phải đợi ít nhất segment_seconds + 2s
                
                # Nếu file quá mới (< min_age), có thể đang được ghi hoặc vừa mới tạo xong
                if file_age < min_age:
                    # Nếu recorder đang chạy, file này có thể đang được ghi → skip
                    if is_recording:
                        logging.debug(f"[Recorder] Excluding new file (age: {file_age:.1f}s < {min_age}s): {rec['filename']}")
                        continue
                
                # Kiểm tra xem đã có thumbnail và timelapse chưa
                video_dir = os.path.dirname(file_path)
                video_basename = os.path.basename(file_path)
                name_without_ext = os.path.splitext(video_basename)[0]
                thumbnail_path = os.path.join(video_dir, f"{name_without_ext}_thumb.jpg")
                timelapse_path = os.path.join(video_dir, f"{name_without_ext}_timelapse.mp4")
                
                # Nếu chưa có thumbnail hoặc timelapse, và file age < min_age → có thể đang được process
                if (not os.path.exists(thumbnail_path) or not os.path.exists(timelapse_path)):
                    if file_age < min_age:
                        # File quá mới và chưa có thumbnail/timelapse → có thể đang được ghi → skip
                        logging.debug(f"[Recorder] Excluding incomplete file (age: {file_age:.1f}s, missing thumb/timelapse): {rec['filename']}")
                        continue
                    # Nếu file đã đủ age nhưng chưa có thumbnail/timelapse → có thể đang được generate → vẫn hiển thị
                    # (Monitor loop sẽ generate sau)
                
                filtered_recordings.append(rec)
            except Exception as e:
                logging.debug(f"[Recorder] Error checking file {file_path}: {e}")
                # Nếu có lỗi, vẫn thêm vào list để an toàn
                filtered_recordings.append(rec)
        
        return filtered_recordings

    def get_status(self, camera_id: str) -> Dict[str, object]:
        """Trả về trạng thái recorder cho 1 camera (để debug / kiểm tra)."""
        with self.lock:
            recorder = self.recorders.get(camera_id)
        if not recorder:
            return {
                "camera_id": camera_id,
                "is_recording": False,
                "reason": "no_recorder",
                "base_dir": self.base_dir,
            }

        # Kiểm tra nhanh xem đã có file nào trong thư mục chưa
        camera_dir = os.path.join(self.base_dir, camera_id)
        has_files = False
        if os.path.exists(camera_dir):
            for _, _, files in os.walk(camera_dir):
                if any(f.lower().endswith(".mp4") for f in files):
                    has_files = True
                    break

        return {
            "camera_id": camera_id,
            "is_recording": recorder.is_running(),
            "last_error": recorder.last_error,
            "base_dir": self.base_dir,
            "has_files": has_files,
        }


_recorder_manager: Optional[RecorderManager] = None


def get_recorder_manager() -> RecorderManager:
    global _recorder_manager
    if _recorder_manager is None:
        _recorder_manager = RecorderManager()
    return _recorder_manager
