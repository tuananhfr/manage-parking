"""
Detector and OCR service module
"""
import os
import logging
from pathlib import Path
from typing import Optional, List, Tuple
import numpy as np
import cv2

# Import ONNX detector from core directory
from .onnx_detector import ONNXLicensePlateDetector
from .vehicle_detector import VehicleDetector

_shared_detector: Optional[ONNXLicensePlateDetector] = None
_shared_vehicle_detector: Optional[VehicleDetector] = None


def get_detector() -> ONNXLicensePlateDetector:
    """Shared detector instance - đọc model path từ config.yaml"""
    global _shared_detector
    if _shared_detector is None:
        # Đọc model path từ config.yaml
        from .config import load_config
        cfg = load_config()
        model_name = cfg.get("model", {}).get("path", "best.onnx")
        models_dir = Path(__file__).resolve().parent.parent / "models"
        model_path = str(models_dir / model_name)
        logging.info(f"[DETECTOR] Loading ONNX model from {model_path}")
        _shared_detector = ONNXLicensePlateDetector(model_path=model_path)
    return _shared_detector


def get_vehicle_detector() -> VehicleDetector:
    """Shared vehicle detector instance"""
    global _shared_vehicle_detector
    if _shared_vehicle_detector is None:
        models_dir = Path(__file__).resolve().parent.parent / "models"
        model_path = str(models_dir / "yolov8n.onnx")
        logging.info(f"[VEHICLE] Loading YOLOv8n from {model_path}")
        _shared_vehicle_detector = VehicleDetector(model_path=model_path)
    return _shared_vehicle_detector


class OCRService:
    """
    OCR Service - YOLO OCR cho license plate
    Sử dụng Ultralytics YOLO để detect và đọc ký tự
    """
    def __init__(self, model_path: str):
        self.ocr = None
        self.ocr_type = 'none'
        self._ready = False
        self.error = None
        self.model_path = model_path
        
        # Try init YOLO
        if self._try_init_yolo():
            logging.info(f"[OCR] ✅ YOLO OCR ready: {model_path}")
        else:
            logging.warning(f"[OCR] ❌ Failed to load OCR model: {self.error}")
    
    def is_ready(self):
        return self._ready
    
    def _try_init_yolo(self):
        """Khởi tạo YOLO OCR"""
        if not os.path.exists(self.model_path):
            self.error = f"Model không tồn tại: {self.model_path}"
            return False
        
        try:
            from ultralytics import YOLO
            self.ocr = YOLO(self.model_path, task='detect')
            self.ocr_type = 'yolo'
            self._ready = True
            self.error = None
            return True
        except ImportError:
            self.error = "Thiếu ultralytics (pip install ultralytics)"
            return False
        except Exception as exc:
            self.error = f"YOLO init lỗi: {exc}"
            return False
    
    def recognize(self, plate_img: np.ndarray) -> str:
        """
        Đọc text từ plate image
        
        Args:
            plate_img: Cropped license plate image (BGR)
        
        Returns:
            Text string hoặc "" nếu không đọc được
        """
        if not self.is_ready():
            return ""
        
        try:
            # Run inference
            ocr_results = self.ocr(plate_img, conf=0.25, verbose=False, imgsz=640)
            
            # Parse character boxes
            char_data = []
            for cr in ocr_results:
                for cb in cr.boxes:
                    bx1, by1, bx2, by2 = map(int, cb.xyxy[0])
                    char_data.append([
                        bx1, by1, bx2, by2,
                        float(cb.conf[0]),
                        int(cb.cls[0])
                    ])
            
            if not char_data:
                return ""
            
            # Sort và ghép text
            text = self._sort_chars(char_data)
            return text if text else ""
        
        except Exception as e:
            logging.error(f"[OCR Error] {e}")
            return ""
    
    def _sort_chars(self, boxes):
        """Sắp xếp ký tự theo vị trí"""
        if not boxes:
            return ""
        
        # Get class names
        if self.ocr.names is None:
            # Vietnamese plate charset (36 classes: 0-9, A-Z)
            charset = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
            names = {i: c for i, c in enumerate(charset)}
        else:
            names = self.ocr.names
        
        chars = []
        for box in boxes:
            x1, y1, x2, y2 = box[:4]
            cls = int(box[5])
            label = names.get(cls, str(cls))
            
            if label:
                chars.append([(x1+x2)/2, (y1+y2)/2, str(label)])
        
        if not chars:
            return ""
        
        y_coords = [c[1] for c in chars]
        mean_y = sum(y_coords) / len(y_coords) if y_coords else 0
        
        # Check if 2 lines
        is_two_lines = False
        if len(chars) > 2:
            spread = max(y_coords) - min(y_coords)
            if spread > (max(y_coords) + min(y_coords)) * 0.15:
                is_two_lines = True
        
        if is_two_lines:
            top = sorted([c for c in chars if c[1] < mean_y], key=lambda x: x[0])
            bot = sorted([c for c in chars if c[1] >= mean_y], key=lambda x: x[0])
            return "".join([c[2] for c in top]) + "-" + "".join([c[2] for c in bot])
        else:
            return "".join([c[2] for c in sorted(chars, key=lambda x: x[0])])
    
    def recognize_batch(self, images: List[np.ndarray]) -> List[str]:
        """OCR nhiều ảnh cùng lúc"""
        return [self.recognize(img) for img in images]


_shared_ocr_service: Optional[OCRService] = None


