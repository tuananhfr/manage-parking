"""
Camera Worker module - handles RTSP reading, detection, and OCR
Enhanced with ByteTrack and best frame selection
"""
import os
import time
import logging
import threading
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Tuple
from queue import Queue, Full
import re

import cv2
import numpy as np

# ByteTrack for robust vehicle tracking
try:
    import supervision as sv
    from supervision import Detections
    BYTETRACK_AVAILABLE = True
except ImportError:
    BYTETRACK_AVAILABLE = False
    logging.warning("[CAMERA_WORKER] supervision not available, using fallback tracking")

from .detector import get_detector, get_ocr_service, crop_plate_image, get_vehicle_detector
from .config import load_config
from .db import insert_ocr_log, init_db
from .events import get_event_emitter
from .ocr_sender import send_ocr_to_central


def normalize_plate_text(text: str) -> str:
    """Normalize license plate text (remove spaces, dots, uppercase)"""
    if not text:
        return ""
    return (
        text.strip()
        .upper()
        .replace(" ", "")
        .replace(".", "")
    )


def is_valid_vietnamese_plate(text: str) -> bool:
    """Check if text matches Vietnamese license plate format"""
    if not text or len(text) < 7:
        return False

    clean = normalize_plate_text(text)
    if not clean:
        return False

    # Yêu cầu bắt đầu bằng đúng 2 chữ số (biển VN chuẩn)
    if not clean[:2].isdigit():
        return False

    patterns = [
        # Ô tô: 2 số + 1-2 chữ + 4-6 số, có thể có dấu -
        r"^\d{2}[A-Z]{1,2}\d{4,6}$",
        r"^\d{2}[A-Z]{1,2}-\d{4,6}$",
        # Xe máy: 2 số + 1 chữ + 1 số + 4-5 số (dấu - tùy chọn)
        r"^\d{2}[A-Z]\d-?\d{4,5}$",
    ]

    for pattern in patterns:
        if re.match(pattern, clean):
            return True

    return False


def calculate_blur_score(image: np.ndarray) -> float:
    """Calculate image blur score using Laplacian variance (higher = sharper)"""
    if image is None or image.size == 0:
        return 0.0

    try:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        variance = laplacian.var()
        return float(variance)
    except Exception as e:
        logging.debug(f"Blur score calculation error: {e}")
        return 0.0


def calculate_quality_score(plate_roi: Optional[np.ndarray], plate_conf: float, plate_bbox: List[int]) -> float:
    """Calculate quality score: blur (50%) + confidence (30%) + area (20%)"""
    # Blur score (0.0 - 1.0)
    blur_score = calculate_blur_score(plate_roi) if plate_roi is not None else 0.0
    blur_score_norm = min(blur_score / 500.0, 1.0)

    # Area score (0.0 - 1.0)
    if len(plate_bbox) >= 4:
        x1, y1, x2, y2 = plate_bbox[:4]
        area = (x2 - x1) * (y2 - y1)
        area_score = min(area / 10000.0, 1.0)
    else:
        area_score = 0.0

    # Confidence score (0.0 - 1.0)
    conf_score = float(plate_conf)

    # Weighted average
    quality = blur_score_norm * 0.5 + conf_score * 0.3 + area_score * 0.2

    return quality


@dataclass
class PlateCandidate:
    """Plate candidate từ 1 frame"""
    frame: np.ndarray
    plate_roi: Optional[np.ndarray]  # Đã crop sẵn plate ROI (giống VideoWorker)
    plate_bbox: List[int]  # Giữ lại để backward compatibility
    plate_conf: float
    quality: float
    timestamp: float


class VehicleTrack:
    """Track 1 vehicle với plate candidates"""
    def __init__(self, track_id: int):
        self.track_id = track_id
        self.candidates: List[PlateCandidate] = []
        self.last_seen = time.time()
        self.ocr_processed = False

    def add_candidate(self, candidate: PlateCandidate):
        """Thêm plate candidate vào track"""
        self.candidates.append(candidate)
        self.last_seen = time.time()

    def is_ready_for_ocr(self, min_frames: int = 5, ocr_interval: int = 10) -> bool:
        """
        Check xem track đã sẵn sàng cho OCR chưa

        Logic: Thu thập liên tục, OCR định kỳ cho đến khi thành công
        - Lần đầu: Cần ít nhất min_frames (5 frames)
        - Các lần sau: Cứ mỗi ocr_interval frames (10 frames) thì thử OCR lại
        - Dừng khi OCR thành công (ocr_processed = True)
        """
        if self.ocr_processed:
            return False  # Đã OCR thành công rồi

        num_candidates = len(self.candidates)

        # Lần đầu tiên: Cần ít nhất min_frames
        if num_candidates >= min_frames and num_candidates < min_frames + ocr_interval:
            return True

        # Các lần sau: Cứ mỗi ocr_interval frames thì thử lại
        # VD: 5, 15, 25, 35, ... (với min_frames=5, ocr_interval=10)
        return (num_candidates - min_frames) % ocr_interval == 0

    def get_best_candidates(self, top_n: int = 3) -> List[PlateCandidate]:
        """Lấy top N candidates có quality cao nhất"""
        return sorted(self.candidates, key=lambda c: c.quality, reverse=True)[:top_n]


