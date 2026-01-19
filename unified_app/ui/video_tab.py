"""
Video Processing Tab - Upload MP4 and view detection results
"""
import os
import requests
import numpy as np
import cv2
from io import BytesIO
from PyQt6 import QtCore, QtWidgets, QtGui
from typing import Optional


class VideoPreviewWidget(QtWidgets.QLabel):
    """Widget to display video preview with MJPEG stream"""

    def __init__(self, api_base: str, parent=None):
        super().__init__(parent)
        self.api_base = api_base
        self.video_id: Optional[str] = None
        self.running = False

        # Set up label
        self.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        self.setStyleSheet("background-color: #000; border: 2px solid #555;")
        self.setMinimumSize(640, 480)
        self.setText("No video loaded")

        # Worker thread for streaming
        self.stream_thread: Optional[QtCore.QThread] = None
        self.stream_worker: Optional[StreamWorker] = None

    def start_preview(self, video_id: str):
        """Start video preview stream"""
        self.video_id = video_id
        self.running = True

        # Create worker thread
        self.stream_worker = StreamWorker(self.api_base, video_id)
        self.stream_thread = QtCore.QThread()
        self.stream_worker.moveToThread(self.stream_thread)

        # Connect signals
        self.stream_worker.frame_ready.connect(self.update_frame)
        self.stream_thread.started.connect(self.stream_worker.run)

        # Start thread
        self.stream_thread.start()

    def stop_preview(self):
        """Stop video preview stream"""
        self.running = False
        if self.stream_worker:
            self.stream_worker.stop()
        if self.stream_thread:
            self.stream_thread.quit()
            self.stream_thread.wait()
        self.setText("Preview stopped")

    def update_frame(self, frame_data: bytes):
        """Update frame from stream"""
        try:
            # Decode image
            nparr = np.frombuffer(frame_data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                print(f"[VideoPreview] Failed to decode image (size: {len(frame_data)} bytes)")
                return

            # Convert BGR to RGB
            img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

            # Convert to QImage
            h, w, ch = img_rgb.shape
            bytes_per_line = ch * w
            qt_image = QtGui.QImage(img_rgb.data, w, h, bytes_per_line, QtGui.QImage.Format.Format_RGB888)

            # Scale to fit widget
            pixmap = QtGui.QPixmap.fromImage(qt_image)
            scaled_pixmap = pixmap.scaled(
                self.size(),
                QtCore.Qt.AspectRatioMode.KeepAspectRatio,
                QtCore.Qt.TransformationMode.SmoothTransformation
            )
            self.setPixmap(scaled_pixmap)

        except Exception as e:
            print(f"[VideoPreview] Error updating frame: {e}")
            import traceback
            traceback.print_exc()


class StreamWorker(QtCore.QObject):
    """Worker to handle MJPEG streaming in background thread"""

    frame_ready = QtCore.pyqtSignal(bytes)

    def __init__(self, api_base: str, video_id: str):
        super().__init__()
        self.api_base = api_base
        self.video_id = video_id
        self.running = False

    def run(self):
        """Run streaming loop"""
        self.running = True
        url = f"{self.api_base}/preview/{self.video_id}"

        print(f"[StreamWorker] Starting stream from: {url}")

        try:
            response = requests.get(url, stream=True, timeout=30)
            print(f"[StreamWorker] Response status: {response.status_code}")

            if response.status_code != 200:
                print(f"[StreamWorker] Stream error: {response.status_code}")
                return

            # Parse MJPEG stream
            bytes_data = b''
            frame_count = 0

            for chunk in response.iter_content(chunk_size=4096):  # Larger chunks
                if not self.running:
                    print(f"[StreamWorker] Stopped by user")
                    break

                bytes_data += chunk

                # Find JPEG boundaries
                a = bytes_data.find(b'\xff\xd8')  # JPEG start
                b = bytes_data.find(b'\xff\xd9')  # JPEG end

                if a != -1 and b != -1:
                    jpg = bytes_data[a:b+2]
                    bytes_data = bytes_data[b+2:]

                    # Emit frame
                    frame_count += 1
                    if frame_count % 30 == 0:  # Log every 30 frames
                        print(f"[StreamWorker] Streamed {frame_count} frames")
                    self.frame_ready.emit(jpg)

            print(f"[StreamWorker] Stream ended. Total frames: {frame_count}")

        except Exception as e:
            print(f"[StreamWorker] Error: {e}")
            import traceback
            traceback.print_exc()

    def stop(self):
        """Stop streaming"""
        self.running = False


class VideoProcessingTab(QtWidgets.QWidget):
    """Tab để upload video MP4 và xem kết quả nhận diện"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.api_base = "http://localhost:5000/api/video"
        self.current_video_id: Optional[str] = None
        self.init_ui()

        # Timer để update progress
        self.update_timer = QtCore.QTimer(self)
        self.update_timer.timeout.connect(self.update_progress)

    def init_ui(self):
        """Initialize UI components"""
        main_layout = QtWidgets.QHBoxLayout(self)
        main_layout.setContentsMargins(10, 10, 10, 10)
        main_layout.setSpacing(10)

        # Left side - Video preview
        left_layout = QtWidgets.QVBoxLayout()
        left_layout.setSpacing(10)

        preview_label = QtWidgets.QLabel("📹 Video Preview (với bounding boxes)")
        preview_label.setStyleSheet("font-size: 16px; font-weight: bold; color: #fff;")
        left_layout.addWidget(preview_label)

        self.video_preview = VideoPreviewWidget(self.api_base)
        left_layout.addWidget(self.video_preview, 1)

        main_layout.addLayout(left_layout, 2)  # 2/3 width for preview

        # Right side - Controls and results
        right_layout = QtWidgets.QVBoxLayout()
        right_layout.setSpacing(15)

        # Title
        title = QtWidgets.QLabel("🎬 Video Processing")
        title.setStyleSheet("font-size: 18px; font-weight: bold; color: #fff;")
        right_layout.addWidget(title)

        # Upload section
        upload_group = QtWidgets.QGroupBox("Upload Video")
        upload_group.setStyleSheet("""
            QGroupBox {
                background-color: #2a2a2a;
                border: 1px solid #555;
                border-radius: 5px;
                margin-top: 10px;
                padding: 15px;
                color: #fff;
                font-size: 13px;
                font-weight: bold;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 5px;
            }
        """)
        upload_layout = QtWidgets.QVBoxLayout(upload_group)

        file_row = QtWidgets.QHBoxLayout()
        self.file_label = QtWidgets.QLabel("No file selected")
        self.file_label.setStyleSheet("color: #aaa; padding: 5px; font-weight: normal;")
        file_row.addWidget(self.file_label)

        browse_btn = QtWidgets.QPushButton("Browse...")
        browse_btn.setFixedWidth(100)
        browse_btn.setStyleSheet("""
            QPushButton {
                background-color: #3a3a3a;
                color: #fff;
                border: 1px solid #555;
                border-radius: 5px;
                padding: 6px 12px;
                font-size: 12px;
            }
            QPushButton:hover { background-color: #4a4a4a; }
        """)
        browse_btn.clicked.connect(self.browse_file)
        file_row.addWidget(browse_btn)
        upload_layout.addLayout(file_row)

        self.upload_btn = QtWidgets.QPushButton("▶ Upload & Process")
        self.upload_btn.setEnabled(False)
        self.upload_btn.setStyleSheet("""
            QPushButton {
                background-color: #0066cc;
                color: #fff;
                border: none;
                border-radius: 5px;
                padding: 10px;
                font-size: 13px;
                font-weight: bold;
            }
            QPushButton:hover { background-color: #0077dd; }
            QPushButton:disabled { background-color: #3a3a3a; color: #666; }
        """)
        self.upload_btn.clicked.connect(self.upload_video)
        upload_layout.addWidget(self.upload_btn)

        right_layout.addWidget(upload_group)

        # Progress section
        progress_group = QtWidgets.QGroupBox("Processing Progress")
        progress_group.setStyleSheet("""
            QGroupBox {
                background-color: #2a2a2a;
                border: 1px solid #555;
                border-radius: 5px;
                margin-top: 10px;
                padding: 15px;
                color: #fff;
                font-size: 13px;
                font-weight: bold;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 5px;
            }
        """)
        progress_layout = QtWidgets.QVBoxLayout(progress_group)

        self.progress_bar = QtWidgets.QProgressBar()
        self.progress_bar.setStyleSheet("""
            QProgressBar {
                border: 1px solid #555;
                border-radius: 5px;
                text-align: center;
                background-color: #1a1a1a;
                color: #fff;
                height: 22px;
            }
            QProgressBar::chunk {
                background-color: #0066cc;
                border-radius: 5px;
            }
        """)
        progress_layout.addWidget(self.progress_bar)

        self.stats_label = QtWidgets.QLabel("Status: Ready")
        self.stats_label.setStyleSheet("color: #aaa; font-size: 11px; font-weight: normal;")
        progress_layout.addWidget(self.stats_label)

        self.stop_btn = QtWidgets.QPushButton("⏹ Stop")
        self.stop_btn.setEnabled(False)
        self.stop_btn.setStyleSheet("""
            QPushButton {
                background-color: #cc3333;
                color: #fff;
                border: none;
                border-radius: 5px;
                padding: 6px;
                font-size: 12px;
            }
            QPushButton:hover { background-color: #dd4444; }
            QPushButton:disabled { background-color: #3a3a3a; color: #666; }
        """)
        self.stop_btn.clicked.connect(self.stop_processing)
        progress_layout.addWidget(self.stop_btn)

        right_layout.addWidget(progress_group)

        # Results section
        results_group = QtWidgets.QGroupBox("Detected Plates")
        results_group.setStyleSheet("""
            QGroupBox {
                background-color: #2a2a2a;
                border: 1px solid #555;
                border-radius: 5px;
                margin-top: 10px;
                padding: 15px;
                color: #fff;
                font-size: 13px;
                font-weight: bold;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                left: 10px;
                padding: 0 5px;
            }
        """)
        results_layout = QtWidgets.QVBoxLayout(results_group)

        self.results_table = QtWidgets.QTableWidget()
        self.results_table.setColumnCount(3)
        self.results_table.setHorizontalHeaderLabels(["Plate", "Conf", "Votes"])
        self.results_table.horizontalHeader().setStretchLastSection(True)
        self.results_table.setStyleSheet("""
            QTableWidget {
                background-color: #1a1a1a;
                color: #fff;
                border: 1px solid #555;
                gridline-color: #333;
                font-size: 11px;
            }
            QTableWidget::item { padding: 4px; }
            QHeaderView::section {
                background-color: #333;
                color: #fff;
                padding: 5px;
                border: 1px solid #555;
                font-weight: bold;
                font-size: 11px;
            }
        """)
        results_layout.addWidget(self.results_table)

        right_layout.addWidget(results_group, 1)

        main_layout.addLayout(right_layout, 1)  # 1/3 width for controls

        self.selected_file = None

    def browse_file(self):
        """Open file dialog to select video file"""
        file_path, _ = QtWidgets.QFileDialog.getOpenFileName(
            self,
            "Select Video File",
            "",
            "Video Files (*.mp4 *.avi *.mov *.mkv);;All Files (*.*)"
        )

        if file_path:
            self.selected_file = file_path
            filename = os.path.basename(file_path)
            self.file_label.setText(f"📁 {filename}")
            self.file_label.setStyleSheet("color: #fff; padding: 5px; font-weight: normal;")
            self.upload_btn.setEnabled(True)

    def upload_video(self):
        """Upload video and start processing"""
        if not self.selected_file:
            return

        try:
            print(f"[VideoTab] Uploading: {self.selected_file}")

            # Stop previous preview if any
            self.video_preview.stop_preview()

            # Upload file
            self.upload_btn.setEnabled(False)
            self.stats_label.setText("Status: Uploading...")
            QtWidgets.QApplication.processEvents()

            with open(self.selected_file, 'rb') as f:
                files = {'file': (os.path.basename(self.selected_file), f, 'video/mp4')}
                print(f"[VideoTab] Sending POST request...")
                response = requests.post(f"{self.api_base}/upload", files=files, timeout=60)

            print(f"[VideoTab] Upload response: {response.status_code}")

            if response.status_code == 200:
                result = response.json()
                self.current_video_id = result.get('video_id')
                print(f"[VideoTab] Video ID: {self.current_video_id}")
                self.stats_label.setText(f"Status: Processing ({self.current_video_id})")
                self.stop_btn.setEnabled(True)

                # Wait a bit for video to start processing
                import time
                time.sleep(0.5)

                # Start video preview
                print(f"[VideoTab] Starting preview...")
                self.video_preview.start_preview(self.current_video_id)

                # Start update timer
                self.update_timer.start(1000)

                # Clear results table
                self.results_table.setRowCount(0)
            else:
                self.stats_label.setText(f"Status: Upload failed - {response.text}")
                self.upload_btn.setEnabled(True)

        except Exception as e:
            print(f"[VideoTab] Upload error: {e}")
            import traceback
            traceback.print_exc()
            self.stats_label.setText(f"Status: Error - {str(e)}")
            self.upload_btn.setEnabled(True)

    def update_progress(self):
        """Update processing progress"""
        if not self.current_video_id:
            return

        try:
            response = requests.get(f"{self.api_base}/stats/{self.current_video_id}", timeout=5)
            if response.status_code == 200:
                data = response.json()
                stats = data.get('stats', {})
                is_completed = data.get('is_completed', False)

                # Update progress bar
                progress = stats.get('progress', 0)
                self.progress_bar.setValue(int(progress))

                # Update stats label
                fps = stats.get('fps', 0)
                plates_count = stats.get('detected_plates_count', 0)
                current_frame = stats.get('current_frame', 0)
                total_frames = stats.get('total_frames', 0)

                status_text = f"FPS: {fps:.1f} | Plates: {plates_count} | Frame: {current_frame}/{total_frames}"
                self.stats_label.setText(status_text)

                # Load results periodically
                self.load_results()

                # If completed, stop timer
                if is_completed:
                    self.update_timer.stop()
                    self.stats_label.setText(f"✅ Completed | Total plates: {plates_count}")
                    self.stop_btn.setEnabled(False)
                    self.upload_btn.setEnabled(True)
                    self.video_preview.stop_preview()

        except Exception as e:
            print(f"Error updating progress: {e}")

    def load_results(self):
        """Load and display detection results"""
        if not self.current_video_id:
            return

        try:
            response = requests.get(f"{self.api_base}/results/{self.current_video_id}", timeout=5)
            if response.status_code == 200:
                data = response.json()
                plates = data.get('detected_plates', [])

                # Clear table
                self.results_table.setRowCount(0)

                # Add results to table
                for plate_data in plates:
                    row = self.results_table.rowCount()
                    self.results_table.insertRow(row)

                    # Plate number
                    plate_item = QtWidgets.QTableWidgetItem(plate_data.get('plate', ''))
                    plate_item.setFont(QtGui.QFont("Arial", 11, QtGui.QFont.Weight.Bold))
                    self.results_table.setItem(row, 0, plate_item)

                    # Confidence
                    conf = plate_data.get('confidence', 0)
                    conf_item = QtWidgets.QTableWidgetItem(f"{conf:.0%}")
                    self.results_table.setItem(row, 1, conf_item)

                    # Votes
                    votes = plate_data.get('votes', 0)
                    votes_item = QtWidgets.QTableWidgetItem(str(votes))
                    self.results_table.setItem(row, 2, votes_item)

                # Resize columns
                self.results_table.resizeColumnsToContents()

        except Exception as e:
            print(f"Error loading results: {e}")

    def stop_processing(self):
        """Stop video processing"""
        if not self.current_video_id:
            return

        try:
            response = requests.post(f"{self.api_base}/stop/{self.current_video_id}", timeout=5)
            if response.status_code == 200:
                self.update_timer.stop()
                self.stats_label.setText("Status: Stopped by user")
                self.stop_btn.setEnabled(False)
                self.upload_btn.setEnabled(True)
                self.video_preview.stop_preview()
                self.load_results()

        except Exception as e:
            self.stats_label.setText(f"Status: Error stopping - {str(e)}")
