"""
UI Main Window - MainWindow and FFmpegWarningFilter
"""
import logging
from typing import Dict, Optional, List

from PyQt6 import QtCore, QtWidgets

from .widgets import VideoWidget
from .dialogs import CameraSettingsDialog, OCRLogDialog
from core.camera_manager import camera_manager


class MainWindow(QtWidgets.QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Unified Camera App")
        self.resize(1400, 800)
        self.setStyleSheet("background-color: #1a1a1a;")

        # Top bar với icon settings và nút xem log
        top_bar = QtWidgets.QHBoxLayout()
        top_bar.setContentsMargins(10, 5, 10, 5)

        # Nút xem log OCR
        self.logs_btn = QtWidgets.QPushButton("📄")
        self.logs_btn.setFixedSize(40, 40)
        self.logs_btn.setStyleSheet(
            "background-color: #3a3a3a; color: #fff; border: 1px solid #555; border-radius: 5px; font-size: 18px;"
        )
        self.logs_btn.setToolTip("Xem lịch sử OCR")
        self.logs_btn.clicked.connect(self.show_logs)

        # Nút settings
        self.settings_btn = QtWidgets.QPushButton("⚙️")
        self.settings_btn.setFixedSize(40, 40)
        self.settings_btn.setStyleSheet(
            "background-color: #3a3a3a; color: #fff; border: 1px solid #555; border-radius: 5px; font-size: 20px;"
        )
        self.settings_btn.setToolTip("Camera Settings")
        self.settings_btn.clicked.connect(self.show_settings)

        top_bar.addStretch()  # Đẩy icon sang phải
        top_bar.addWidget(self.logs_btn)
        top_bar.addWidget(self.settings_btn)

        # Video layout: luôn 3 cột cố định, mỗi camera/video chiếm 1/3 màn hình
        # (Gộp cả RTSP cameras và video files vào cùng 1 grid)
        self.video_container = QtWidgets.QWidget()
        # Grid layout: 2 hàng x 3 cột = 6 camera
        self.video_layout = QtWidgets.QGridLayout(self.video_container)
        self.video_layout.setSpacing(10)
        self.video_layout.setContentsMargins(5, 5, 5, 5)

        # Dictionary để lưu video widgets theo camera_id/video_id
        self.video_widgets: Dict[str, VideoWidget] = {}

        # Tạo 6 slots cố định (2 hàng x 3 cột)
        self.video_slots: List[Optional[VideoWidget]] = [None] * 6

        # Main layout
        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        layout.addLayout(top_bar, 0)  # Top bar
        layout.addWidget(self.video_container, 1)  # Video grid

        self.timer = QtCore.QTimer(self)
        self.timer.timeout.connect(self.refresh_frames)
        self.timer.start(200)  # 5 fps - đủ mượt cho main stream (raw) với detection

        # Connect event để tự động refresh UI khi có camera mới (real-time)
        from core.events import get_event_emitter
        event_emitter = get_event_emitter()
        event_emitter.camera_list_changed.connect(self.refresh_video_grid)

        self.refresh_video_grid()
    
    def show_settings(self):
        """Hiển thị popup settings"""
        dialog = CameraSettingsDialog(self)
        dialog.exec()
        # Không cần refresh_video_grid() vì camera_list_changed signal đã tự động refresh

    def show_logs(self):
        """Hiển thị popup log OCR"""
        dialog = OCRLogDialog(self)
        dialog.exec()
    
    def refresh_video_grid(self):
        """Refresh video grid - 2 hàng x 3 cột = 6 camera"""
        try:
            logging.info("[MainWindow] refresh_video_grid() called - received camera_list_changed signal")
            sources = camera_manager.list_cameras()  # Includes both cameras and videos
            logging.info(f"[MainWindow] Found {len(sources)} cameras: {[s.id for s in sources]}")
            max_sources = min(6, len(sources))  # Tối đa 6 camera

            # Xóa tất cả widgets cũ (nhưng không delete ngay để tránh block)
            widgets_to_delete = []
            while self.video_layout.count():
                item = self.video_layout.takeAt(0)
                if item and item.widget():
                    widget = item.widget()
                    widget.setParent(None)
                    widgets_to_delete.append(widget)

            # Đảm bảo layout có spacing và margins đúng
            self.video_layout.setSpacing(5)
            self.video_layout.setContentsMargins(5, 5, 5, 5)

            # Set row/column stretch để chia đều không gian
            for row in range(2):
                self.video_layout.setRowStretch(row, 1)
            for col in range(3):
                self.video_layout.setColumnStretch(col, 1)

            # Xóa khỏi dict
            self.video_widgets.clear()
            self.video_slots = [None] * 6

            # Tạo widgets mới - Grid layout 2x3
            for idx in range(6):
                row = idx // 3  # Hàng: 0 hoặc 1
                col = idx % 3   # Cột: 0, 1, 2

                if idx < max_sources:
                    source = sources[idx]
                    # Display name with icon based on type
                    if source.type == "video":
                        display_name = f"🎬 {source.name}"
                    else:
                        display_name = f"📹 {source.name}"

                    video_widget = VideoWidget(
                        camera_id=source.id,
                        camera_name=display_name,
                        camera_type=source.camera_type,
                        camera_url=source.url,
                        parent=self.video_container
                    )
                    self.video_widgets[source.id] = video_widget
                    self.video_slots[idx] = video_widget
                    self.video_layout.addWidget(video_widget, row, col)
                else:
                    # Placeholder - phải có size policy giống VideoWidget
                    placeholder = QtWidgets.QLabel("No Source")
                    placeholder.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
                    placeholder.setStyleSheet("background-color: #222; color: #888; border: 1px solid #555; font-size: 16px;")
                    # Size policy: Expanding để layout chia đều
                    placeholder_size_policy = QtWidgets.QSizePolicy(
                        QtWidgets.QSizePolicy.Policy.Expanding,
                        QtWidgets.QSizePolicy.Policy.Expanding
                    )
                    placeholder.setSizePolicy(placeholder_size_policy)
                    self.video_slots[idx] = None
                    self.video_layout.addWidget(placeholder, row, col)

            # Force update layout
            self.video_container.update()
            self.update()

            # Delete widgets cũ sau khi đã tạo mới (tránh block UI)
            def _delete_old_widgets():
                for widget in widgets_to_delete:
                    try:
                        widget.deleteLater()
                    except:
                        pass

            QtCore.QTimer.singleShot(100, _delete_old_widgets)

        except Exception as e:
            logging.error(f"Error refreshing video grid: {e}")
            import traceback
            traceback.print_exc()

    def refresh_frames(self):
        # Cập nhật tất cả video widget đang hiển thị
        for video_widget in self.video_widgets.values():
            video_widget.update_frame()


class FFmpegWarningFilter:
    """Filter để ẩn FFmpeg H.264 decode warnings (không ảnh hưởng chức năng)"""
    def __init__(self, original_stderr):
        self.original_stderr = original_stderr
        self.ffmpeg_warning_keywords = [
            "error while decoding MB",
            "cabac decode",
            "left block unavailable",
            "error while decoding",
            "[h264 @",
        ]
    
    def write(self, message):
        # Chỉ filter các FFmpeg H.264 warnings, giữ lại các lỗi khác
        if any(keyword in message for keyword in self.ffmpeg_warning_keywords):
            return  # Bỏ qua FFmpeg decode warnings
        self.original_stderr.write(message)
    
    def flush(self):
        self.original_stderr.flush()