def get_ocr_service() -> OCRService:
    """Shared OCR service instance - đọc OCR model path từ config.yaml"""
    global _shared_ocr_service
    if _shared_ocr_service is None:
        # Đọc OCR model path từ config.yaml
        from .config import load_config
        cfg = load_config()
        ocr_name = cfg.get("ocr", {}).get("path", "ocr.onnx")
        models_dir = Path(__file__).resolve().parent.parent / "models"
        ocr_path = str(models_dir / ocr_name)
        logging.info(f"[OCR] Loading OCR model from {ocr_path}")
        _shared_ocr_service = OCRService(ocr_path)
    return _shared_ocr_service


def crop_plate_image(frame: np.ndarray, bbox: List[int]) -> Optional[np.ndarray]:
    """
    Crop vùng biển số từ frame

    Args:
        frame: Full frame (BGR)
        bbox: [x1, y1, x2, y2]

    Returns:
        Cropped image hoặc None nếu bbox không hợp lệ
    """
    try:
        import cv2
        x1, y1, x2, y2 = bbox
        # Đảm bảo coordinates hợp lệ
        x1 = max(0, int(x1))
        y1 = max(0, int(y1))
        x2 = min(frame.shape[1], int(x2))
        y2 = min(frame.shape[0], int(y2))

        if x2 <= x1 or y2 <= y1:
            return None

        plate_roi = frame[y1:y2, x1:x2]
        return plate_roi
    except Exception as e:
        logging.error(f"Error cropping plate: {e}")
        return None


def detect_plates_two_stage(
    frame: np.ndarray,
    vehicle_conf: float = 0.5,
    plate_conf: float = 0.4,
    fallback_direct: bool = True
) -> List[Tuple[int, int, int, int, float, int, Optional[Tuple[int, int, int, int]]]]:
    """
    2-stage detection: Detect vehicles first, then license plates within vehicle ROIs

    Args:
        frame: Input frame (BGR)
        vehicle_conf: Confidence threshold for vehicle detection
        plate_conf: Confidence threshold for plate detection
        fallback_direct: If True, fallback to direct plate detection if no vehicles found

    Returns:
        List of (plate_x1, plate_y1, plate_x2, plate_y2, plate_conf, plate_cls, vehicle_bbox)
        vehicle_bbox is (veh_x1, veh_y1, veh_x2, veh_y2) or None if direct detection
    """
    try:
        vehicle_detector = get_vehicle_detector()
    except Exception as e:
        logging.warning(f"[2-STAGE] Vehicle detector not available: {e}, using direct detection")
        # Fallback to direct detection
        plate_detector = get_detector()
        plates = plate_detector.detect_from_frame(frame, conf_threshold=plate_conf)
        results = []
        for det in plates:
            bbox = det["bbox"]
            plate_x1, plate_y1, plate_x2, plate_y2 = bbox
            plate_conf = det["confidence"]
            plate_cls = det["class_id"]
            results.append((
                int(plate_x1), int(plate_y1), int(plate_x2), int(plate_y2),
                plate_conf, plate_cls, None
            ))
        return results

    plate_detector = get_detector()
    results = []

    # Stage 1: Detect vehicles
    vehicles = vehicle_detector.detect_vehicles(frame, conf_threshold=vehicle_conf)

    if not vehicles:
        logging.debug("[2-STAGE] No vehicles detected")

        # Fallback to direct plate detection
        if fallback_direct:
            logging.debug("[2-STAGE] Falling back to direct plate detection")
            plates = plate_detector.detect_from_frame(frame, conf_threshold=plate_conf)
            for det in plates:
                bbox = det["bbox"]
                plate_x1, plate_y1, plate_x2, plate_y2 = bbox
                plate_conf = det["confidence"]
                plate_cls = det["class_id"]
                results.append((
                    int(plate_x1), int(plate_y1), int(plate_x2), int(plate_y2),
                    plate_conf, plate_cls, None  # No vehicle bbox
                ))
        return results

    logging.debug(f"[2-STAGE] Found {len(vehicles)} vehicles")

    # Stage 2: Detect plates within each vehicle ROI
    for veh_x1, veh_y1, veh_x2, veh_y2, veh_conf, veh_cls in vehicles:
        # Crop vehicle ROI
        veh_roi = crop_plate_image(frame, [veh_x1, veh_y1, veh_x2, veh_y2])
        if veh_roi is None:
            continue

        # Detect plates in vehicle ROI
        plates = plate_detector.detect_from_frame(veh_roi, conf_threshold=plate_conf)

        if plates:
            logging.debug(f"[2-STAGE] Found {len(plates)} plates in vehicle {veh_cls}")

            # Map plate coordinates back to original frame
            for det in plates:
                bbox = det["bbox"]
                plate_x1, plate_y1, plate_x2, plate_y2 = bbox
                plate_conf = det["confidence"]
                plate_cls = det["class_id"]

                # Add vehicle ROI offset
                global_x1 = veh_x1 + plate_x1
                global_y1 = veh_y1 + plate_y1
                global_x2 = veh_x1 + plate_x2
                global_y2 = veh_y1 + plate_y2

                results.append((
                    global_x1,
                    global_y1,
                    global_x2,
                    global_y2,
                    plate_conf,
                    plate_cls,
                    (veh_x1, veh_y1, veh_x2, veh_y2)  # Include parent vehicle bbox
                ))

    return results