@dataclass
class CameraWorker:
    """
    Real-time RTSP worker with FPS control.

    3-thread architecture:
    - Reader: Continuously reads stream (fresh frames, no queue)
    - Detection: AI processing at configurable detection_fps + ByteTrack tracking
    - OCR: OCR voting on best frames from tracks

    Stream-only mode (enable_detection=False): Only runs reader for video display
    """

    camera_id: str
    url: str
    detection_fps: float = 10.0  # Detection FPS (will be loaded from config.yaml, like video_worker)
    enable_detection: bool = True  # Enable AI detection (True) or stream-only mode (False)

    running: bool = field(default=False, init=False)
    reader_thread: Optional[threading.Thread] = field(default=None, init=False)
    detector_thread: Optional[threading.Thread] = field(default=None, init=False)

    frame_counter: int = field(default=0, init=False)  # Counter for frame skipping
    raw_frame: Optional[np.ndarray] = field(default=None, init=False)
    raw_frame_counter: int = field(default=0, init=False)  # Frame counter để tránh process trùng
    raw_frame_lock: threading.Lock = field(default_factory=threading.Lock, init=False)

    # Detection results (from background thread)
    detection_results: Dict = field(default_factory=dict, init=False)
    detection_lock: threading.Lock = field(default_factory=threading.Lock, init=False)

    # Legacy fields (kept for backward compatibility)
    latest_frame: Optional[np.ndarray] = field(default=None, init=False)
    latest_detections: List[dict] = field(default_factory=list, init=False)
    latest_cropped_image: Optional[np.ndarray] = field(default=None, init=False)  # Ảnh crop từ detection mới nhất
    last_update_ts: float = field(default=0.0, init=False)

    # ByteTrack tracker
    byte_tracker: Optional[object] = field(default=None, init=False)  # sv.ByteTrack instance
    vehicle_detector: Optional[object] = field(default=None, init=False)  # VehicleDetector instance

    # Vehicle tracks với plate candidates
    vehicle_tracks: Dict[int, VehicleTrack] = field(default_factory=dict, init=False)
    tracks_lock: threading.Lock = field(default_factory=threading.Lock, init=False)

    # OCR queue và result
    ocr_queue: Queue = field(default_factory=Queue, init=False)  # Unlimited queue (giống video_worker)
    ocr_thread: Optional[threading.Thread] = field(default=None, init=False)
    latest_ocr_text: str = field(default="", init=False)  # OCR result mới nhất
    latest_ocr_timestamp: float = field(default=0.0, init=False)  # Timestamp của OCR result
    seen_plates: set = field(default_factory=set, init=False)  # Deduplication (giống VideoWorker)

    # Tránh lưu trùng quá nhiều lần cùng 1 biển số (kept for backward compatibility)
    last_saved_plate: str = field(default="", init=False)
    last_saved_ts: float = field(default=0.0, init=False)

    stats: Dict = field(
        default_factory=lambda: {
            "fps": 0.0,
            "errors": 0,
            "last_err": "",
            "total_votes": 0,
            "finalized_plates": 0,
            "active_tracks": 0,
            "queue_full_count": 0,
            "reader_errors": 0,
            "detection_errors": 0,
            "ocr_errors": 0,
        },
        init=False,
    )

    def start(self):
        if self.running:
            return

        # Load FPS config from YAML (giống video_worker)
        try:
            from .config import load_config
            cfg = load_config()
            fps_config = cfg.get("fps", {})
            self.detection_fps = float(fps_config.get("detection_fps", 10.0))
            logging.info(f"[{self.camera_id}] FPS config loaded: detection_fps={self.detection_fps}")
        except Exception as e:
            logging.warning(f"[{self.camera_id}] Failed to load FPS config, using default: {e}")
            self.detection_fps = 10.0

        if self.enable_detection:
            logging.info(f"[{self.camera_id}] start detection requested (detection_fps={self.detection_fps})")
        else:
            logging.info(f"[{self.camera_id}] start stream-only mode (detection disabled)")

        # Đảm bảo DB đã được khởi tạo (chỉ khi detection enabled)
        if self.enable_detection:
            try:
                init_db()
            except Exception as e:
                logging.error(f"[{self.camera_id}] Failed to init DB: {e}")

        # Khởi tạo ByteTrack (if available) - CHỈ khi detection enabled
        if self.enable_detection and BYTETRACK_AVAILABLE:
            self.byte_tracker = sv.ByteTrack(
                track_activation_threshold=0.5,
                lost_track_buffer=30,
                minimum_matching_threshold=0.8,
                frame_rate=int(self.detection_fps)  # Use detection FPS
            )
            logging.info(f"[{self.camera_id}] ByteTrack initialized with {self.detection_fps} FPS")
        else:
            self.byte_tracker = None
            if self.enable_detection and not BYTETRACK_AVAILABLE:
                logging.warning(f"[{self.camera_id}] ByteTrack not available, using fallback tracking")

        # NOTE: Vehicle detector sẽ được load BÊN TRONG _detect_loop()
        # để tránh block quá trình khởi tạo
        self.vehicle_detector = None

        # Khởi tạo vehicle tracks dictionary
        self.vehicle_tracks = {}
        if self.enable_detection:
            logging.info(f"[{self.camera_id}] ByteTrack + Best Frame Selection enabled")

        self.running = True
        # Reader: LUÔN start để stream video (bất kể detection có enabled hay không)
        self.reader_thread = threading.Thread(target=self._read_loop, daemon=True)
        self.reader_thread.start()

        # Detector và OCR: CHỈ start khi enable_detection=True
        if self.enable_detection:
            # Detector: định kỳ lấy raw_frame hiện tại để detect
            self.detector_thread = threading.Thread(target=self._detect_loop, daemon=True)
            self.detector_thread.start()
            # OCR: xử lý best frames từ tracks với voting
            self.ocr_thread = threading.Thread(target=self._ocr_loop, daemon=True)
            self.ocr_thread.start()
            logging.info(f"[{self.camera_id}] Started: reader + detector + OCR threads")
        else:
            logging.info(f"[{self.camera_id}] Started: reader thread only (stream-only mode)")

    def stop(self):
        self.running = False
        # Clear OCR queue
        while not self.ocr_queue.empty():
            try:
                self.ocr_queue.get_nowait()
            except:
                pass
        for th in (self.reader_thread, self.detector_thread, self.ocr_thread):
            if th and th.is_alive():
                th.join(timeout=1.0)
        logging.info(f"[{self.camera_id}] stopped")

    # ---- Reader: always keep freshest frame ----
    def _read_loop(self):
        print(f"[{self.camera_id}] ========== READER THREAD STARTED ==========", flush=True)
        logging.info(f"[{self.camera_id}] Reader thread started, attempting to open RTSP: {self.url}")
        cap = None
        consecutive_errors = 0
        max_consecutive_errors = 10

        try:
            while self.running:
                if cap is None or not cap.isOpened():
                    cap = self._open_capture()
                    if cap is None:
                        logging.error(f"[{self.camera_id}] cannot open RTSP, retry in 1s")
                        time.sleep(1.0)
                        continue
                    consecutive_errors = 0  # Reset khi mở lại thành công

                try:
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        consecutive_errors += 1
                        self.stats["errors"] += 1
                        self.stats["last_err"] = "read_failed"
                        
                        # Nếu lỗi liên tục quá nhiều, đóng và mở lại
                        if consecutive_errors >= max_consecutive_errors:
                            logging.warning(f"[{self.camera_id}] Too many consecutive errors, reconnecting...")
                            if cap:
                                cap.release()
                            cap = None
                            time.sleep(1.0)
                            continue
                        
                        time.sleep(0.05)
                        continue
                    
                    # Validate frame: kiểm tra shape và data
                    if frame.size == 0 or len(frame.shape) != 3 or frame.shape[2] != 3:
                        consecutive_errors += 1
                        self.stats["errors"] += 1
                        self.stats["last_err"] = "invalid_frame"
                        if consecutive_errors >= max_consecutive_errors:
                            logging.warning(f"[{self.camera_id}] Invalid frames detected, reconnecting...")
                            if cap:
                                cap.release()
                            cap = None
                            time.sleep(1.0)
                            continue
                        continue
                    
                    # Frame hợp lệ, reset error counter
                    consecutive_errors = 0

                    # Ghi đè frame mới nhất, bỏ frame cũ => giảm delay
                    with self.raw_frame_lock:
                        self.raw_frame = frame
                        self.raw_frame_counter += 1  # Increment counter
                    
                except Exception as e:
                    # Bỏ qua lỗi decode (như H.264 decode error)
                    consecutive_errors += 1
                    self.stats["reader_errors"] = self.stats.get("reader_errors", 0) + 1
                    self.stats["errors"] += 1
                    self.stats["last_err"] = f"decode_error: {str(e)[:50]}"
                    if consecutive_errors < 5:  # Chỉ log 5 lỗi đầu để tránh spam
                        logging.debug(f"[{self.camera_id}] Frame decode error (ignored): {e}")

                    if consecutive_errors >= max_consecutive_errors:
                        logging.error(f"[{self.camera_id}] Too many decode errors ({consecutive_errors}), reconnecting...", exc_info=True)
                        if cap:
                            cap.release()
                        cap = None
                        time.sleep(1.0)
                        continue

                    time.sleep(0.05)
                    continue
                    
        finally:
            if cap:
                cap.release()

    # ---- Detector: process every frame with ByteTrack ----
    def _detect_loop(self):
        """
        Detection loop với ByteTrack tracking:
        - Detect vehicles với ByteTrack để track từng xe
        - Detect plates trong mỗi vehicle ROI
        - Thu thập PlateCandidate cho từng track
        - Trigger OCR khi track đủ frames (min_frames=5)
        """
        from collections import Counter

        # Load detectors BÊN TRONG thread để không block startup
        print(f"[{self.camera_id}] Detection thread starting, loading models...", flush=True)
        logging.info(f"[{self.camera_id}] Detection thread starting, loading models...")

        try:
            detector = get_detector()
            logging.info(f"[{self.camera_id}] Plate detector loaded")

            if self.vehicle_detector is None:
                self.vehicle_detector = get_vehicle_detector()
                logging.info(f"[{self.camera_id}] Vehicle detector loaded")
        except Exception as e:
            logging.error(f"[{self.camera_id}] Failed to load detectors: {e}")
            return

        last_processed_frame = -1  # Track last processed frame
        target_interval = 1.0 / self.detection_fps  # FPS control interval (giống video_worker)

        # Tracking config
        min_frames = 5  # Cần ít nhất 5 frames trước khi OCR
        top_n = 3  # OCR trên 3 best frames
        max_track_age = 3.0  # Xóa track sau 3s không thấy

        # Log initial state
        print(f"[{self.camera_id}] Detection loop started, detection_fps={self.detection_fps}", flush=True)
        logging.info(f"[{self.camera_id}] Detection loop started, detection_fps={self.detection_fps}")

        while self.running:
            loop_start = time.time()  # Track loop time for FPS control

            # Get frame with lock
            with self.raw_frame_lock:
                if self.raw_frame is None:
                    time.sleep(0.01)
                    continue

                # Skip nếu đã process frame này rồi
                if self.raw_frame_counter == last_processed_frame:
                    time.sleep(0.01)
                    continue

                frame = self.raw_frame.copy()
                last_processed_frame = self.raw_frame_counter

                # Log first frame received
                if last_processed_frame == 1:
                    logging.info(f"[{self.camera_id}] First frame received! Shape: {frame.shape}")

            # Detection với error handling
            now = time.time()
            try:
                # Initialize empty detection results
                vehicle_list = []
                plate_bboxes = []

                # BYTETRACK: Detect vehicles + track with IDs
                if self.vehicle_detector and self.byte_tracker and BYTETRACK_AVAILABLE:
                    # Detect vehicles (same as VideoSourceWorker)
                    vehicle_results = self.vehicle_detector.detect_vehicles(frame, conf_threshold=0.5)

                    # Convert to supervision Detections
                    if len(vehicle_results) > 0:
                        xyxy = np.array([[veh_x1, veh_y1, veh_x2, veh_y2]
                                        for veh_x1, veh_y1, veh_x2, veh_y2, veh_conf, veh_cls in vehicle_results])
                        confidence = np.array([veh_conf for _, _, _, _, veh_conf, _ in vehicle_results])
                        class_id = np.array([int(veh_cls) for _, _, _, _, _, veh_cls in vehicle_results])

                        detections = Detections(
                            xyxy=xyxy,
                            confidence=confidence,
                            class_id=class_id
                        )

                        # ByteTrack tracking
                        detections = self.byte_tracker.update_with_detections(detections)
                    else:
                        detections = Detections.empty()

                    # Build vehicle list for display (x1, y1, x2, y2, track_id)
                    vehicle_list = [
                        (int(detections.xyxy[i][0]), int(detections.xyxy[i][1]),
                         int(detections.xyxy[i][2]), int(detections.xyxy[i][3]),
                         int(detections.tracker_id[i]))
                        for i in range(len(detections))
                        if detections.tracker_id is not None
                    ]

                    # Process each tracked vehicle
                    for i in range(len(detections)):
                        if detections.tracker_id is None:
                            continue

                        track_id = int(detections.tracker_id[i])
                        veh_bbox = detections.xyxy[i]
                        veh_x1, veh_y1, veh_x2, veh_y2 = map(int, veh_bbox)

                        # Detect plate within vehicle ROI (same as VideoSourceWorker)
                        veh_roi = frame[veh_y1:veh_y2, veh_x1:veh_x2]
                        if veh_roi.size > 0:
                            plate_results = detector.detect_from_frame(veh_roi, conf_threshold=0.4)

                            for plate_det in plate_results:
                                # Plate bbox trong ROI
                                plate_bbox_local = plate_det["bbox"]
                                plate_x1_local, plate_y1_local, plate_x2_local, plate_y2_local = plate_bbox_local
                                p_conf = plate_det["confidence"]

                                # Convert to frame coordinates
                                plate_x1 = int(veh_x1 + plate_x1_local)
                                plate_y1 = int(veh_y1 + plate_y1_local)
                                plate_x2 = int(veh_x1 + plate_x2_local)
                                plate_y2 = int(veh_y1 + plate_y2_local)

                                plate_bbox = [plate_x1, plate_y1, plate_x2, plate_y2]

                                # Crop plate image (giống VideoWorker - crop sẵn để dùng trong OCR)
                                plate_roi = frame[plate_y1:plate_y2, plate_x1:plate_x2]

                                # Calculate quality score
                                quality = calculate_quality_score(plate_roi, p_conf, plate_bbox)

                                # Create PlateCandidate (giống VideoWorker - có plate_roi đã crop sẵn)
                                candidate = PlateCandidate(
                                    frame=frame.copy(),
                                    plate_roi=plate_roi.copy(),  # ✅ Đã crop sẵn
                                    plate_bbox=plate_bbox,
                                    plate_conf=p_conf,
                                    quality=quality,
                                    timestamp=time.time()
                                )

                                # Add to track
                                with self.tracks_lock:
                                    if track_id not in self.vehicle_tracks:
                                        self.vehicle_tracks[track_id] = VehicleTrack(track_id)

                                    track = self.vehicle_tracks[track_id]
                                    track.add_candidate(candidate)

                                    # Check if ready for OCR
                                    if track.is_ready_for_ocr(min_frames=min_frames):
                                        # Get best candidates
                                        best_candidates = track.get_best_candidates(top_n=top_n)

                                        # Queue for OCR (track_id + best frames)
                                        try:
                                            self.ocr_queue.put_nowait({
                                                "track_id": track_id,
                                                "candidates": best_candidates,
                                                "timestamp": time.time()
                                            })

                                            # NOTE: KHÔNG đánh dấu processed ở đây nữa
                                            # Chỉ đánh dấu KHI OCR THÀNH CÔNG (trong _ocr_loop)
                                            # Nếu OCR thất bại, track sẽ tiếp tục thu thập frames

                                            logging.debug(
                                                f"[{self.camera_id}] Track {track_id} queued for OCR "
                                                f"({len(track.candidates)} frames collected)"
                                            )
                                        except Full:
                                            # Queue full, will retry next frame
                                            logging.warning(f"[{self.camera_id}] OCR queue full, dropping track {track_id}")
                                            self.stats["queue_full_count"] = self.stats.get("queue_full_count", 0) + 1

                                # Add to plate_bboxes for display
                                plate_bboxes.append({
                                    "bbox": plate_bbox,
                                    "track_id": track_id,
                                    "confidence": p_conf
                                })

                    # Clean up old tracks
                    with self.tracks_lock:
                        tracks_to_remove = []
                        for tid, track in self.vehicle_tracks.items():
                            if (now - track.last_seen) > max_track_age:
                                tracks_to_remove.append(tid)

                        for tid in tracks_to_remove:
                            del self.vehicle_tracks[tid]

                        self.stats["active_tracks"] = len(self.vehicle_tracks)

                # IMPORTANT: ALWAYS update detection results (even if empty) để xóa boxes cũ
                with self.detection_lock:
                    self.detection_results = {
                        "vehicles": vehicle_list,
                        "plates": plate_bboxes,
                        "timestamp": time.time()
                    }

                # Update legacy fields for backward compatibility
                self.last_update_ts = time.time()
                dt = max(self.last_update_ts - now, 1e-3)
                self.stats["fps"] = 1.0 / dt

            except Exception as e:
                # Log detection errors với full traceback
                logging.error(f"[{self.camera_id}] Detection error: {e}", exc_info=True)
                self.stats["detection_errors"] = self.stats.get("detection_errors", 0) + 1
                self.stats["errors"] += 1
                self.stats["last_err"] = f"detect_error: {str(e)[:50]}"
                time.sleep(0.1)  # Longer sleep on error
                continue

            # ✅ FPS CONTROL: Sleep để maintain detection_fps (giống video_worker)
            elapsed_loop = time.time() - loop_start
            sleep_time = target_interval - elapsed_loop
            if sleep_time > 0:
                time.sleep(sleep_time)
    
    # ---- OCR: xử lý best frames từ tracks với voting ----
    def _ocr_loop(self):
        """
        OCR loop với Best Frame Selection + Voting:
        - Lấy track_id + best candidates từ queue
        - OCR trên top N best quality frames
        - Voting để chọn result phổ biến nhất
        - Deduplication với seen_plates set
        """
        from collections import Counter

        ocr_service = get_ocr_service()

        # ✅ OCR SERVICE GUARD - Tránh crash khi service chưa ready (giống video_worker)
        if not ocr_service or not ocr_service.is_ready():
            logging.warning(f"[{self.camera_id}] OCR service not available, OCR loop will not start")
            return

        # seen_plates đã được khởi tạo trong field definition

        while self.running:
            try:
                # Lấy task từ queue (blocking với timeout)
                try:
                    task = self.ocr_queue.get(timeout=0.1)
                except:
                    continue  # Queue rỗng, tiếp tục chờ

                track_id = task.get("track_id")
                candidates = task.get("candidates", [])
                task_timestamp = task.get("timestamp", time.time())

                if not candidates:
                    self.ocr_queue.task_done()
                    continue

                logging.debug(
                    f"[{self.camera_id}] Processing OCR for track {track_id} "
                    f"with {len(candidates)} candidates"
                )

                try:
                    # OCR on each candidate
                    ocr_results = []

                    for candidate in candidates:
                        # Dùng plate_roi đã crop sẵn (giống VideoWorker)
                        if candidate.plate_roi is None:
                            continue
                        
                        # Run OCR trực tiếp trên plate_roi đã crop sẵn
                        raw_text = ocr_service.recognize(candidate.plate_roi)
                        
                        if not raw_text:
                            continue
                        
                        normalized = normalize_plate_text(raw_text)

                        # Validate Vietnamese plate format
                        if normalized and is_valid_vietnamese_plate(normalized):
                            ocr_results.append(normalized)
                            logging.debug(
                                f"[{self.camera_id}] Track {track_id} OCR: {normalized} "
                                f"(quality={candidate.quality:.3f})"
                            )

                    # Voting: chọn kết quả phổ biến nhất
                    if ocr_results:
                        vote_counter = Counter(ocr_results)
                        most_common = vote_counter.most_common(1)[0]
                        final_text = most_common[0]
                        vote_count = most_common[1]

                        logging.info(
                            f"[{self.camera_id}] Track {track_id} voted: {final_text} "
                            f"({vote_count}/{len(ocr_results)} votes)"
                        )

                        # ✅ OCR THÀNH CÔNG → Đánh dấu processed = True (không thử nữa)
                        with self.tracks_lock:
                            if track_id in self.vehicle_tracks:
                                self.vehicle_tracks[track_id].ocr_processed = True

                        # Update latest OCR text (cho UI display)
                        self.latest_ocr_text = final_text
                        self.latest_ocr_timestamp = task_timestamp

                        # Deduplication: Chỉ lưu nếu chưa thấy plate này (giống VideoWorker)
                        if final_text not in self.seen_plates:
                            self.seen_plates.add(final_text)

                            # Lưu vào DB
                            from datetime import datetime
                            now_ts = time.time()
                            ts_str = datetime.fromtimestamp(now_ts).isoformat()

                            try:
                                # Lấy camera_type từ config để lưu vào DB
                                cfg = load_config()
                                meta = cfg.get("metadata", {}).get(self.camera_id, {})
                                camera_type = meta.get("camera_type") or "internal"
                                insert_ocr_log(self.camera_id, final_text, ts_str, camera_type)
                                self.last_saved_plate = final_text
                                self.last_saved_ts = now_ts

                                logging.info(
                                    f"[{self.camera_id}] 💾 Saved to DB: {final_text} "
                                    f"(track {track_id}, {vote_count}/{len(ocr_results)} votes)"
                                )

                                # Update stats
                                self.stats["finalized_plates"] += 1
                                self.stats["total_votes"] += len(ocr_results)

                                # Emit real-time event when DB save succeeds
                                try:
                                    event_emitter = get_event_emitter()
                                    if hasattr(event_emitter, 'ocr_log_added'):
                                        if hasattr(event_emitter.ocr_log_added, 'notify'):
                                            event_emitter.ocr_log_added.notify(
                                                camera_id=self.camera_id,
                                                plate_text=final_text,
                                                timestamp=ts_str
                                            )
                                        elif hasattr(event_emitter.ocr_log_added, 'emit'):
                                            event_emitter.ocr_log_added.emit(
                                                self.camera_id, final_text, ts_str
                                            )
                                except Exception as e:
                                    # Không crash nếu signal fail
                                    logging.debug(f"[{self.camera_id}] Failed to emit signal: {e}")

                                # 📤 GỬI OCR VỀ CENTRAL SERVER
                                try:
                                    cfg = load_config()
                                    meta = cfg.get("metadata", {}).get(self.camera_id, {})
                                    camera_name = meta.get("name") or self.camera_id
                                    camera_type = meta.get("camera_type") or "internal"

                                    # Gửi về Central (non-blocking)
                                    success = send_ocr_to_central(
                                        camera_id=self.camera_id,
                                        camera_name=camera_name,
                                        plate_text=final_text,
                                        camera_type=camera_type,
                                        timestamp=ts_str
                                    )

                                    if success:
                                        logging.info(
                                            f"[{self.camera_id}] 📤 Sent to Central: {final_text} "
                                            f"→ {camera_name}"
                                        )
                                    else:
                                        # 404 là bình thường (xe chưa vào), chỉ log debug
                                        logging.debug(
                                            f"[{self.camera_id}] Central: Vehicle {final_text} "
                                            f"not in parking or network error"
                                        )
                                except Exception as central_e:
                                    # Không crash nếu gửi fail
                                    logging.error(f"[{self.camera_id}] Error sending to Central: {central_e}")

                            except Exception as db_e:
                                logging.error(f"[{self.camera_id}] Failed to save OCR log: {db_e}")
                        else:
                            logging.debug(
                                f"[{self.camera_id}] Skipped duplicate plate: {final_text} "
                                f"(track {track_id})"
                            )
                    else:
                        # ❌ OCR THẤT BẠI (không có kết quả hợp lệ)
                        # → KHÔNG đánh dấu processed, để track tiếp tục thu thập frames tốt hơn
                        logging.debug(
                            f"[{self.camera_id}] Track {track_id} OCR failed "
                            f"({len(candidates)} candidates, 0 valid results) - will retry with more frames"
                        )

                except Exception as e:
                    logging.error(f"[{self.camera_id}] OCR processing error: {e}", exc_info=True)
                    self.stats["ocr_errors"] = self.stats.get("ocr_errors", 0) + 1

                # Mark task done
                self.ocr_queue.task_done()

            except Exception as e:
                logging.error(f"[{self.camera_id}] OCR loop error: {e}", exc_info=True)
                self.stats["ocr_errors"] = self.stats.get("ocr_errors", 0) + 1
                time.sleep(0.1)

    def _open_capture(self) -> Optional[cv2.VideoCapture]:
        """Open RTSP connection with TCP transport (IP camera requirement)"""
        print(f"[{self.camera_id}] Attempting RTSP connection: {self.url}", flush=True)
        logging.info(f"[{self.camera_id}] Opening RTSP URL: {self.url}")

        # FFmpeg options optimized for IP cameras
        # Using stimeout for connection timeout and avoiding aggressive buffering
        opts = "rtsp_transport;tcp|stimeout;5000000|max_delay;500000"

        try:
            os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = opts
            cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)

            if not cap.isOpened():
                logging.error(f"[{self.camera_id}] VideoCapture.isOpened() returned False")
                print(f"[{self.camera_id}] ❌ RTSP FAILED - isOpened() = False", flush=True)
                self.stats["last_err"] = "rtsp_open_failed"
                return None

            # Set capture properties
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            # Note: CAP_PROP_FPS chỉ là hint, không force FPS thực tế
            # FPS thực tế được control bởi detection_fps trong detection loop
            cv2.setNumThreads(2)

            # Test connection by reading one frame
            print(f"[{self.camera_id}] Testing frame read...", flush=True)
            ret, test_frame = cap.read()

            if not ret or test_frame is None:
                logging.error(f"[{self.camera_id}] Failed to read test frame")
                print(f"[{self.camera_id}] ❌ RTSP FAILED - cannot read frames", flush=True)
                self.stats["last_err"] = "rtsp_no_frames"
                cap.release()
                return None

            print(f"[{self.camera_id}] ✅ RTSP SUCCESS - frame: {test_frame.shape}", flush=True)
            logging.info(f"[{self.camera_id}] RTSP opened, frame size: {test_frame.shape}")
            return cap

        except Exception as e:
            self.stats["last_err"] = f"rtsp_exception: {e}"
            print(f"[{self.camera_id}] ❌ RTSP EXCEPTION: {e}", flush=True)
            logging.exception(f"[{self.camera_id}] open_capture exception")
            return None

    def draw_overlay(self, frame: np.ndarray) -> np.ndarray:
        """
        Vẽ overlay lên raw frame (vehicles + track IDs + plates)
        Similar to VideoSourceWorker.draw_overlay()

        Khi enable_detection=False, chỉ trả về frame gốc (không vẽ overlay)
        """
        display = frame.copy()

        # Stream-only mode: không vẽ overlay
        if not self.enable_detection:
            return display

        # Get detection results (thread-safe)
        with self.detection_lock:
            if not self.detection_results:
                return display
            vehicles = self.detection_results.get("vehicles", [])
            plates = self.detection_results.get("plates", [])

        # Fixed colors: Blue for vehicle, Green for plate
        vehicle_color = (255, 0, 0)  # Blue (BGR format)
        plate_color = (0, 255, 0)    # Green (BGR format)

        # Draw vehicles with Track IDs
        for veh_x1, veh_y1, veh_x2, veh_y2, track_id in vehicles:
            # Draw vehicle box (blue)
            cv2.rectangle(display, (veh_x1, veh_y1), (veh_x2, veh_y2), vehicle_color, 2)

            # Draw Track ID label
            label = f"Vehicle ID:{track_id}"
            label_y = max(veh_y1 - 10, 20)
            cv2.putText(display, label, (veh_x1 + 5, label_y),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, vehicle_color, 2)

            # Draw finalized plate if available
            if track_id in self.vehicle_tracks:
                track = self.vehicle_tracks[track_id]
                if track.ocr_processed and track.candidates:
                    # Show latest OCR result for this track
                    plate_label = f"{self.latest_ocr_text}"
                    plate_y = max(veh_y1 - 35, 45)
                    cv2.putText(display, plate_label, (veh_x1 + 5, plate_y),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.7, plate_color, 2)

        # Draw plate bounding boxes
        for plate_data in plates:
            bbox = plate_data["bbox"]
            conf = plate_data.get("confidence", 0)

            # Draw plate box (green)
            x1, y1, x2, y2 = map(int, bbox)
            cv2.rectangle(display, (x1, y1), (x2, y2), plate_color, 2)

            # Draw confidence
            cv2.putText(display, f"{conf:.2f}", (x1, y1 - 5),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.4, plate_color, 1)

        # Draw latest OCR result
        if self.latest_ocr_text:
            ocr_label = f"Latest: {self.latest_ocr_text}"
            cv2.putText(display, ocr_label, (10, 30),
                       cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)

        # Draw stats
        stats_y = 70
        stats_text = f"FPS: {self.stats['fps']:.1f} | Tracks: {self.stats.get('active_tracks', 0)}"
        cv2.putText(display, stats_text, (10, stats_y),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        return display

    def get_frame(self) -> Tuple[Optional[np.ndarray], Dict]:
        """
        Get latest frame with overlay (similar to VideoSourceWorker)
        Returns: (display_frame, detection_info)
        """
        # Get raw frame
        with self.raw_frame_lock:
            if self.raw_frame is None:
                return None, {}

            # Draw overlay on raw frame
            display_frame = self.draw_overlay(self.raw_frame)

        # Get detection info
        with self.detection_lock:
            detection_info = self.detection_results.copy() if self.detection_results else {}

        return display_frame, detection_info

    def health_check(self) -> dict:
        """
        Check worker health status
        Returns dict with health metrics
        """
        now = time.time()
        last_frame_age = now - self.last_update_ts if self.last_update_ts > 0 else -1

        return {
            "running": self.running,
            "reader_alive": self.reader_thread.is_alive() if self.reader_thread else False,
            "detector_alive": self.detector_thread.is_alive() if self.detector_thread else False,
            "ocr_alive": self.ocr_thread.is_alive() if self.ocr_thread else False,
            "last_frame_age_seconds": last_frame_age,
            "has_recent_frame": last_frame_age < 5.0 if last_frame_age >= 0 else False,
            "stats": {
                "fps": self.stats.get("fps", 0),
                "errors": self.stats.get("errors", 0),
                "reader_errors": self.stats.get("reader_errors", 0),
                "detection_errors": self.stats.get("detection_errors", 0),
                "ocr_errors": self.stats.get("ocr_errors", 0),
                "queue_full_count": self.stats.get("queue_full_count", 0),
                "active_tracks": self.stats.get("active_tracks", 0),
                "finalized_plates": self.stats.get("finalized_plates", 0),
            },
            "last_error": self.stats.get("last_err", ""),
            "healthy": (
                self.running and
                (self.reader_thread.is_alive() if self.reader_thread else False) and
                (self.detector_thread.is_alive() if self.detector_thread else False) and
                (self.ocr_thread.is_alive() if self.ocr_thread else False) and
                (last_frame_age < 10.0 if last_frame_age >= 0 else False)
            )
        }

