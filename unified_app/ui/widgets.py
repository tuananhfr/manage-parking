"""
UI Widgets - VideoWidget
"""
from datetime import datetime
from typing import Optional
import logging

import cv2
import numpy as np
from PyQt6 import QtCore, QtGui, QtWidgets

from core.camera_manager import camera_manager
from core.db import insert_ocr_log
from core.ocr_sender import send_ocr_to_central
from core.camera_worker import is_valid_vietnamese_plate
from core.events import get_event_emitter


class VideoWidget(QtWidgets.QWidget):
    def __init__(self, camera_id: str, camera_name: str, camera_type: str = "entrance", camera_url: str = "", parent=None):
        super().__init__(parent)
        self.camera_id = camera_id
        self.camera_name = camera_name
        self.camera_type = camera_type
        self.camera_url = camera_url

        # Size policy: Expanding để layout chia đều
        size_policy = QtWidgets.QSizePolicy(
            QtWidgets.QSizePolicy.Policy.Expanding,
            QtWidgets.QSizePolicy.Policy.Expanding
        )
        self.setSizePolicy(size_policy)

        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(2, 2, 2, 2)
        layout.setSpacing(5)

        # Header: Camera name + type + URL
        header_widget = QtWidgets.QWidget()
        header_layout = QtWidgets.QVBoxLayout(header_widget)
        header_layout.setContentsMargins(4, 2, 4, 2)
        header_layout.setSpacing(2)

        # Tên camera
        self.name_label = QtWidgets.QLabel(camera_name)
        self.name_label.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        self.name_label.setStyleSheet("color: white; font-weight: bold; font-size: 13px;")
        header_layout.addWidget(self.name_label)

        # Camera type + URL/IP
        camera_type_vn = {"entrance": "Vào", "exit": "Ra", "internal": "Trong bãi"}.get(camera_type, camera_type)

        if camera_url.startswith("rtsp://"):
            # RTSP camera: Extract IP from URL
            import re
            match = re.search(r'@([\d\.]+):', camera_url)
            ip_address = match.group(1) if match else camera_url.split("@")[-1].split(":")[0]
            info_text = f"Cổng: {camera_type_vn} | IP: {ip_address}"
        else:
            # Video file: Only show camera type (no IP)
            info_text = f"Cổng: {camera_type_vn}"

        self.info_label = QtWidgets.QLabel(info_text)
        self.info_label.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        self.info_label.setStyleSheet("color: #aaa; font-size: 10px;")
        header_layout.addWidget(self.info_label)

        header_widget.setStyleSheet("background-color: #333;")
        header_widget.setFixedHeight(50)
        layout.addWidget(header_widget)
        
        # Video display - giữ tỷ lệ 16:9
        self.video_label = QtWidgets.QLabel()
        self.video_label.setScaledContents(False)  # Không tự scale để giữ tỷ lệ
        self.video_label.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        self.video_label.setStyleSheet("background-color: #000; border: 1px solid #555;")
        # Size policy: mở rộng theo cả width và height
        size_policy = QtWidgets.QSizePolicy(
            QtWidgets.QSizePolicy.Policy.Expanding,
            QtWidgets.QSizePolicy.Policy.Expanding
        )
        self.video_label.setSizePolicy(size_policy)
        layout.addWidget(self.video_label, 1)  # Cho phép video label mở rộng
        
        # Phần thông tin phía dưới: Chỉ còn OCR text
        self.info_area = QtWidgets.QWidget()
        info_layout = QtWidgets.QVBoxLayout(self.info_area)
        info_layout.setContentsMargins(5, 5, 5, 5)
        info_layout.setSpacing(0)

        # Input text OCR (có thể tự điền hoặc tự động nhận diện)
        self.ocr_text_input = QtWidgets.QLineEdit()
        self.ocr_text_input.setPlaceholderText("Nhập biển số và Enter hoặc chờ tự động nhận diện...")
        self.ocr_text_input.setStyleSheet(
            "background-color: #2a2a2a; color: #fff; border: 1px solid #555; padding: 5px; font-size: 12px;"
        )
        # Connect Enter key handler for manual entry
        self.ocr_text_input.returnPressed.connect(self._on_manual_plate_entry)
        info_layout.addWidget(self.ocr_text_input)

        self.info_area.setMinimumHeight(45)
        self.info_area.setStyleSheet("background-color: #1a1a1a; border: 1px solid #555;")
        layout.addWidget(self.info_area, 0)  # Không mở rộng, giữ kích thước cố định

        # Connect event for real-time OCR updates
        event_emitter = get_event_emitter()
        event_emitter.ocr_log_added.connect(self.on_ocr_log_added)

    def on_ocr_log_added(self, camera_id: str, plate_text: str, timestamp: str):
        """Handle new OCR log event"""
        if camera_id == self.camera_id:
            logger = logging.getLogger("VideoWidget") # Assuming logging is configured or just use print for now if simple
            # Better to just reuse the update method
            self.update_detection_info(ocr_text=plate_text)

    def update_frame(self):
        """
        Update frame từ main stream (raw) - dùng cho app detection và OCR
        """
        # Dùng main stream (raw) cho app - có overlay và detection
        frame, detections = camera_manager.get_frame(self.camera_id)
        
        if frame is None:
            self.video_label.setText("No video")
            return
        
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        h, w, ch = rgb.shape
        bytes_per_line = ch * w
        qimg = QtGui.QImage(rgb.data, w, h, bytes_per_line, QtGui.QImage.Format.Format_RGB888)
        pix = QtGui.QPixmap.fromImage(qimg)

        # Scale dựa vào parent widget size để tránh resize loop
        parent_width = self.width()
        parent_height = self.height()

        if parent_width > 100 and parent_height > 100:
            # Trừ đi header (50px) và info_area (45px) và margins
            available_height = parent_height - 50 - 45 - 20
            available_width = parent_width - 10

            scaled_pix = pix.scaled(
                available_width,
                available_height,
                QtCore.Qt.AspectRatioMode.KeepAspectRatio,
                QtCore.Qt.TransformationMode.FastTransformation  # FastTransformation cho video stream
            )
            self.video_label.setPixmap(scaled_pix)
        else:
            # Fallback for initial rendering
            self.video_label.setPixmap(pix)
        
        # REMOVED: Polling OCR text update to avoid overwriting user input
        # Validation: OCR text is now updated via on_ocr_log_added event

    def update_detection_info(self, ocr_text: str = ""):
        """
        Cập nhật thông tin detection

        Args:
            ocr_text: Text OCR đã nhận diện
        """
        # Cập nhật OCR text
        if ocr_text:
            self.ocr_text_input.setText(ocr_text)
        else:
            self.ocr_text_input.clear()

    def _on_manual_plate_entry(self):
        """
        Handler khi user nhập biển số và nhấn Enter.
        Validate, lưu DB, gửi Central, và hiển thị thông báo.
        """
        plate_text = self.ocr_text_input.text().strip()

        # Validate format biển số Việt Nam
        if not plate_text:
            self._show_notification("Vui lòng nhập biển số", error=True)
            return

        if not is_valid_vietnamese_plate(plate_text):
            self._show_notification(f"Biển số không hợp lệ: {plate_text}", error=True)
            return

        # Tạo timestamp hiện tại
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        try:
            # Lưu vào local DB
            insert_ocr_log(self.camera_id, plate_text, timestamp, self.camera_type)

            # Gửi lên Central server
            send_ocr_to_central(self.camera_id, self.camera_name, plate_text, self.camera_type, timestamp)

            # Hiển thị thông báo thành công
            self._show_notification(f"✓ Đã lưu: {plate_text}", error=False)

            # Clear input sau 1s để user thấy kết quả
            QtCore.QTimer.singleShot(1000, self.ocr_text_input.clear)

        except Exception as e:
            self._show_notification(f"Lỗi: {str(e)}", error=True)

    def _show_notification(self, message: str, error: bool = False):
        """
        Hiển thị thông báo tạm thời bằng cách thay đổi màu border của input.

        Args:
            message: Thông báo để hiển thị
            error: True nếu là lỗi (màu đỏ), False nếu thành công (màu xanh)
        """
        # Thay đổi màu border để báo hiệu thành công/lỗi
        if error:
            border_color = "#ff0000"  # Red
            text_color = "#ff6666"
        else:
            border_color = "#00ff00"  # Green
            text_color = "#00ff00"

        # Áp dụng style mới
        self.ocr_text_input.setStyleSheet(
            f"background-color: #2a2a2a; color: {text_color}; border: 2px solid {border_color}; padding: 5px; font-size: 12px;"
        )

        # Reset về style mặc định sau 2s
        QtCore.QTimer.singleShot(2000, self._reset_input_style)

    def _reset_input_style(self):
        """Reset OCR input style về mặc định."""
        self.ocr_text_input.setStyleSheet(
            "background-color: #2a2a2a; color: #fff; border: 1px solid #555; padding: 5px; font-size: 12px;"
        )

