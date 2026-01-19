"""
Video Source Worker module - handles detection from video files (MP4, AVI, etc.)
"""
import os
import time
import logging
import threading
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Tuple
from queue import Queue
from collections import Counter

import cv2
import numpy as np

from .detector import get_detector, get_ocr_service, get_vehicle_detector, crop_plate_image, detect_plates_two_stage
from .config import load_config
from .db import insert_ocr_log, init_db
from .plate_tracker import PlateTracker
from .events import get_event_emitter
from .ocr_sender import send_ocr_to_central
from .camera_worker import normalize_plate_text, is_valid_vietnamese_plate

# Import ByteTrack
try:
    import supervision as sv
    from supervision import Detections
    BYTETRACK_AVAILABLE = True
except ImportError:
    BYTETRACK_AVAILABLE = False
    logging.warning("[VIDEO_WORKER] supervision not available, ByteTrack disabled")


def calculate_blur_score(img: Optional[np.ndarray]) -> float:
    """Tính blur score bằng Laplacian variance"""
    if img is None or img.size == 0:
        return 0.0
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if len(img.shape) == 3 else img
    return cv2.Laplacian(gray, cv2.CV_64F).var()


def calculate_quality_score(plate_roi: Optional[np.ndarray], plate_conf: float, plate_bbox: List[int]) -> float:
    """
    Tính quality score cho plate candidate
    Quality = blur_score (50%) + confidence (30%) + area (20%)
    """
    blur_score = calculate_blur_score(plate_roi) if plate_roi is not None else 0.0
    blur_score_norm = min(blur_score / 500.0, 1.0)

    if len(plate_bbox) >= 4:
        x1, y1, x2, y2 = plate_bbox[:4]
        area = (x2 - x1) * (y2 - y1)
        area_score = min(area / 10000.0, 1.0)
    else:
        area_score = 0.0

    conf_score = float(plate_conf)
    quality = blur_score_norm * 0.5 + conf_score * 0.3 + area_score * 0.2
    return quality


@dataclass
class PlateCandidate:
    """Candidate plate từ 1 frame"""
    frame: np.ndarray
    plate_roi: Optional[np.ndarray]
    bbox: List[int]
    confidence: float
    quality: float
    timestamp: float


