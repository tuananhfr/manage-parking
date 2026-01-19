"""
Event System - Global event emitter cho real-time updates
"""
from PyQt6.QtCore import QObject, pyqtSignal, pyqtSlot


class EventEmitter(QObject):
    """
    Global event emitter - Singleton pattern

    Signals:
        ocr_log_added: Emit khi có biển số mới được lưu vào DB
            - Args: (camera_id: str, plate_text: str, timestamp: str)
        sync_status_changed: Emit khi sync status thay đổi
            - Args: (connected: bool, logs_sent: int, logs_failed: int, pending: int)
        camera_list_changed: Emit khi danh sách camera thay đổi (thêm/xóa camera)
    """
    # Signal khi có OCR log mới
    ocr_log_added = pyqtSignal(str, str, str)  # (camera_id, plate_text, timestamp)

    # Signal khi sync status thay đổi
    sync_status_changed = pyqtSignal(bool, int, int, int)  # (connected, sent, failed, pending)

    # Signal khi camera list thay đổi
    camera_list_changed = pyqtSignal()  # No args

    @pyqtSlot()
    def emit_camera_list_changed(self):
        """Slot để emit camera_list_changed signal - có thể gọi qua QMetaObject.invokeMethod"""
        self.camera_list_changed.emit()


# Global singleton instance
_event_emitter = None


def get_event_emitter() -> EventEmitter:
    """
    Lấy global event emitter instance (singleton)

    Returns:
        EventEmitter instance
    """
    global _event_emitter
    if _event_emitter is None:
        _event_emitter = EventEmitter()
    return _event_emitter
