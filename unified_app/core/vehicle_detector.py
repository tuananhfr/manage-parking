"""
Vehicle Detector - Detect cars/motorcycles using YOLOv8n ONNX
Stage 1 of 2-stage detection pipeline
"""
import cv2
import numpy as np
from pathlib import Path
from typing import List, Tuple
import onnxruntime as ort
import logging


class VehicleDetector:
    """
    YOLOv8n vehicle detector (ONNX)
    Detects: car (class 2), motorcycle (class 3), bus (class 5), truck (class 7)
    """

    # COCO class IDs for vehicles
    VEHICLE_CLASSES = {
        2: "car",
        3: "motorcycle",
        5: "bus",
        7: "truck"
    }

    def __init__(self, model_path: str = "models/yolov8n.onnx"):
        """
        Initialize vehicle detector

        Args:
            model_path: Path to YOLOv8n ONNX model
        """
        self.model_path = Path(model_path)
        if not self.model_path.exists():
            raise FileNotFoundError(f"YOLOv8n model not found: {model_path}")

        logging.info(f"[VEHICLE] Loading YOLOv8n from {model_path}")

        # Create ONNX Runtime session
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        sess_options.intra_op_num_threads = 4
        sess_options.inter_op_num_threads = 2

        self.session = ort.InferenceSession(
            str(self.model_path),
            sess_options=sess_options,
            providers=['CPUExecutionProvider']
        )

        # Get model info
        self.input_name = self.session.get_inputs()[0].name
        self.input_shape = self.session.get_inputs()[0].shape
        self.output_names = [output.name for output in self.session.get_outputs()]

        self.imgsz = self.input_shape[2] if len(self.input_shape) == 4 else 640

        logging.info(f"[VEHICLE] YOLOv8n loaded (input size: {self.imgsz})")

    def preprocess(self, frame: np.ndarray) -> Tuple[np.ndarray, float, Tuple[int, int]]:
        """Preprocess frame for YOLOv8"""
        original_h, original_w = frame.shape[:2]

        # Resize with letterbox
        scale = min(self.imgsz / original_w, self.imgsz / original_h)
        new_w = int(original_w * scale)
        new_h = int(original_h * scale)

        resized = cv2.resize(frame, (new_w, new_h))

        # Padding
        pad_w = (self.imgsz - new_w) // 2
        pad_h = (self.imgsz - new_h) // 2

        padded = cv2.copyMakeBorder(
            resized, pad_h, self.imgsz - new_h - pad_h,
            pad_w, self.imgsz - new_w - pad_w,
            cv2.BORDER_CONSTANT, value=(114, 114, 114)
        )

        # BGR to RGB
        image = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB)

        # Normalize and HWC -> CHW
        image = image.astype(np.float32) / 255.0
        image = np.transpose(image, (2, 0, 1))
        image = np.expand_dims(image, axis=0)

        return image, scale, (pad_w, pad_h)

    def postprocess(
        self,
        outputs: List[np.ndarray],
        scale: float,
        pad_w: int,
        pad_h: int,
        conf_threshold: float = 0.5
    ) -> List[Tuple[int, int, int, int, float, int]]:
        """
        Postprocess YOLOv8 outputs

        Returns:
            List of (x1, y1, x2, y2, conf, class_id)
        """
        output = outputs[0]  # Shape: (1, 84, 8400) hoặc tương tự

        # YOLOv8 output format: [batch, 4+num_classes, num_boxes]
        # Transpose to [num_boxes, 4+num_classes]
        if len(output.shape) == 3:
            output = output[0].T  # (8400, 84)

        # Extract boxes and scores
        boxes = output[:, :4]  # (num_boxes, 4) - xywh format
        scores = output[:, 4:]  # (num_boxes, 80) - class scores

        # Get class with max score
        class_ids = np.argmax(scores, axis=1)
        confidences = np.max(scores, axis=1)

        # Filter by confidence and vehicle classes
        valid_mask = confidences > conf_threshold
        valid_classes = np.isin(class_ids, list(self.VEHICLE_CLASSES.keys()))
        mask = valid_mask & valid_classes

        if not np.any(mask):
            return []

        boxes = boxes[mask]
        confidences = confidences[mask]
        class_ids = class_ids[mask]

        # Convert xywh to xyxy
        x_center, y_center, w, h = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        x1 = x_center - w / 2
        y1 = y_center - h / 2
        x2 = x_center + w / 2
        y2 = y_center + h / 2

        # Rescale to original image coordinates
        x1 = (x1 - pad_w) / scale
        y1 = (y1 - pad_h) / scale
        x2 = (x2 - pad_w) / scale
        y2 = (y2 - pad_h) / scale

        # NMS
        indices = cv2.dnn.NMSBoxes(
            boxes.tolist(),
            confidences.tolist(),
            conf_threshold,
            0.45  # IoU threshold
        )

        results = []
        if len(indices) > 0:
            for i in indices.flatten():
                results.append((
                    int(x1[i]),
                    int(y1[i]),
                    int(x2[i]),
                    int(y2[i]),
                    float(confidences[i]),
                    int(class_ids[i])
                ))

        return results

    def detect_vehicles(
        self,
        frame: np.ndarray,
        conf_threshold: float = 0.5
    ) -> List[Tuple[int, int, int, int, float, int]]:
        """
        Detect vehicles in frame

        Args:
            frame: Input image (BGR)
            conf_threshold: Confidence threshold

        Returns:
            List of (x1, y1, x2, y2, confidence, class_id)
        """
        try:
            # Preprocess
            input_tensor, scale, (pad_w, pad_h) = self.preprocess(frame)

            # Inference
            outputs = self.session.run(self.output_names, {self.input_name: input_tensor})

            # Postprocess
            boxes = self.postprocess(outputs, scale, pad_w, pad_h, conf_threshold)

            return boxes

        except Exception as e:
            logging.error(f"[VEHICLE] Detection error: {e}")
            return []

    def get_vehicle_class_name(self, class_id: int) -> str:
        """Get vehicle class name"""
        return self.VEHICLE_CLASSES.get(class_id, "unknown")
