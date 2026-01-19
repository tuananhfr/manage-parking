"""
ONNX License Plate Detector - CPU Only
Sử dụng ONNX Runtime để inference, nhanh và nhẹ hơn PyTorch
"""

import cv2
import numpy as np
from pathlib import Path
from typing import List, Tuple, Optional
import onnxruntime as ort


class ONNXLicensePlateDetector:
    """License plate detection using ONNX Runtime (CPU-optimized)"""

    def __init__(self, model_path: str = "models/license_plate1.onnx"):
        """
        Initialize ONNX detector

        Args:
            model_path: Path to ONNX model file
        """
        self.model_path = Path(model_path)
        if not self.model_path.exists():
            raise FileNotFoundError(f"ONNX model not found: {model_path}")

        print(f"[ONNX] Loading license plate detection model from {model_path}")

        # Create ONNX Runtime session (CPU only)
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        # Giới hạn CPU threads để không chiếm hết tài nguyên
        # Sử dụng 4 threads thay vì tất cả cores
        sess_options.intra_op_num_threads = 4  # Limit to 4 threads for inference
        sess_options.inter_op_num_threads = 2  # Limit parallel ops

        self.session = ort.InferenceSession(
            str(self.model_path),
            sess_options=sess_options,
            providers=['CPUExecutionProvider']
        )

        # Get model input/output info
        self.input_name = self.session.get_inputs()[0].name
        self.input_shape = self.session.get_inputs()[0].shape
        self.output_names = [output.name for output in self.session.get_outputs()]

        # Model input size (thường là 640x640 cho YOLO)
        self.imgsz = self.input_shape[2] if len(self.input_shape) == 4 else 640

        print(f"[ONNX] Model loaded successfully")
        print(f"[ONNX] Input: {self.input_name}, shape: {self.input_shape}")
        print(f"[ONNX] Outputs: {self.output_names}")
        print(f"[ONNX] Using CPU with 4 threads (optimized for lower CPU usage)")

    def preprocess(self, frame: np.ndarray) -> Tuple[np.ndarray, float, Tuple[int, int]]:
        """
        Preprocess frame for ONNX model

        Args:
            frame: Input image (BGR, HWC format)

        Returns:
            Tuple of (preprocessed_image, scale, (pad_w, pad_h))
        """
        original_h, original_w = frame.shape[:2]

        # Resize với letterbox (giữ aspect ratio)
        scale = min(self.imgsz / original_w, self.imgsz / original_h)
        new_w = int(original_w * scale)
        new_h = int(original_h * scale)

        resized = cv2.resize(frame, (new_w, new_h))

        # Padding để đạt đúng imgsz x imgsz
        pad_w = (self.imgsz - new_w) // 2
        pad_h = (self.imgsz - new_h) // 2

        padded = cv2.copyMakeBorder(
            resized, pad_h, self.imgsz - new_h - pad_h,
            pad_w, self.imgsz - new_w - pad_w,
            cv2.BORDER_CONSTANT, value=(114, 114, 114)
        )

        # Convert BGR to RGB
        image = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB)

        # Normalize to [0, 1] và chuyển sang CHW format
        image = image.astype(np.float32) / 255.0
        image = np.transpose(image, (2, 0, 1))  # HWC -> CHW

        # Add batch dimension
        image = np.expand_dims(image, axis=0)  # NCHW

        return image, scale, (pad_w, pad_h)

    def postprocess(
        self,
        outputs: List[np.ndarray],
        scale: float,
        padding: Tuple[int, int],
        conf_threshold: float = 0.25,
        iou_threshold: float = 0.45
    ) -> List[dict]:
        """
        Postprocess ONNX outputs to get detections

        Args:
            outputs: ONNX model outputs
            scale: Scale factor from preprocessing
            padding: Padding (pad_w, pad_h) from preprocessing
            conf_threshold: Confidence threshold
            iou_threshold: IOU threshold for NMS

        Returns:
            List of detections
        """
        # YOLO output format: [1, num_boxes, 85] (4 bbox + 1 conf + 80 classes)
        # hoặc [1, 84, num_boxes] (phụ thuộc vào phiên bản YOLO)
        output = outputs[0]

        # Reshape nếu cần
        if len(output.shape) == 3:
            if output.shape[1] > output.shape[2]:
                # [1, num_boxes, 85] -> đúng format
                output = output[0]  # [num_boxes, 85]
            else:
                # [1, 85, num_boxes] -> transpose
                output = output[0].T  # [num_boxes, 85]
        else:
            output = output[0]

        # Extract boxes và scores
        boxes = output[:, :4]  # [num_boxes, 4] - x_center, y_center, w, h
        scores = output[:, 4]  # [num_boxes] - objectness score

        # Filter theo confidence
        mask = scores > conf_threshold
        boxes = boxes[mask]
        scores = scores[mask]

        if len(boxes) == 0:
            return []

        # Convert from center format to corner format
        # [x_center, y_center, w, h] -> [x1, y1, x2, y2]
        x_center, y_center, w, h = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        x1 = x_center - w / 2
        y1 = y_center - h / 2
        x2 = x_center + w / 2
        y2 = y_center + h / 2

        # Unpad và unscale coordinates
        pad_w, pad_h = padding
        x1 = (x1 - pad_w) / scale
        y1 = (y1 - pad_h) / scale
        x2 = (x2 - pad_w) / scale
        y2 = (y2 - pad_h) / scale

        # NMS (Non-Maximum Suppression)
        boxes_for_nms = np.stack([x1, y1, x2, y2], axis=1)
        indices = self._nms(boxes_for_nms, scores, iou_threshold)

        # Build detections
        detections = []
        for idx in indices:
            detections.append({
                "bbox": [int(x1[idx]), int(y1[idx]), int(x2[idx]), int(y2[idx])],
                "confidence": float(scores[idx]),
                "class_id": 0,
                "class_name": "license_plate"
            })

        return detections

    def _nms(self, boxes: np.ndarray, scores: np.ndarray, iou_threshold: float) -> List[int]:
        """
        Non-Maximum Suppression

        Args:
            boxes: Array of boxes [N, 4] in format [x1, y1, x2, y2]
            scores: Array of scores [N]
            iou_threshold: IOU threshold

        Returns:
            List of indices to keep
        """
        x1 = boxes[:, 0]
        y1 = boxes[:, 1]
        x2 = boxes[:, 2]
        y2 = boxes[:, 3]

        areas = (x2 - x1) * (y2 - y1)
        order = scores.argsort()[::-1]

        keep = []
        while order.size > 0:
            i = order[0]
            keep.append(i)

            # Compute IoU of the kept box with the rest
            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            yy2 = np.minimum(y2[i], y2[order[1:]])

            w = np.maximum(0.0, xx2 - xx1)
            h = np.maximum(0.0, yy2 - yy1)
            inter = w * h

            iou = inter / (areas[i] + areas[order[1:]] - inter)

            # Keep boxes with IoU less than threshold
            inds = np.where(iou <= iou_threshold)[0]
            order = order[inds + 1]

        return keep

    def detect_from_frame(
        self,
        frame: np.ndarray,
        conf_threshold: float = 0.25,
        iou_threshold: float = 0.45
    ) -> List[dict]:
        """
        Detect license plates in a frame

        Args:
            frame: Input image (BGR format from cv2)
            conf_threshold: Confidence threshold
            iou_threshold: IOU threshold for NMS

        Returns:
            List of detection dictionaries
        """
        if frame is None or frame.size == 0:
            return []

        # Preprocess
        input_tensor, scale, padding = self.preprocess(frame)

        # Run inference
        outputs = self.session.run(self.output_names, {self.input_name: input_tensor})

        # Postprocess
        detections = self.postprocess(outputs, scale, padding, conf_threshold, iou_threshold)

        return detections

    def detect_from_image_path(
        self,
        image_path: str,
        conf_threshold: float = 0.25,
        iou_threshold: float = 0.45
    ) -> Tuple[List[dict], np.ndarray]:
        """
        Detect license plates from image file

        Args:
            image_path: Path to image file
            conf_threshold: Confidence threshold
            iou_threshold: IOU threshold

        Returns:
            Tuple of (detections, original_frame)
        """
        frame = cv2.imread(image_path)
        if frame is None:
            raise ValueError(f"Could not read image from {image_path}")

        detections = self.detect_from_frame(frame, conf_threshold, iou_threshold)
        return detections, frame

    def draw_detections(
        self,
        frame: np.ndarray,
        detections: List[dict],
        color: Tuple[int, int, int] = (0, 255, 0),
        thickness: int = 2,
        show_confidence: bool = True
    ) -> np.ndarray:
        """
        Draw bounding boxes on frame

        Args:
            frame: Input image
            detections: List of detections
            color: BGR color for boxes
            thickness: Line thickness
            show_confidence: Whether to show confidence score

        Returns:
            Frame with drawn boxes
        """
        output_frame = frame.copy()

        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            confidence = det["confidence"]

            # Draw rectangle
            cv2.rectangle(output_frame, (x1, y1), (x2, y2), color, thickness)

            # Draw label
            if show_confidence:
                label = f"License {confidence:.2f}"
            else:
                label = "License Plate"

            # Get label size for background
            (label_w, label_h), baseline = cv2.getTextSize(
                label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2
            )

            # Draw label background
            cv2.rectangle(
                output_frame,
                (x1, y1 - label_h - 10),
                (x1 + label_w, y1),
                color,
                -1
            )

            # Draw label text
            cv2.putText(
                output_frame,
                label,
                (x1, y1 - 5),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2
            )

        return output_frame

    def detect_and_draw(
        self,
        frame: np.ndarray,
        conf_threshold: float = 0.25,
        iou_threshold: float = 0.45,
        color: Tuple[int, int, int] = (0, 255, 0),
        thickness: int = 2
    ) -> Tuple[List[dict], np.ndarray]:
        """
        Detect and draw in one call

        Args:
            frame: Input image
            conf_threshold: Confidence threshold
            iou_threshold: IOU threshold
            color: BGR color
            thickness: Line thickness

        Returns:
            Tuple of (detections, frame_with_boxes)
        """
        detections = self.detect_from_frame(frame, conf_threshold, iou_threshold)
        output_frame = self.draw_detections(frame, detections, color, thickness)
        return detections, output_frame


# Global detector instance (singleton)
_detector_instance: Optional[ONNXLicensePlateDetector] = None


def get_onnx_detector() -> ONNXLicensePlateDetector:
    """Get or create the global ONNX detector instance"""
    global _detector_instance
    if _detector_instance is None:
        _detector_instance = ONNXLicensePlateDetector()
    return _detector_instance
