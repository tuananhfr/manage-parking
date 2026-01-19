# Camera System Architecture - unified_app

## 1. Tổng quan Kiến trúc

Hệ thống Camera trong `unified_app` hoạt động dựa trên sự phối hợp chặt chẽ giữa **CameraManager** (App Core) và **Go2RTC** (Media Server).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          unified_app (Python)                           │
├─────────────────────────────────────────────────────────────────────────┤
│  UI (PyQt6)                                                             │
│  └── CameraSettingsDialog (Quản lý CRUD)                                │
├─────────────────────────────────────────────────────────────────────────┤
│  Core Managers                                                          │
│  ├── CameraManager (Singleton)                                          │
│  │    ├── Quản lý danh sách camera (Memory & Config)                    │
│  │    ├── Điều phối Go2RTC (Add/Remove Stream)                          │
│  │    └── Quản lý Workers (Detection, Recorder)                         │
│  │                                                                      │
│  └── Go2RTCManager (Singleton)                                          │
│       ├── Quản lý process go2rtc.exe                                    │
│       ├── Giao tiếp qua REST API (:1984) để add/remove stream nóng      │
│       └── Sync 2 chiều: go2rtc.yaml ↔ config.yaml                       │
├─────────────────────────────────────────────────────────────────────────┤
│  Recording Subsystem                                                    │
│  └── CameraRecorder (FFmpeg Wrapper)                                    │
│       └── Ghi hình từ RTSP Relay của Go2RTC                             │
│       └── Tự động chia file, tạo thumbnail, timelapse                   │
└─────────────────────────────────────────────────────────────────────────┘
        ↕ (REST API)              ↕ (RTSP Stream)
┌─────────────────────────────────────────────────────────────────────────┐
│                    go2rtc (Media Server :1984 :8554)                    │
│  ├── Input: RTSP Camera, HTTP Stream, Files                             │
│  ├── Output: RTSP Relay (:8554), WebRTC, MJPEG, Snapshots               │
│  └── Conf: go2rtc.yaml                                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## 2. Files Cấu hình & Dữ liệu

| File | Vai trò |
|------|---------|
| `config.yaml` | **Source of Truth** cho ứng dụng. Chứa danh sách streams, metadata (tên, type, enable_detection), settings. |
| `go2rtc.yaml` | Cấu hình cho Media Server. Được sync tự động từ `config.yaml` khi khởi động. |
| `recordings/` | Thư mục chứa video đã ghi. Cấu trúc: `{cid}/{YYYYMMDD}/{name}.mp4`. |

## 3. Quy trình Xử lý (Flows)

### 3.1. Add Camera (Fast Path)
Quy trình thêm camera được tối ưu để **không cần restart go2rtc**, giúp trải nghiệm mượt mà (<1s).

1.  **User Input**: Nhập ID, RTSP URL, Name.
2.  **Validator**: Check URL hợp lệ.
3.  **Go2RTC API Call**: `Go2RTCManager` gọi `PUT /api/streams` để thêm stream ngay lập tức vào runtime.
    *   *Ưu điểm*: Stream có sẵn ngay lập tức, không làm gián đoạn các camera khác.
4.  **Persist**:
    *   Ghi vào `go2rtc.yaml` (để survive restart).
    *   Sync ngược vào `config.yaml` (lưu metadata).
5.  **Workers Start**:
    *   Start `CameraWorker` (để chạy AI Detection nếu enabled).
    *   Start `CameraRecorder` (ghi hình 24/7 từ stream Go2RTC).

### 3.2. Edit Camera
1.  **Check Change**:
    *   Nếu chỉ đổi tên/type: Chỉ update metadata trong `config.yaml`.
    *   Nếu đổi **RTSP URL**:
        1.  Gọi `PUT /api/streams` (Go2RTC API) với URL mới.
        2.  Restart `CameraWorker` & `CameraRecorder` để nhận stream mới.
        3.  Cập nhật file config.
    *   Nếu đổi **Camera ID**: Thực hiện quy trình **Delete Old** -> **Add New**.

### 3.3. Delete Camera
1.  **Stop Processes**: Stop `CameraWorker` & `CameraRecorder`.
2.  **Go2RTC API Call**: Gọi `DELETE /api/streams` để xóa stream khỏi runtime.
3.  **Cleanup**: Xóa khỏi `config.yaml` và `go2rtc.yaml`.

### 3.4. Fail-safe Mechanism
Nếu gọi API Go2RTC thất bại (ví dụ process chết hoặc version cũ):
*   Hệ thống tự động fallback về cách cũ: Ghi file `go2rtc.yaml` -> Restart Go2RTC Process.

## 4. Recording Flow (CameraRecorder)

Ghi hình hoạt động độc lập với Detection, đảm bảo an ninh 24/7.

1.  **Source**: Luôn lấy stream từ **Go2RTC Relay** (`rtsp://localhost:8554/{cid}`).
    *   *Lợi ích*: Giảm tải cho camera gốc (chỉ cần 1 kết nối từ Camera -> Go2RTC).
2.  **Process**: Chạy `ffmpeg` process riêng cho mỗi camera.
    *   Format: Segmented MP4 (mặc định 30s/file).
    *   Codec: Copy (không re-encode) để tiết kiệm CPU.
3.  **Post-processing** (Background Thread):
    *   Sau khi file ghi xong, tự động tạo **Thumbnail** (.jpg) và **Timelapse** (.mp4).
    *   Di chuyển vào thư mục theo ngày/giờ gọn gàng.
    *   Tự động phục hồi (Recovery) các file lỗi do tắt máy đột ngột.

## 5. Synchronization (Two-way Sync)

Để đảm bảo nhất quán giữa App và Media Server:

1.  **App -> Go2RTC** (`sync_config_to_go2rtc`):
    *   Chạy khi Start App.
    *   Đẩy tất cả streams từ `config.yaml` vào Go2RTC.
2.  **Go2RTC -> App** (`sync_from_go2rtc_to_config`):
    *   Chạy khi phát hiện file `go2rtc.yaml` bị thay đổi (bởi user hoặc tool khác).
    *   Cập nhật lại `config.yaml` để UI hiển thị đúng thực tế.