@dataclass
class VehicleTrack:
    """Track cho 1 xe - thu thập frames tốt nhất để OCR"""
    track_id: int
    candidates: List[PlateCandidate] = field(default_factory=list)
    last_seen: float = field(default_factory=time.time)
    ocr_processed: bool = False
    final_plate: Optional[str] = None

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
class VideoSourceWorker:
    """
    Video file processing worker - similar to CameraWorker but for video files
    Processes video frame by frame, runs detection + OCR

    NEW ARCHITECTURE (3-thread với 2 FPS độc lập):
    1. Stream thread: Đọc video ở target_fps (configurable) → raw_frame (smooth playback)
    2. Detection thread: AI processing ở detection_fps (configurable) → giảm CPU load
    3. OCR thread: Xử lý OCR voting trên best frames

    FPS CONFIG (trong config.yaml):
    - stream_fps: 30.0 (smooth display)
    - detection_fps: 10.0 (balanced CPU usage, 67% reduction vs 30 FPS)

    LOGIC: Stream cao để hiển thị mượt, Detection thấp để tiết kiệm CPU
    """

    video_id: str  # Unique ID for this video job
    video_path: str  # Path to video file
    target_fps: float = 30.0  # Stream FPS (will be loaded from config.yaml)
    detection_fps: float = 10.0  # Detection FPS (will be loaded from config.yaml)

    running: bool = field(default=False, init=False)
    stream_thread: Optional[threading.Thread] = field(default=None, init=False)
    detection_thread: Optional[threading.Thread] = field(default=None, init=False)
    ocr_thread: Optional[threading.Thread] = field(default=None, init=False)

    # Raw frame from stream (smooth 20 FPS)
    raw_frame: Optional[np.ndarray] = field(default=None, init=False)
    raw_frame_lock: threading.Lock = field(default_factory=threading.Lock, init=False)
    raw_frame_counter: int = field(default=0, init=False)  # Frame counter để tránh process trùng

    # Detection results (from background thread)
    detection_results: Dict = field(default_factory=dict, init=False)
    detection_lock: threading.Lock = field(default_factory=threading.Lock, init=False)

    # ByteTrack
    byte_tracker: Optional[object] = field(default=None, init=False)
    vehicle_tracks: Dict[int, VehicleTrack] = field(default_factory=dict, init=False)

    # OCR queue
    ocr_queue: Queue = field(default_factory=Queue, init=False)
    latest_ocr_text: str = field(default="", init=False)
    latest_ocr_timestamp: float = field(default=0.0, init=False)

    # Video info
    total_frames: int = field(default=0, init=False)
    current_frame_idx: int = field(default=0, init=False)
    video_fps: float = field(default=0.0, init=False)
    is_completed: bool = field(default=False, init=False)

    # Results storage
    detected_plates: List[dict] = field(default_factory=list, init=False)
    seen_plates: set = field(default_factory=set, init=False)

    stats: Dict = field(
        default_factory=lambda: {
            "stream_fps": 0.0,
            "detection_fps": 0.0,
            "errors": 0,
            "last_err": "",
            "finalized_plates": 0,
            "progress": 0.0,
        },
        init=False,
    )

    def start(self):
        if self.running:
            return

        # Check if video file exists
        if not os.path.exists(self.video_path):
            logging.error(f"[{self.video_id}] Video file not found: {self.video_path}")
            return

        logging.info(f"[{self.video_id}] Starting video processing: {self.video_path}")

        # Load FPS config from YAML
        try:
            cfg = load_config()
            fps_config = cfg.get("fps", {})
            self.target_fps = float(fps_config.get("stream_fps", 30.0))
            self.detection_fps = float(fps_config.get("detection_fps", 10.0))
            logging.info(f"[{self.video_id}] FPS config: stream={self.target_fps}, detection={self.detection_fps}")
        except Exception as e:
            logging.warning(f"[{self.video_id}] Failed to load FPS config, using defaults: {e}")
            self.target_fps = 30.0
            self.detection_fps = 10.0

        # Đảm bảo DB đã được khởi tạo
        try:
            init_db()
        except Exception as e:
            logging.error(f"[{self.video_id}] Failed to init DB: {e}")

        # Initialize ByteTrack
        if BYTETRACK_AVAILABLE:
            self.byte_tracker = sv.ByteTrack(
                track_activation_threshold=0.5,
                lost_track_buffer=30,
                minimum_matching_threshold=0.8,
                frame_rate=int(self.detection_fps)  # Use detection FPS, not stream FPS
            )
            logging.info(f"[{self.video_id}] ByteTrack initialized with {self.detection_fps} FPS")
        else:
            logging.warning(f"[{self.video_id}] ByteTrack not available")

        self.running = True
        self.is_completed = False

        # Thread 1: Stream - Đọc video 20 FPS
        self.stream_thread = threading.Thread(target=self._stream_loop, daemon=True)
        self.stream_thread.start()

        # Thread 2: Detection - AI processing ở background
        self.detection_thread = threading.Thread(target=self._detection_loop, daemon=True)
        self.detection_thread.start()

        # Thread 3: OCR - Xử lý OCR trên best frames
        self.ocr_thread = threading.Thread(target=self._ocr_loop, daemon=True)
        self.ocr_thread.start()

    def stop(self):
        self.running = False
        # Clear OCR queue
        while not self.ocr_queue.empty():
            try:
                self.ocr_queue.get_nowait()
            except:
                pass
        for th in (self.stream_thread, self.detection_thread, self.ocr_thread):
            if th and th.is_alive():
                th.join(timeout=1.0)
        logging.info(f"[{self.video_id}] stopped")

    def _stream_loop(self):
        """
        Thread 1: Stream loop - Đọc video 20 FPS và update raw_frame
        Mục tiêu: Smooth playback, không chờ AI
        """
        cap = None
        try:
            cap = cv2.VideoCapture(self.video_path)
            if not cap.isOpened():
                logging.error(f"[{self.video_id}] Cannot open video file")
                self.stats["last_err"] = "cannot_open_video"
                return

            # Get video info
            self.total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            self.video_fps = cap.get(cv2.CAP_PROP_FPS)
            logging.info(f"[{self.video_id}] Video: {self.total_frames} frames, {self.video_fps} fps")

            frame_idx = 0
            frame_count = 0
            t_start = time.time()
            target_interval = 1.0 / self.target_fps

            while self.running:
                loop_start = time.time()

                ret, frame = cap.read()
                if not ret or frame is None:
                    logging.info(f"[{self.video_id}] Stream ended")
                    self.is_completed = True
                    break

                frame_idx += 1
                self.current_frame_idx = frame_idx
                frame_count += 1

                # Update progress
                if self.total_frames > 0:
                    self.stats["progress"] = (frame_idx / self.total_frames) * 100

                # Update raw frame (thread-safe)
                with self.raw_frame_lock:
                    self.raw_frame = frame.copy()
                    self.raw_frame_counter += 1  # Increment counter

                # Calculate stream FPS
                elapsed = time.time() - t_start
                if elapsed > 0:
                    self.stats["stream_fps"] = frame_count / elapsed

                # Sleep để đạt target FPS
                elapsed_loop = time.time() - loop_start
                sleep_time = target_interval - elapsed_loop
                if sleep_time > 0:
                    time.sleep(sleep_time)

            self.is_completed = True
            logging.info(f"[{self.video_id}] Stream loop finished")

        except Exception as e:
            logging.error(f"[{self.video_id}] Stream loop error: {e}")
            self.stats["last_err"] = str(e)
        finally:
            if cap:
                cap.release()

    def _detection_loop(self):
        """
        Thread 2: Detection loop - AI processing ở background
        Mục tiêu: Detect vehicles → track → thu thập best frames → trigger OCR

        FPS CONTROL: Chạy ở detection_fps (VD: 5 FPS) để giảm CPU load
        """
        try:
            vehicle_detector = get_vehicle_detector()
            plate_detector = get_detector()

            detect_count = 0
            t_start = time.time()
            last_processed_frame = -1  # Track last processed frame
            target_interval = 1.0 / self.detection_fps  # VD: 1/5 = 0.2s

            while self.running:
                loop_start = time.time()
                # Lấy raw frame (chỉ process frame mới)
                with self.raw_frame_lock:
                    if self.raw_frame is None:
                        # Nếu stream đã complete và không có frame → thoát
                        if self.is_completed:
                            break
                        time.sleep(0.01)
                        continue

                    # Skip nếu đã process frame này rồi
                    if self.raw_frame_counter == last_processed_frame:
                        time.sleep(0.01)
                        continue

                    frame = self.raw_frame.copy()
                    last_processed_frame = self.raw_frame_counter

                try:
                    # Detect vehicles
                    vehicles = vehicle_detector.detect_vehicles(frame, conf_threshold=0.5)
                    detect_count += 1

                    # Initialize empty detection results (sẽ được update nếu có vehicles)
                    vehicle_list = []
                    plate_bboxes = []

                    # Update ByteTrack
                    if BYTETRACK_AVAILABLE and self.byte_tracker and vehicles:
                        xyxy = np.array([[veh_x1, veh_y1, veh_x2, veh_y2]
                                        for veh_x1, veh_y1, veh_x2, veh_y2, veh_conf, veh_cls in vehicles])
                        confidence = np.array([veh_conf for _, _, _, _, veh_conf, _ in vehicles])
                        class_id = np.array([veh_cls for _, _, _, _, _, veh_cls in vehicles])

                        detections = Detections(xyxy=xyxy, confidence=confidence, class_id=class_id)
                        detections = self.byte_tracker.update_with_detections(detections)

                        # Build vehicle list for display
                        vehicle_list = [(int(detections.xyxy[i][0]), int(detections.xyxy[i][1]),
                                        int(detections.xyxy[i][2]), int(detections.xyxy[i][3]),
                                        int(detections.tracker_id[i])) for i in range(len(detections))]

                        # Process tracked vehicles
                        for i in range(len(detections)):
                            track_id = int(detections.tracker_id[i])
                            veh_x1, veh_y1, veh_x2, veh_y2 = map(int, detections.xyxy[i])
                            veh_conf = float(detections.confidence[i])

                            # Detect plate trong vehicle ROI
                            veh_roi = crop_plate_image(frame, [veh_x1, veh_y1, veh_x2, veh_y2])
                            if veh_roi is None:
                                continue

                            plates = plate_detector.detect_from_frame(veh_roi, conf_threshold=0.4)
                            if not plates:
                                continue

                            # Get first plate (highest confidence)
                            plate = plates[0]
                            plate_bbox_local = plate["bbox"]
                            plate_x1, plate_y1, plate_x2, plate_y2 = plate_bbox_local

                            # Map to global coordinates
                            global_x1 = veh_x1 + plate_x1
                            global_y1 = veh_y1 + plate_y1
                            global_x2 = veh_x1 + plate_x2
                            global_y2 = veh_y1 + plate_y2
                            global_bbox = [global_x1, global_y1, global_x2, global_y2]

                            # Crop plate ROI
                            plate_roi = crop_plate_image(frame, global_bbox)
                            quality = calculate_quality_score(plate_roi, plate["confidence"], global_bbox)

                            # Add to track
                            if track_id not in self.vehicle_tracks:
                                self.vehicle_tracks[track_id] = VehicleTrack(track_id=track_id)

                            track = self.vehicle_tracks[track_id]
                            track.last_seen = time.time()

                            candidate = PlateCandidate(
                                frame=frame.copy(),
                                plate_roi=plate_roi,
                                bbox=global_bbox,
                                confidence=plate["confidence"],
                                quality=quality,
                                timestamp=time.time()
                            )
                            track.candidates.append(candidate)

                            # Trigger OCR nếu đủ frames
                            if track.is_ready_for_ocr(min_frames=5):
                                best_candidates = track.get_best_candidates(top_n=3)
                                self.ocr_queue.put((track_id, best_candidates))
                                # NOTE: KHÔNG đánh dấu processed ở đây nữa
                                # Chỉ đánh dấu KHI OCR THÀNH CÔNG (trong _ocr_loop)

                            # Add plate bbox for display (CHỈ từ tracks đang active)
                            plate_bboxes.append({
                                "bbox": global_bbox,
                                "track_id": track_id
                            })

                    # IMPORTANT: ALWAYS update detection results (even if empty) để xóa boxes cũ
                    with self.detection_lock:
                        self.detection_results = {
                            "vehicles": vehicle_list,
                            "plates": plate_bboxes,
                            "timestamp": time.time()
                        }

                    # Calculate detection FPS
                    elapsed = time.time() - t_start
                    if elapsed > 0:
                        self.stats["detection_fps"] = detect_count / elapsed

                except Exception as e:
                    logging.error(f"[{self.video_id}] Detection error: {e}")
                    self.stats["errors"] += 1
                    self.stats["last_err"] = str(e)

                # ✅ FPS CONTROL: Sleep để maintain detection_fps
                elapsed_loop = time.time() - loop_start
                sleep_time = target_interval - elapsed_loop
                if sleep_time > 0:
                    time.sleep(sleep_time)

            logging.info(f"[{self.video_id}] Detection loop finished")

        except Exception as e:
            logging.error(f"[{self.video_id}] Detection loop error: {e}")
            self.stats["last_err"] = str(e)

    def _ocr_loop(self):
        """
        Thread 3: OCR loop - Xử lý OCR trên best frames của mỗi track
        Mục tiêu: Run OCR trên top 3 frames → voting → finalize plate
        """
        ocr_service = get_ocr_service()
        if not ocr_service or not ocr_service.is_ready():
            logging.warning(f"[{self.video_id}] OCR service not available")
            return

        while self.running or not self.ocr_queue.empty():
            try:
                # Get (track_id, best_candidates) từ queue
                track_id, candidates = self.ocr_queue.get(timeout=0.5)
            except:
                continue

            try:
                # Run OCR trên từng candidate
                ocr_votes = []
                for candidate in candidates:
                    if candidate.plate_roi is None:
                        continue

                    raw_text = ocr_service.recognize(candidate.plate_roi)
                    if not raw_text:
                        continue

                    normalized = normalize_plate_text(raw_text)

                    # Validate Vietnamese plate
                    if normalized and is_valid_vietnamese_plate(normalized):
                        ocr_votes.append(normalized)

                if not ocr_votes:
                    # ❌ OCR THẤT BẠI → KHÔNG đánh dấu processed, để track tiếp tục thu thập
                    logging.debug(
                        f"[{self.video_id}] Track {track_id} OCR failed "
                        f"({len(candidates)} candidates, 0 valid results) - will retry with more frames"
                    )
                    continue

                # Voting: Lấy plate xuất hiện nhiều nhất
                vote_counts = Counter(ocr_votes)
                final_plate, votes = vote_counts.most_common(1)[0]

                # ✅ OCR THÀNH CÔNG → Đánh dấu processed = True
                if track_id in self.vehicle_tracks:
                    self.vehicle_tracks[track_id].final_plate = final_plate
                    self.vehicle_tracks[track_id].ocr_processed = True

                # Update latest OCR
                self.latest_ocr_text = final_plate
                self.latest_ocr_timestamp = time.time()

                # Deduplication: Chỉ lưu nếu chưa thấy plate này
                if final_plate not in self.seen_plates:
                    self.seen_plates.add(final_plate)

                    # Get best candidate confidence
                    best_candidate = candidates[0]
                    confidence = best_candidate.confidence

                    logging.info(
                        f"[{self.video_id}] Track {track_id}: {final_plate} "
                        f"(conf={confidence:.2f}, votes={votes}/{len(ocr_votes)})"
                    )

                    # Save to DB
                    try:
                        from datetime import datetime
                        timestamp = datetime.now().isoformat()
                        # Lấy camera_type từ config để lưu vào DB
                        cfg = load_config()
                        meta = cfg.get("metadata", {}).get(self.video_id, {})
                        camera_type = meta.get("camera_type") or "entrance"
                        insert_ocr_log(
                            camera_id=self.video_id,
                            plate_text=final_plate,
                            timestamp=timestamp,
                            camera_type=camera_type
                        )
                    except Exception as e:
                        logging.error(f"[{self.video_id}] Failed to save to DB: {e}")

                    # Add to detected plates list
                    self.detected_plates.append({
                        "plate": final_plate,
                        "confidence": confidence,
                        "votes": votes,
                        "track_id": track_id,
                        "timestamp": time.time(),
                        "frame_idx": self.current_frame_idx
                    })

                    # Send to central
                    try:
                        # Get camera_name and camera_type from metadata
                        cfg = load_config()
                        meta = cfg.get("metadata", {}).get(self.video_id, {})
                        camera_name = meta.get("name") or self.video_id
                        camera_type = meta.get("camera_type") or "entrance"

                        send_ocr_to_central(
                            camera_id=self.video_id,
                            camera_name=camera_name,
                            plate_text=final_plate,
                            camera_type=camera_type
                        )
                    except Exception as e:
                        logging.error(f"[{self.video_id}] Failed to send to central: {e}")

                    # Emit event
                    try:
                        emitter = get_event_emitter()
                        if hasattr(emitter, 'notify'):
                            emitter.notify(
                                "new_ocr_result",
                                {
                                    "camera_id": self.video_id,
                                    "plate_text": final_plate,
                                    "confidence": confidence,
                                    "vote_count": votes,
                                    "track_id": track_id,
                                },
                            )
                    except Exception as e:
                        logging.debug(f"[{self.video_id}] Event emit skipped: {e}")

                    self.stats["finalized_plates"] += 1

            except Exception as e:
                logging.error(f"[{self.video_id}] OCR loop error: {e}")

    def draw_overlay(self, frame: np.ndarray) -> np.ndarray:
        """
        Vẽ overlay lên raw frame (vehicles + track IDs + plates)
        """
        display = frame.copy()

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
                if track.final_plate:
                    plate_label = f"{track.final_plate}"
                    plate_y = max(veh_y1 - 35, 45)
                    cv2.putText(display, plate_label, (veh_x1 + 5, plate_y),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.7, plate_color, 2)

        # Draw plate bounding boxes
        for plate_data in plates:
            bbox = plate_data["bbox"]

            # Draw plate box (green)
            x1, y1, x2, y2 = map(int, bbox)
            cv2.rectangle(display, (x1, y1), (x2, y2), plate_color, 2)

        # Draw latest OCR result
        if self.latest_ocr_text:
            ocr_label = f"Latest: {self.latest_ocr_text}"
            cv2.putText(display, ocr_label, (10, 30),
                       cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)

        # Draw stats
        stats_y = 70
        stats_text = f"Stream: {self.stats['stream_fps']:.1f} FPS | Detection: {self.stats['detection_fps']:.1f} FPS"
        cv2.putText(display, stats_text, (10, stats_y),
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        return display

    def get_frame(self):
        """
        Get latest frame with overlay
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

    def get_stats(self):
        """Get processing statistics"""
        return {
            **self.stats,
            "current_frame": self.current_frame_idx,
            "total_frames": self.total_frames,
            "is_completed": self.is_completed,
            "detected_plates_count": len(self.detected_plates),
        }

    def get_results(self):
        """Get all detected plates"""
        return self.detected_plates
