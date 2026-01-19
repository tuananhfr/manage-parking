"""
OCRLogDialog - Display OCR logs with auto-refresh
"""
import logging
from PyQt6 import QtCore, QtWidgets

from core.config import load_config
from core.db import get_ocr_logs, delete_ocr_log, delete_all_ocr_logs
from core.events import get_event_emitter


class OCRLogDialog(QtWidgets.QDialog):
    """Dialog hiển thị danh sách log OCR (biển số, thời gian, vị trí) với auto-refresh."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("OCR Logs")
        self.setMinimumSize(700, 500)
        self.setStyleSheet("background-color: #2a2a2a; color: #fff;")

        layout = QtWidgets.QVBoxLayout(self)
        layout.setSpacing(10)

        # Info bar
        info_layout = QtWidgets.QHBoxLayout()
        self.status_label = QtWidgets.QLabel("💡 Ready - will update when new data arrives")
        self.status_label.setStyleSheet("color: #4CAF50; font-size: 11px; padding: 5px;")

        self.sync_label = QtWidgets.QLabel("📡 Sync: Disabled")
        self.sync_label.setStyleSheet("color: #888; font-size: 11px; padding: 5px;")

        self.total_label = QtWidgets.QLabel("Total: 0 records")
        self.total_label.setStyleSheet("color: #ccc; font-size: 11px; padding: 5px;")

        info_layout.addWidget(self.status_label)
        info_layout.addStretch()
        info_layout.addWidget(self.sync_label)
        info_layout.addWidget(QtWidgets.QLabel("|"))
        info_layout.addWidget(self.total_label)
        layout.addLayout(info_layout)

        # Table
        self.table = QtWidgets.QTableWidget()
        self.table.setColumnCount(4)
        self.table.setHorizontalHeaderLabels(
            ["Plate", "Time", "Camera Name", "Camera ID"]
        )
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.horizontalHeader().setSectionResizeMode(
            QtWidgets.QHeaderView.ResizeMode.Stretch
        )
        self.table.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(QtWidgets.QAbstractItemView.SelectionMode.ExtendedSelection)
        self.table.setStyleSheet(
            "QTableWidget { background-color: #1a1a1a; gridline-color: #555; }"
            "QHeaderView::section { background-color: #333; color: #fff; }"
        )
        layout.addWidget(self.table)

        # Buttons
        btn_layout = QtWidgets.QHBoxLayout()
        self.refresh_btn = QtWidgets.QPushButton("🔄 Refresh")
        self.delete_selected_btn = QtWidgets.QPushButton("🗑️ Delete Selected")
        self.delete_all_btn = QtWidgets.QPushButton("🗑️ Clear All")
        self.close_btn = QtWidgets.QPushButton("Close")

        self.delete_selected_btn.setStyleSheet(
            "background-color: #d32f2f; color: #fff; border: 1px solid #b71c1c; padding: 8px;"
        )
        self.delete_all_btn.setStyleSheet(
            "background-color: #c62828; color: #fff; border: 1px solid #b71c1c; padding: 8px;"
        )

        for btn in [self.refresh_btn, self.close_btn]:
            btn.setStyleSheet(
                "background-color: #3a3a3a; color: #fff; border: 1px solid #555; padding: 8px;"
            )

        btn_layout.addWidget(self.refresh_btn)
        btn_layout.addWidget(self.delete_selected_btn)
        btn_layout.addWidget(self.delete_all_btn)
        btn_layout.addStretch()
        btn_layout.addWidget(self.close_btn)
        layout.addLayout(btn_layout)

        self.refresh_btn.clicked.connect(self.load_logs)
        self.delete_selected_btn.clicked.connect(self.delete_selected)
        self.delete_all_btn.clicked.connect(self.delete_all)
        self.close_btn.clicked.connect(self.accept)

        # Connect to event emitter
        self.last_count = 0
        event_emitter = get_event_emitter()
        event_emitter.ocr_log_added.connect(self.on_ocr_log_added)
        event_emitter.sync_status_changed.connect(self.on_sync_status_changed)

        # Check if sync is enabled
        cfg = load_config()
        central_cfg = cfg.get("central", {})
        if central_cfg.get("enabled", False):
            self.sync_label.setText("📡 Sync: Initializing...")
            self.sync_label.setStyleSheet("color: #FFC107; font-size: 11px; padding: 5px;")

        self.load_logs()

    def load_logs(self):
        """Load data from DB and display"""
        try:
            logs = get_ocr_logs(limit=200)
        except Exception as e:
            logging.error(f"Failed to load OCR logs: {e}")
            QtWidgets.QMessageBox.warning(self, "Error", f"Failed to load logs: {e}")
            return

        self.table.setRowCount(len(logs))
        for row, log in enumerate(logs):
            plate_item = QtWidgets.QTableWidgetItem(log["plate_text"])
            plate_item.setData(QtCore.Qt.ItemDataRole.UserRole, log["id"])
            self.table.setItem(row, 0, plate_item)
            self.table.setItem(row, 1, QtWidgets.QTableWidgetItem(log["timestamp"]))
            self.table.setItem(row, 2, QtWidgets.QTableWidgetItem(log["camera_name"]))
            self.table.setItem(row, 3, QtWidgets.QTableWidgetItem(log["camera_id"]))

        self.total_label.setText(f"Total: {len(logs)} records")
        self.last_count = len(logs)

    def on_ocr_log_added(self, camera_id: str, plate_text: str, timestamp: str):
        """Real-time event handler for new OCR log"""
        try:
            self.load_logs()

            self.status_label.setStyleSheet("color: #FFC107; font-size: 11px; padding: 5px;")
            self.status_label.setText(f"✨ New: {plate_text} @ {camera_id}")

            QtCore.QTimer.singleShot(3000, lambda: (
                self.status_label.setStyleSheet("color: #4CAF50; font-size: 11px; padding: 5px;"),
                self.status_label.setText("💡 Ready - will update when new data arrives")
            ))
        except Exception as e:
            logging.error(f"on_ocr_log_added failed: {e}")

    def on_sync_status_changed(self, connected: bool, sent: int, failed: int, pending: int):
        """Sync status handler"""
        try:
            if pending == 0:
                self.sync_label.setText(f"✅ Synced (↑{sent})")
                self.sync_label.setStyleSheet("color: #4CAF50; font-size: 11px; padding: 5px;")
            else:
                if connected:
                    self.sync_label.setText(f"⏳ Syncing... ({pending} pending, ↑{sent})")
                    self.sync_label.setStyleSheet("color: #FFC107; font-size: 11px; padding: 5px;")
                else:
                    self.sync_label.setText(f"⚠️ Offline ({pending} pending)")
                    self.sync_label.setStyleSheet("color: #FF5722; font-size: 11px; padding: 5px;")

            if failed > 0:
                self.sync_label.setText(f"{self.sync_label.text()} ⚠️{failed} failed")

        except Exception as e:
            logging.error(f"on_sync_status_changed failed: {e}")

    def delete_selected(self):
        """Delete selected records"""
        selected_rows = self.table.selectionModel().selectedRows()

        if not selected_rows:
            QtWidgets.QMessageBox.warning(
                self, "Warning", "Please select at least one record to delete"
            )
            return

        count = len(selected_rows)
        reply = QtWidgets.QMessageBox.question(
            self,
            "Confirm Delete",
            f"Delete {count} selected record(s)?",
            QtWidgets.QMessageBox.StandardButton.Yes | QtWidgets.QMessageBox.StandardButton.No
        )

        if reply == QtWidgets.QMessageBox.StandardButton.Yes:
            try:
                ids_to_delete = []
                for index in selected_rows:
                    row = index.row()
                    plate_item = self.table.item(row, 0)
                    if plate_item:
                        log_id = plate_item.data(QtCore.Qt.ItemDataRole.UserRole)
                        ids_to_delete.append(log_id)

                for log_id in ids_to_delete:
                    delete_ocr_log(log_id)

                self.load_logs()

                self.status_label.setStyleSheet("color: #4CAF50; font-size: 11px; padding: 5px;")
                self.status_label.setText(f"✅ Deleted {count} record(s)")
                QtCore.QTimer.singleShot(3000, lambda: (
                    self.status_label.setStyleSheet("color: #4CAF50; font-size: 11px; padding: 5px;"),
                    self.status_label.setText("💡 Ready - will update when new data arrives")
                ))

            except Exception as e:
                logging.error(f"Failed to delete records: {e}")
                QtWidgets.QMessageBox.warning(self, "Error", f"Failed to delete: {e}")

    def delete_all(self):
        """Delete ALL records"""
        reply = QtWidgets.QMessageBox.warning(
            self,
            "⚠️ Confirm Clear All",
            "Are you sure you want to DELETE ALL OCR logs?\n\n"
            "This action CANNOT be undone!",
            QtWidgets.QMessageBox.StandardButton.Yes | QtWidgets.QMessageBox.StandardButton.No,
            QtWidgets.QMessageBox.StandardButton.No
        )

        if reply == QtWidgets.QMessageBox.StandardButton.Yes:
            try:
                count = delete_all_ocr_logs()
                self.load_logs()

                self.status_label.setStyleSheet("color: #FF9800; font-size: 11px; padding: 5px;")
                self.status_label.setText(f"🗑️ Cleared all ({count} records)")
                QtCore.QTimer.singleShot(3000, lambda: (
                    self.status_label.setStyleSheet("color: #4CAF50; font-size: 11px; padding: 5px;"),
                    self.status_label.setText("💡 Ready - will update when new data arrives")
                ))

            except Exception as e:
                logging.error(f"Failed to clear all logs: {e}")
                QtWidgets.QMessageBox.warning(self, "Error", f"Failed to clear: {e}")
