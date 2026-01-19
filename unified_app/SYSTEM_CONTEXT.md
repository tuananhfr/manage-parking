# SYSTEM CONTEXT - Stream Camera Parking Management

> **Purpose:** Hiểu luồng hoạt động của app unified_app
> **Last Updated:** 2026-01-16

---

## 🎯 TỔNG QUAN

```
┌───────────────┐       ┌─────────────┐       ┌──────────────┐
│  unified_app  │◄─────►│  backend-   │◄─────►│  frontend-   │
│   (NVR/AI)    │       │  central    │       │   central    │
│               │       │             │       │              │
└───────┬───────┘       └─────────────┘       └──────────────┘
        │
    ┌───▼────┐
    │ go2rtc │ ◄─── RTSP streams từ cameras
    └────────┘
```

**unified_app:**
- Chạy trên máy NVR local
- Nhận stream RTSP từ cameras qua go2rtc relay
- AI phát hiện biển số xe (YOLOv8 + VietOCR)
- Ghi hình 24/7 continuous (FFmpeg)
- Tạo timelapse videos
- API cho frontend query recordings

---

## 🔄 LUỒNG 1: KHỞI ĐỘNG APP

**File:** `unified_app/app.py`

```
1. Start go2rtc subprocess
   - Port 8554 (RTSP relay)
   - Port 1984 (HTTP API)
   ↓
2. Load config.yaml
   cameras:
     camera-1:
       url: rtsp://192.168.1.100/stream
       enable_detection: true
       camera_type: entrance
   ↓
3. Sync go2rtc.yaml → config.yaml
   - go2rtc.yaml có stream URLs
   - config.yaml có metadata (detection, type)
   ↓
4. CameraManager.auto_start_all()
   Tạo CameraWorker cho từng camera:
     - Reader thread (đọc frames từ go2rtc)
     - Detector thread (YOLOv8 detect vehicles)
     - OCR thread (VietOCR đọc biển số)
   ↓
5. RecorderManager.start_all()
   Tạo CameraRecorder cho từng camera:
     - FFmpeg ghi từ rtsp://localhost:8554/{camera_id}
     - Segment 5 phút/file
     - Output: recordings/{camera_id}/{date}/{session}/
   ↓
6. Start FastAPI (port 5000)
   - GET /api/cameras
   - GET /api/recordings
   - POST /api/cameras (add new)
   ↓
7. Start PyQt6 UI (desktop)
   - Camera grid view
   - OCR logs viewer
```

**Quan trọng:** go2rtc PHẢI chạy trước, không có go2rtc thì app không hoạt động.

---

## 🔄 LUỒNG 2: THÊM CAMERA MỚI

**Trigger:** User click "Add Camera" trong UI hoặc gọi POST /api/cameras

**File:** `unified_app/core/camera_manager.py` (CameraManager.add_camera)

```
1. User nhập camera info:
   - Camera ID: "camera-3"
   - URL: "rtsp://192.168.1.103/stream"
   - Enable detection: true
   - Camera type: "entrance"
   ↓
2. CameraManager validate URL
   - Check format: rtsp://, rtmp://, http://
   ↓
3. Add to go2rtc.yaml
   streams:
     camera-3:
       - rtsp://192.168.1.103/stream#input=rtsp_tcp
   ↓
4. Reload go2rtc config
   - Call go2rtc API: /api/config/reload
   ↓
5. Wait for stream ready (retry 20 lần)
   - Poll go2rtc: GET /api/streams
   - Check camera-3 có trong list không
   ↓
6. Sync vào config.yaml
   cameras:
     camera-3:
       url: rtsp://192.168.1.103/stream
       enable_detection: true
       camera_type: entrance
   ↓
7. Create CameraWorker
   - Start 3 threads (Reader, Detector, OCR)
   - Connect to: rtsp://localhost:8554/camera-3
   ↓
8. Start CameraRecorder (nếu RTSP)
   - FFmpeg ghi 24/7
   ↓
9. Emit signal: camera_list_changed
   - PyQt UI refresh camera grid
   - Backend-central nhận WebSocket update
```

