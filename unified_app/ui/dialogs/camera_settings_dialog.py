"""
CameraSettingsDialog - Manage cameras and server configuration
"""
import socket
import logging
from PyQt6 import QtCore, QtWidgets

from core.config import load_config, save_config
from core.camera_manager import camera_manager
from core.db import get_ocr_logs, delete_ocr_log, delete_all_ocr_logs
from core.events import get_event_emitter
from core.ocr_sender import reload_ocr_sender
from api.models import CameraCreate, CameraUpdate


def get_local_ip() -> str:
    """Lấy local IP address của máy"""
    try:
        # Kết nối đến một địa chỉ bất kỳ để lấy local IP
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


class CameraSettingsDialog(QtWidgets.QDialog):
    """Popup dialog để quản lý cameras"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Camera Settings")
        self.setMinimumSize(500, 600)
        self.setStyleSheet("background-color: #2a2a2a; color: #fff;")
        
        layout = QtWidgets.QVBoxLayout(self)
        layout.setSpacing(10)
        
        # Server Information Section
        server_group = QtWidgets.QGroupBox("Central Config & Identification")
        server_group.setStyleSheet(
            "QGroupBox { border: 1px solid #555; border-radius: 5px; padding: 10px; margin-top: 10px; }"
            "QGroupBox::title { subcontrol-origin: margin; left: 10px; padding: 0 5px; color: #4db8ff; font-weight: bold; }"
        )
        server_layout = QtWidgets.QVBoxLayout(server_group)
        
        # Central URL
        url_label = QtWidgets.QLabel("Central URL (e.g., http://192.168.1.100:8000):")
        url_label.setStyleSheet("color: #ccc; font-size: 11px;")
        server_layout.addWidget(url_label)
        self.central_url_input = QtWidgets.QLineEdit()
        self.central_url_input.setPlaceholderText("http://192.168.1.100:8000")
        self.central_url_input.setStyleSheet(
            "background-color: #1a1a1a; color: #888; border: 1px solid #555; padding: 5px;"
        )
        self.central_url_input.setReadOnly(True)
        self.central_url_input.setToolTip("Giá trị này được đẩy tự động từ Central Server")
        server_layout.addWidget(self.central_url_input)

        # NVR ID / Name / Description fields Removed per user request
        # Only Device ID remains editable

        # Device ID (Edge Identifier)
        device_id_layout = QtWidgets.QHBoxLayout()
        device_id_label = QtWidgets.QLabel("Device ID (Hardware ID):")
        device_id_label.setStyleSheet("color: #ccc; font-size: 11px;")
        self.device_id_input = QtWidgets.QLineEdit()
        self.device_id_input.setPlaceholderText("parking-edge-001")
        self.device_id_input.setStyleSheet(
            "background-color: #1a1a1a; color: #fff; border: 1px solid #555; padding: 5px;"
        )
        device_id_layout.addWidget(device_id_label)
        device_id_layout.addWidget(self.device_id_input)
        server_layout.addLayout(device_id_layout)

        # Current IP Info
        current_info_layout = QtWidgets.QHBoxLayout()
        local_ip = get_local_ip()
        self.current_ip_label = QtWidgets.QLabel(f"Local IP: {local_ip}")
        self.current_ip_label.setStyleSheet("color: #888; font-size: 10px; font-style: italic;")
        current_info_layout.addWidget(self.current_ip_label)
        server_layout.addLayout(current_info_layout)
        
        layout.addWidget(server_group)
        
        # List cameras
        cameras_label = QtWidgets.QLabel("Cameras:")
        cameras_label.setStyleSheet("color: #ccc; font-size: 12px; font-weight: bold; margin-top: 10px;")
        layout.addWidget(cameras_label)
        
        self.camera_list = QtWidgets.QListWidget()
        self.camera_list.setStyleSheet(
            "background-color: #1a1a1a; color: #fff; border: 1px solid #555;"
        )
        layout.addWidget(self.camera_list, 1)
        
        # Buttons
        btn_layout = QtWidgets.QHBoxLayout()
        self.add_btn = QtWidgets.QPushButton("➕ Add Camera")
        self.edit_btn = QtWidgets.QPushButton("✏️ Edit")
        self.del_btn = QtWidgets.QPushButton("🗑️ Delete")
        self.close_btn = QtWidgets.QPushButton("Close")
        
        for btn in [self.add_btn, self.edit_btn, self.del_btn, self.close_btn]:
            btn.setStyleSheet(
                "background-color: #3a3a3a; color: #fff; border: 1px solid #555; padding: 8px;"
            )
            btn_layout.addWidget(btn)
        
        layout.addLayout(btn_layout)
        
        # Connect signals
        self.add_btn.clicked.connect(self.add_camera)
        self.edit_btn.clicked.connect(self.edit_camera)
        self.del_btn.clicked.connect(self.delete_camera)
        self.close_btn.clicked.connect(self.save_and_close)
        
        # Connect event để tự động refresh list khi có camera mới
        self._event_emitter = get_event_emitter()
        self._event_emitter.camera_list_changed.connect(self.refresh_list)

        # Load target server từ config
        self.load_target_server()

        self.refresh_list()

    def closeEvent(self, event):
        """Disconnect signal khi dialog đóng để tránh memory leak và duplicate handlers"""
        try:
            self._event_emitter.camera_list_changed.disconnect(self.refresh_list)
            print("[CameraSettingsDialog] Disconnected camera_list_changed signal", flush=True)
        except Exception:
            pass  # Ignore if already disconnected
        super().closeEvent(event)
    
    def load_target_server(self):
        """Load configure từ config.yaml"""
        try:
            cfg = load_config()

            # Load device_id
            self.device_id_input.setText(cfg.get("device_id", ""))

            # Load Central Config
            central_cfg = cfg.get("central", {})
            self.central_url_input.setText(central_cfg.get("url", ""))

        except Exception as e:
            logging.error(f"Failed to load config: {e}")
    
    def save_target_server(self):
        """Save configure vào config.yaml"""
        try:
            cfg = load_config()

            # 1. Save Device ID
            device_id = self.device_id_input.text().strip()
            if device_id:
                cfg["device_id"] = device_id
            else:
                QtWidgets.QMessageBox.warning(self, "Warning", "Device ID is required!")
                return

            # 2. Save Central Config
            if "central" not in cfg:
                cfg["central"] = {}
            
            central_url = self.central_url_input.text().strip()
            
            # Central URL is read-only in UI, but we keep it in config if present
            # If user somehow edited it (not possible via read-only UI), we save it
            
            # Note: We do NOT overwrite NVR ID/Name/Desc with empty values if they exist in file,
            # but since we don't load them, we shouldn't touch them? 
            # Actually, user wants to remove logic. We just ignore them.
            
            cfg["central"]["url"] = central_url
            cfg["central"]["enabled"] = True if central_url else False
            
            # Sync device_id to central config too for consistency
            cfg["central"]["device_id"] = device_id

            # 3. Update target_server based on Central URL (for backward compatibility / OCR sender)
            if central_url:
                try:
                    from urllib.parse import urlparse
                    parsed = urlparse(central_url)
                    host = parsed.hostname
                    port = parsed.port or 80
                    
                    if "target_server" not in cfg:
                        cfg["target_server"] = {}
                    cfg["target_server"]["ip"] = host
                    cfg["target_server"]["port"] = port
                except Exception:
                    pass

            save_config(cfg)

            # Reload config và re-init OCR sender + Central Sync
            try:
                camera_manager.reload_config()
                reload_ocr_sender()
                
                from core.central_manager import central_manager
                central_manager.reload_config()
                
                logging.info("[Settings] Config reloaded (Cameras, OCR, Central Sync)")
            except Exception as reload_err:
                logging.error(f"[Settings] Failed to reload config: {reload_err}")

            # Show success message
            QtWidgets.QMessageBox.information(
                self,
                "Settings Saved",
                f"Settings saved successfully!\n"
                f"Settings saved successfully!\n"
                f"Heartbeat will be sent with Device ID: {device_id}"
            )
        except Exception as e:
            logging.error(f"Failed to save settings: {e}")
            QtWidgets.QMessageBox.critical(self, "Error", f"Failed to save settings: {e}")
    
    def save_and_close(self):
        """Save target server và đóng dialog"""
        self.save_target_server()
        self.accept()
    
    def refresh_list(self):
        import logging
        print(f"[CameraSettingsDialog] refresh_list() CALLED - visible={self.isVisible()}, count before={self.camera_list.count()}", flush=True)
        logging.info("[CameraSettingsDialog] refresh_list() called")
        self.camera_list.clear()
        cameras = camera_manager.list_cameras()
        print(f"[CameraSettingsDialog] Found {len(cameras)} cameras: {[c.id for c in cameras]}", flush=True)
        logging.info(f"[CameraSettingsDialog] Found {len(cameras)} cameras: {[c.id for c in cameras]}")
        for cam in cameras:
            # Hiển thị camera type tiếng Việt
            camera_type_vn = {"entrance": "Vào", "exit": "Ra", "internal": "Trong bãi"}.get(cam.camera_type, cam.camera_type)

            # Format item text based on camera type
            if cam.url.startswith("rtsp://"):
                # RTSP camera: Show IP address
                import re
                match = re.search(r'@([\d\.]+):', cam.url)
                ip_address = match.group(1) if match else cam.url.split("@")[-1].split(":")[0]
                item_text = f"{cam.id} - {cam.name} | Cổng: {camera_type_vn} | IP: {ip_address}"
            else:
                # Video file: Only show camera type (no IP)
                item_text = f"{cam.id} - {cam.name} | Cổng: {camera_type_vn}"

            item = QtWidgets.QListWidgetItem(item_text)
            item.setData(QtCore.Qt.ItemDataRole.UserRole, cam.id)
            self.camera_list.addItem(item)

        print(f"[CameraSettingsDialog] ✅ UI updated - list now has {self.camera_list.count()} items", flush=True)

    def add_camera(self):
        """Hiển thị dialog để thêm camera mới với đầy đủ thông tin"""
        dialog = QtWidgets.QDialog(self)
        dialog.setWindowTitle("Add Camera")
        dialog.setMinimumWidth(500)
        dialog.setStyleSheet("background-color: #2a2a2a; color: #fff;")
        
        layout = QtWidgets.QVBoxLayout(dialog)
        layout.setSpacing(15)
        
        # Camera ID
        id_label = QtWidgets.QLabel("Camera ID *:")
        id_label.setStyleSheet("color: #ccc; font-size: 11px;")
        layout.addWidget(id_label)
        id_input = QtWidgets.QLineEdit()
        id_input.setPlaceholderText("camera-1")
        id_input.setStyleSheet(
            "background-color: #1a1a1a; color: #fff; border: 1px solid #555; padding: 5px;"
        )
        layout.addWidget(id_input)
        
        # RTSP URL (camera URL thực tế - sẽ được go2rtc relay)
        url_label = QtWidgets.QLabel("RTSP URL (Camera URL) *:")
        url_label.setStyleSheet("color: #ccc; font-size: 11px; margin-top: 10px;")
        layout.addWidget(url_label)
        url_input = QtWidgets.QLineEdit()
        url_input.setPlaceholderText("rtsp://user:pass@192.168.1.100:554/stream1")
        url_input.setStyleSheet(
            "background-color: #1a1a1a; color: #fff; border: 1px solid #555; padding: 5px;"
        )
        layout.addWidget(url_input)
        
        # Camera Name
        name_label = QtWidgets.QLabel("Camera Name:")
        name_label.setStyleSheet("color: #ccc; font-size: 11px; margin-top: 10px;")
        layout.addWidget(name_label)
        name_input = QtWidgets.QLineEdit()
        name_input.setPlaceholderText("Camera Name (optional)")
        name_input.setStyleSheet(
            "background-color: #1a1a1a; color: #fff; border: 1px solid #555; padding: 5px;"
        )
        layout.addWidget(name_input)
        
        # Camera Type
        type_label = QtWidgets.QLabel("Camera Type:")
        type_label.setStyleSheet("color: #ccc; font-size: 11px; margin-top: 10px;")
        layout.addWidget(type_label)
        type_combo = QtWidgets.QComboBox()
        type_combo.addItems(["entrance", "exit", "internal"])
        type_combo.setCurrentText("entrance")
        type_combo.setStyleSheet(
            "QComboBox { background-color: #1a1a1a; color: #fff; border: 1px solid #555; padding: 5px; }"
            "QComboBox::drop-down { border: none; }"
            "QComboBox::down-arrow { image: none; border: none; }"
        )
        layout.addWidget(type_combo)
        
        # Info label
        info_label = QtWidgets.QLabel("ℹ️ Camera sẽ được thêm vào go2rtc và unified_app sẽ dùng relay URL")
        info_label.setStyleSheet("color: #888; font-size: 10px; font-style: italic; margin-top: 10px;")
        layout.addWidget(info_label)
        
        # Loading indicator (ẩn ban đầu)
        loading_label = QtWidgets.QLabel("⏳ Đang xử lý...")
        loading_label.setStyleSheet("color: #0066cc; font-size: 12px; padding: 10px; font-weight: bold;")
        loading_label.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        loading_label.hide()
        layout.addWidget(loading_label)
        
        # Buttons
        btn_layout = QtWidgets.QHBoxLayout()
        add_btn = QtWidgets.QPushButton("➕ Add")
        cancel_btn = QtWidgets.QPushButton("Cancel")
        add_btn.setStyleSheet(
            "background-color: #0066cc; color: #fff; border: none; padding: 8px 20px; font-weight: bold;"
        )
        cancel_btn.setStyleSheet(
            "background-color: #3a3a3a; color: #fff; border: 1px solid #555; padding: 8px 20px;"
        )
        btn_layout.addWidget(add_btn)
        btn_layout.addWidget(cancel_btn)
        layout.addLayout(btn_layout)
        
        def handle_add():
            cid = id_input.text().strip()
            url = url_input.text().strip()
            name = name_input.text().strip()
            camera_type = type_combo.currentText()
            
            # Validation
            if not cid:
                QtWidgets.QMessageBox.warning(dialog, "Error", "Camera ID cannot be empty")
                return
            if not url:
                QtWidgets.QMessageBox.warning(dialog, "Error", "RTSP URL cannot be empty")
                return
            
            # Hiển thị loading và disable controls
            loading_label.show()
            id_input.setEnabled(False)
            url_input.setEnabled(False)
            name_input.setEnabled(False)
            type_combo.setEnabled(False)
            add_btn.setEnabled(False)
            cancel_btn.setEnabled(False)
            QtWidgets.QApplication.processEvents()
            
            try:
                camera_manager.add_camera(CameraCreate(
                    id=cid,
                    url=url,
                    name=name or cid,
                    camera_type=camera_type
                ))
                # Đợi một chút để operation bắt đầu
                QtCore.QThread.msleep(500)
                # UI sẽ tự động update qua camera_list_changed signal (không cần refresh_list)
                dialog.accept()
            except Exception as e:
                # Enable lại controls khi có lỗi
                id_input.setEnabled(True)
                url_input.setEnabled(True)
                name_input.setEnabled(True)
                type_combo.setEnabled(True)
                add_btn.setEnabled(True)
                cancel_btn.setEnabled(True)
                loading_label.hide()
                QtWidgets.QMessageBox.warning(dialog, "Error", f"Failed to add camera: {e}")
        
        add_btn.clicked.connect(handle_add)
        cancel_btn.clicked.connect(dialog.reject)
        
        dialog.exec()
    
    def edit_camera(self):
        item = self.camera_list.currentItem()
        if not item:
            QtWidgets.QMessageBox.warning(self, "Warning", "Please select a camera to edit")
            return
        
        cid = item.data(QtCore.Qt.ItemDataRole.UserRole)
        cameras = camera_manager.list_cameras()
        camera = next((cam for cam in cameras if cam.id == cid), None)
        
        if not camera:
            QtWidgets.QMessageBox.warning(self, "Error", "Camera not found")
            return
        
        # Dialog để sửa URL và Name
        dialog = QtWidgets.QDialog(self)
        dialog.setWindowTitle(f"Edit Camera: {cid}")
        dialog.setMinimumWidth(400)
        dialog.setStyleSheet("background-color: #2a2a2a; color: #fff;")
        
        layout = QtWidgets.QVBoxLayout(dialog)
        
        # Camera ID (read-only)
        id_label = QtWidgets.QLabel(f"Camera ID: {cid}")
        id_label.setStyleSheet("color: #888; font-size: 11px; padding: 5px;")
        layout.addWidget(id_label)
        
        # RTSP URL
        url_label = QtWidgets.QLabel("RTSP URL:")
        url_label.setStyleSheet("color: #ccc; font-size: 11px;")
        layout.addWidget(url_label)
        url_input = QtWidgets.QLineEdit(camera.url)
        url_input.setStyleSheet(
            "background-color: #1a1a1a; color: #fff; border: 1px solid #555; padding: 5px;"
        )
        layout.addWidget(url_input)
        
        # Camera Name
        name_label = QtWidgets.QLabel("Camera Name:")
        name_label.setStyleSheet("color: #ccc; font-size: 11px;")
        layout.addWidget(name_label)
        name_input = QtWidgets.QLineEdit(camera.name)
        name_input.setStyleSheet(
            "background-color: #1a1a1a; color: #fff; border: 1px solid #555; padding: 5px;"
        )
        layout.addWidget(name_input)

        # Camera Type
        type_label = QtWidgets.QLabel("Camera Type:")
        type_label.setStyleSheet("color: #ccc; font-size: 11px;")
        layout.addWidget(type_label)
        type_combo = QtWidgets.QComboBox()
        type_combo.addItems(["entrance", "exit", "internal"])
        type_combo.setCurrentText(camera.camera_type)
        type_combo.setStyleSheet(
            "QComboBox { background-color: #1a1a1a; color: #fff; border: 1px solid #555; padding: 5px; }"
            "QComboBox::drop-down { border: none; }"
            "QComboBox::down-arrow { image: none; border: none; }"
        )
        layout.addWidget(type_combo)

        # Loading indicator (ẩn ban đầu)
        loading_label = QtWidgets.QLabel("⏳ Đang xử lý...")
        loading_label.setStyleSheet("color: #0066cc; font-size: 12px; padding: 10px; font-weight: bold;")
        loading_label.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        loading_label.hide()
        layout.addWidget(loading_label)

        # Buttons
        btn_layout = QtWidgets.QHBoxLayout()
        save_btn = QtWidgets.QPushButton("💾 Save")
        cancel_btn = QtWidgets.QPushButton("Cancel")
        for btn in [save_btn, cancel_btn]:
            btn.setStyleSheet(
                "background-color: #3a3a3a; color: #fff; border: 1px solid #555; padding: 8px;"
            )
            btn_layout.addWidget(btn)
        layout.addLayout(btn_layout)
        
        def handle_save():
            new_url = url_input.text().strip()
            new_name = name_input.text().strip()
            new_camera_type = type_combo.currentText()

            if not new_url:
                QtWidgets.QMessageBox.warning(dialog, "Error", "RTSP URL cannot be empty")
                return

            # Hiển thị loading và disable controls
            loading_label.show()
            url_input.setEnabled(False)
            name_input.setEnabled(False)
            type_combo.setEnabled(False)
            save_btn.setEnabled(False)
            cancel_btn.setEnabled(False)
            QtWidgets.QApplication.processEvents()

            try:
                camera_manager.update_camera(
                    cid,
                    CameraUpdate(url=new_url, name=new_name or cid, camera_type=new_camera_type)
                )
                # Đợi một chút để operation bắt đầu
                QtCore.QThread.msleep(500)
                # UI sẽ tự động update qua camera_list_changed signal (không cần refresh_list)
                dialog.accept()
            except Exception as e:
                # Enable lại controls khi có lỗi
                url_input.setEnabled(True)
                name_input.setEnabled(True)
                type_combo.setEnabled(True)
                save_btn.setEnabled(True)
                cancel_btn.setEnabled(True)
                loading_label.hide()
                QtWidgets.QMessageBox.warning(dialog, "Error", f"Failed to update camera: {e}")
        
        save_btn.clicked.connect(handle_save)
        cancel_btn.clicked.connect(dialog.reject)
        
        dialog.exec()
    
    def delete_camera(self):
        item = self.camera_list.currentItem()
        if not item:
            QtWidgets.QMessageBox.warning(self, "Warning", "Please select a camera to delete")
            return
        cid = item.data(QtCore.Qt.ItemDataRole.UserRole)
        
        # Tạo custom dialog để có thể hiển thị loading
        confirm_dialog = QtWidgets.QDialog(self)
        confirm_dialog.setWindowTitle("Confirm Delete")
        confirm_dialog.setMinimumWidth(300)
        confirm_dialog.setStyleSheet("background-color: #2a2a2a; color: #fff;")
        
        layout = QtWidgets.QVBoxLayout(confirm_dialog)
        layout.setSpacing(15)
        
        # Message
        msg_label = QtWidgets.QLabel(f"Delete camera '{cid}'?")
        msg_label.setStyleSheet("color: #fff; font-size: 13px; padding: 10px;")
        msg_label.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(msg_label)
        
        # Loading indicator (ẩn ban đầu)
        loading_label = QtWidgets.QLabel("⏳ Đang xóa camera...")
        loading_label.setStyleSheet("color: #0066cc; font-size: 12px; padding: 10px; font-weight: bold;")
        loading_label.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        loading_label.hide()
        layout.addWidget(loading_label)
        
        # Buttons
        btn_layout = QtWidgets.QHBoxLayout()
        yes_btn = QtWidgets.QPushButton("Yes")
        no_btn = QtWidgets.QPushButton("No")
        yes_btn.setStyleSheet(
            "background-color: #cc0000; color: #fff; border: none; padding: 8px 20px; font-weight: bold;"
        )
        no_btn.setStyleSheet(
            "background-color: #3a3a3a; color: #fff; border: 1px solid #555; padding: 8px 20px;"
        )
        btn_layout.addWidget(yes_btn)
        btn_layout.addWidget(no_btn)
        layout.addLayout(btn_layout)
        
        def handle_delete():
            # Hiển thị loading và disable controls
            loading_label.show()
            msg_label.hide()
            yes_btn.setEnabled(False)
            no_btn.setEnabled(False)
            QtWidgets.QApplication.processEvents()
            
            try:
                camera_manager.remove_camera(cid)
                # Đợi một chút để operation hoàn thành
                QtCore.QThread.msleep(500)
                # UI sẽ tự động update qua camera_list_changed signal (không cần refresh_list)
                confirm_dialog.accept()
            except Exception as e:
                # Enable lại controls khi có lỗi
                yes_btn.setEnabled(True)
                no_btn.setEnabled(True)
                loading_label.hide()
                msg_label.show()
                QtWidgets.QMessageBox.warning(confirm_dialog, "Error", f"Failed to delete camera: {e}")
        
        yes_btn.clicked.connect(handle_delete)
        no_btn.clicked.connect(confirm_dialog.reject)
        
        confirm_dialog.exec()