**Tại sao dùng go2rtc relay?**
- Camera RTSP thường không stable (timeout, packet loss)
- go2rtc handle reconnect tự động
- Nhiều consumers (recording + AI + frontend) cùng xem 1 stream
- TCP transport (#input=rtsp_tcp) reliable hơn UDP

---

## 🔄 LUỒNG 3: PHÁT HIỆN BIỂN SỐ (REAL-TIME)

**File:** `unified_app/core/camera_worker.py` (CameraWorker)

### Thread 1: Reader (full speed ~25 FPS)

```python
while running:
    frame = cv2.VideoCapture.read()  # từ go2rtc relay
    self.raw_frame = frame  # ghi đè frame cũ (NO queue)
    self.raw_frame_counter += 1
```

**Không dùng queue** → luôn có frame mới nhất, không bị lag.

### Thread 2: Detector (configurable FPS, default 10)

```python
while running:
    sleep(1.0 / detection_fps)  # throttle FPS
    frame = self.raw_frame.copy()

    # 1. YOLOv8 detect vehicles
    results = yolo_model.predict(frame)
    vehicles = [box for box in results if class == "car" or "motorbike"]

    # 2. ByteTrack assign tracking IDs
    tracks = byte_tracker.update(vehicles)

    # 3. Extract plate ROI từ mỗi vehicle
    for track in tracks:
        plate_roi = crop_plate_region(frame, track.bbox)

        # 4. Calculate quality score
        blur_score = laplacian_variance(plate_roi)
        conf_score = track.confidence
        area_score = bbox_area(track.bbox)
        quality = blur_score * conf_score * area_score

        # 5. Add vào VehicleTrack.candidates (keep best frames)
        track.candidates.append({
            "frame": plate_roi,
            "quality": quality,
            "timestamp": time.time()
        })
        track.candidates.sort(key=lambda x: x["quality"], reverse=True)
        track.candidates = track.candidates[:10]  # keep top 10
```

### Thread 3: OCR (chạy khi track ready)

```python
while running:
    for track_id, track in tracks.items():
        if len(track.candidates) < 5:
            continue  # chưa đủ frames

        if track.ocr_done:
            continue  # đã OCR rồi

        # 1. Select top 3 best quality frames
        best_frames = track.candidates[:3]

        # 2. VietOCR on each frame
        results = []
        for frame in best_frames:
            plate_text = viet_ocr.recognize(frame["frame"])
            results.append(plate_text)

        # 3. Majority voting
        from collections import Counter
        vote = Counter(results).most_common(1)[0][0]

        # 4. Validate Vietnamese plate format
        if not re.match(r'^\d{2}[A-Z]\d{4,5}$', vote):
            continue

        # 5. Check deduplication (last 10s)
        if vote in recent_plates_10s:
            continue

        # 6. Save to SQLite
        save_ocr_log(camera_id, vote, timestamp)

        # 7. Send to backend-central
        send_to_central({
            "event_type": "entry",  # based on camera_type
            "plate_text": vote,
            "camera_id": camera_id
        })

        # 8. Emit signal (PyQt)
        event_emitter.ocr_log_added.emit(camera_id, vote, timestamp)

        track.ocr_done = True
```

**Key Points:**
- **3-thread architecture:** Reader không bị block bởi AI, AI không bị block bởi OCR
- **Quality scoring:** Chọn frames rõ nét nhất để OCR
- **Voting mechanism:** 3 frames vote → tăng accuracy
- **Deduplication:** Không lưu trùng plate trong 10s

---

## 🔄 LUỒNG 4: GHI HÌNH 24/7

**File:** `unified_app/core/recorder/camera_recorder.py` (CameraRecorder)

```
Config:
  recording:
    segment_seconds: 300  # Configurable (default 5 min)

1. CameraRecorder.start()
   ↓
2. Recovery Scan Job (Background Thread):
   - Quét TẤT CẢ date folders (quá khứ + hiện tại)
   - Tìm orphaned mp4 files (chưa move vào subfolder)
   - Tìm processed folders thiếu thumbnail/timelapse
   - Queue xử lý ngay lập tức (đảm bảo không mất video khi crash/restart)
   ↓
3. FFmpeg command:
   ffmpeg -rtsp_transport tcp \
     -i rtsp://localhost:8554/{camera_id} \
     -c:v copy \
     -c:a aac \
     -f segment \
     -segment_time {segment_seconds} \
     -reset_timestamps 1 \
     -strftime 1 \
     recordings/{camera_id}/%Y%m%d/%Y%m%d_%H%M%S.mp4
   ↓
4. Monitor Loop (Mỗi 10s):
   - Quét folder ngày hiện tại
   - Detect new .mp4 files
   - Wait file age > (segment_seconds + 2s)
   - Processing steps:
     a) Move file vào subfolder: 20260116_140000.mp4 → 20260116_140000/
     b) Generate Thumbnail (frame đầu)
     c) Generate Timelapse (video tua nhanh)
     d) Generate Metadata (metadata.json)
   ↓
5. API Listing (Strict Mode):
   - Chỉ trả về recordings ĐÃ HOÀN THIỆN (có thumbnail)
   - Ẩn các file đang recording hoặc đang processing
   - Đảm bảo user không gặp lỗi khi play video chưa sẵn sàng
```

**Tại sao segment 5 phút?**
- File nhỏ dễ tải về
- Nếu FFmpeg crash giữa chừng → chỉ mất tối đa 5 phút
- Frontend pagination dễ hơn

---

## 🔄 LUỒNG 5: TẠO TIMELAPSE

**File:** `unified_app/core/timelapse_manager.py` (TimelapseManager)

```
User config timelapse:
  camera_id: camera-1
  interval_seconds: 5        # mỗi 5s lấy 1 frame
  cycle_seconds: 3600        # mỗi 1 giờ tạo 1 video
  ↓
1. Background thread loop:
   Every interval_seconds (5s):
     - Snapshot từ go2rtc: GET /api/frame.jpeg?src=camera-1
     - Save vào: timelapse/camera-1/frames/frame_YYYYMMDD_HHMMSS.jpg
   ↓
2. Khi đủ cycle_seconds (1 giờ):
   ↓
3. FFmpeg tạo video từ frames:
   ffmpeg -framerate 30 \
     -pattern_type glob \
     -i 'timelapse/camera-1/frames/*.jpg' \
     -c:v libx264 \
     timelapse/camera-1/timelapse_20260116_140000_150000.mp4
   ↓
4. Tạo thumbnail từ frame đầu
   ↓
5. Delete frames cũ
   ↓
6. metadata.json
   {
     "start": "2026-01-16 14:00:00",
     "end": "2026-01-16 15:00:00",
     "frame_count": 720,
     "duration_seconds": 24  # 720 frames / 30 fps
   }
```

**Ứng dụng:**
- Xem lại toàn bộ ngày trong vài phút
- Kiểm tra pattern xe ra vào
- Tiết kiệm băng thông khi xem remote

---

## 🔄 LUỒNG 6: AUTO CLEANUP

**File:** `unified_app/core/cleanup_scheduler.py` (CleanupScheduler)

```
Config trong config.yaml:
  cleanup:
    enabled: true
    recordings_retention_days: 30
    timelapse_retention_days: 90
    schedule: "03:00"  # HH:MM
  ↓
1. Background thread check mỗi 30 giây:
   current_time = datetime.now().strftime("%H:%M")
   if current_time == schedule:
       execute_cleanup()
   ↓
2. execute_cleanup():
   a) Cleanup recordings:
      - Scan recordings/{camera_id}/
      - Delete folders cũ hơn 30 ngày

   b) Cleanup timelapse:
      - Scan timelapse/{camera_id}/
      - Delete files cũ hơn 90 ngày
   ↓
3. Log results:
   - Deleted X recordings (Y MB)
   - Deleted Z timelapse files (W MB)
```

**Broadcast từ Central:**
- Backend-central có global cleanup config
- User update trong frontend SettingsModal
- Central broadcast đến TẤT CẢ NVRs: PUT /api/cleanup/config
- Mỗi NVR tự update config.yaml và reload scheduler

---

## 🔄 LUỒNG 7: FRONTEND XEM RECORDING

**Trigger:** User click thumbnail trong NVRTab

```
1. Frontend: GET /api/cameras/recordings
   Query params:
     - nvr_id=nvr-1
     - camera_id=camera-1
     - date=20260116
     - page=1
     - limit=20
   ↓
2. Backend-central proxy request đến unified_app:
   GET http://192.168.1.100:5000/api/recordings/camera-1?date=20260116&page=1
   ↓
3. Unified_app RecorderManager.list_recordings():
   - Scan recordings/camera-1/20260116/
   - Return list với pagination:
     [
       {
         "path": "camera-1/20260116/20260116_140000/20260116_140000.mp4",
         "start": "2026-01-16 14:00:00",
         "duration": 300,
         "size_mb": 45.2
       },
       ...
     ]
   ↓
4. Frontend hiển thị thumbnails với metadata
   ↓
5. User click video → VideoPlayer opens
   ↓
6. VideoPlayer request video file:
   GET /api/cameras/recordings/video?nvr_id=nvr-1&path=camera-1/20260116/...
   ↓
7. Backend-central proxy to unified_app:
   GET http://192.168.1.100:5000/api/recordings/camera-1/video?path=...
   ↓
8. Unified_app validate path:
   - No ".." (directory traversal)
   - Must start with base_dir
   - File exists check
   ↓
9. Return FileResponse:
   - Support Range requests (HTTP 206)
   - Browser video player có thể seek
```

**Security:**
- Path validation ngăn directory traversal
- Range request support cho seek
- Proxy qua central thay vì expose NVR trực tiếp

---

## 🔑 KHÁI NIỆM QUAN TRỌNG

### 1. go2rtc là BẮT BUỘC

```
Camera (RTSP) → go2rtc (relay) → unified_app
                    ↓
              - Auto reconnect
              - TCP transport
              - Multiple consumers
              - WebRTC cho web
```

**KHÔNG BAO GIỜ connect trực tiếp đến camera.**

### 2. Two-Way Sync

```
go2rtc.yaml     ←→     config.yaml
(stream URLs)         (metadata)
```

- Boot time: go2rtc.yaml → config.yaml
- Add camera: update cả 2 files
- Delete camera: xóa khỏi cả 2 files

### 3. Stream-Only Mode

```
enable_detection: true  → Reader + Detector + OCR (full AI)
enable_detection: false → CHỈ Reader (stream only, no AI)
```

Dùng false khi chỉ cần xem live hoặc ghi hình, không cần AI.

### 4. 3-Thread Architecture

```
Reader  → raw_frame (ghi đè, no queue)
  ↓
Detector → YOLOv8 @ 10 FPS → track candidates
  ↓
OCR → VietOCR voting → SQLite + Central
```

Độc lập nhau, không block.

### 5. Event-Driven UI (Signal/Slot)

```
Backend (Worker) → Signal (ocr_log_added) → frontend (on_ocr_log_added)
```

- **Metadata (Text, Status):** Cập nhật qua **Signal**.
  - *Tại sao?* Tránh ghi đè (overwrite) input của user khi đang nhập liệu (vấn đề polling).
  - Chỉ update khi có dữ liệu MỚI.
- **Video Frames:** Cập nhật qua **Polling/Timer** (200ms) để render hình ảnh mượt mà.

---

## 📁 CẤU TRÚC FILE QUAN TRỌNG

```
unified_app/
├── app.py                          # Entry point
├── config.yaml                     # Config chính
├── go2rtc.yaml                     # go2rtc streams (auto-managed)
├── api/
│   ├── app.py                      # FastAPI setup
│   └── routes/
│       ├── camera_routes.py        # Camera CRUD
│       ├── recording_routes.py     # Recordings list/serve
│       ├── timelapse_routes.py     # Timelapse list/serve
│       └── cleanup_routes.py       # Cleanup config
├── core/
│   ├── camera_manager.py           # Singleton quản lý cameras
│   ├── camera_worker.py            # 3-thread worker
│   ├── recorder/
│   │   ├── camera_recorder.py      # FFmpeg recording
│   │   └── recorder_manager.py     # Multi-recorder manager
│   ├── timelapse_manager.py        # Timelapse generation
│   ├── go2rtc_manager.py           # go2rtc subprocess manager
│   ├── cleanup_scheduler.py        # Auto-delete scheduler
│   ├── ocr_sender.py               # Send OCR to central
│   └── db.py                       # SQLite (ocr_logs)
└── recordings/                     # Recorded videos
    └── {camera_id}/
        └── {YYYYMMDD}/
            └── {YYYYMMDD_HHMMSS}/
```

---

## 🚨 LƯU Ý QUAN TRỌNG

### 1. Memory Management
- OCR queue có thể unbounded → OOM risk
- TimelapseCache dùng LRU eviction (max_size=50)

### 2. Thread Safety
- CameraManager dùng locks cho add/remove
- RecorderManager dùng locks cho start/stop
- Non-daemon threads để graceful shutdown

### 3. Error Handling
- go2rtc failed → retry 20 lần trước khi give up
- FFmpeg crashed → auto restart
- Central unreachable → buffer OCR logs local

### 4. Performance
- Detection FPS configurable (default 10)
- Reader full speed (~25 FPS)
- Recording: copy codec (no re-encode)

---

## 🎯 QUICK REFERENCE

### Start App
```bash
cd unified_app
python app.py
```

### Ports
- FastAPI: **5000**
- go2rtc API: **1984**
- go2rtc RTSP: **8554**

### Key APIs
```bash
# List cameras
GET http://localhost:5000/api/cameras

# Add camera
POST http://localhost:5000/api/cameras
{
  "camera_id": "camera-3",
  "url": "rtsp://192.168.1.103/stream",
  "enable_detection": true,
  "camera_type": "entrance"
}

# List recordings
GET http://localhost:5000/api/recordings/camera-1?date=20260116

# Get video file
GET http://localhost:5000/api/recordings/camera-1/video?path=...
```

---

**END OF CONTEXT**
