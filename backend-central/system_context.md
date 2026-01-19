# Backend Central - Tài liệu Kiến trúc Hệ thống

> **Mục đích**: Tài liệu toàn diện để AI coding assistants (Claude, Cursor, v.v.) hiểu hệ thống mà không cần đọc từng file code.

---

## 1. Tổng quan Hệ thống

**Backend Central** là server FastAPI đóng vai trò trung tâm của hệ thống bãi xe thông minh:
- **Tổng hợp sự kiện**: Nhận events xe vào/ra từ AI Cameras (Edge servers)
- **Cổng Proxy**: Chuyển tiếp lệnh điều khiển đến các Parking Lock backends
- **Node P2P**: Đồng bộ dữ liệu với các Central khác trong cluster
- **Tạo báo cáo**: Gửi dữ liệu tổng hợp lên Drupal CMS

### Công nghệ sử dụng
- **Framework**: FastAPI (Python 3.10+)
- **Database**: SQLite (`data/central.db`)
- **Real-time**: WebSocket để cập nhật frontend
- **APIs bên ngoài**: Drupal (CMS), VietQR (thanh toán)

---

## 2. Cấu trúc File & Chức năng

### Các file chính

| File | Số dòng | Chức năng |
|------|---------|-----------|
| `app.py` | 3075 | **Điểm vào**. FastAPI app, xử lý WebSocket, nhận event từ Edge, khởi tạo P2P |
| `database.py` | 900 | **SQLite wrapper**. Các bảng: `history`, `events`, `cameras`, `history_changes`, `parking_lots` |
| `config.py` | 54 | **Cấu hình môi trường**. Port server, đường dẫn DB, URLs API, thông tin ngân hàng |
| `auth.py` | 178 | **Xác thực JWT**. Tạo/kiểm tra token, mã hóa mật khẩu bcrypt |
| `config_manager.py` | 259 | **Cấu hình động**. Đọc/ghi `config.py` bằng code |
| `parking_state.py` | 256 | **Máy trạng thái**. Xử lý logic XE VÀO/RA, tính thời lượng, kiểm tra thuê bao |
| `camera_registry.py` | 87 | **Theo dõi heartbeat**. Đánh dấu camera online/offline |
| `edge_api.py` | 114 | **API nhận phát hiện từ Edge**. Validate biển số từ edge servers |
| `p2p_api.py` | 623 | **API quản lý P2P**. Config, status, đăng ký peer |

### Thư mục Routes (`routes/`)

| File | Số dòng | Prefix | Chức năng |
|------|---------|--------|-----------|
| `auth_routes.py` | 619 | `/api/auth` | Đăng nhập/xuất, quản lý ca trực, đồng bộ session Drupal |
| `camera_routes.py` | 836 | `/api/cameras` | CRUD camera, proxy recordings, upload lên Drupal |
| `nvr_routes.py` | 437 | `/api/nvr/servers` | Quản lý NVR servers, cấu hình dọn dẹp |
| `timelapse_routes.py` | 572 | `/api/timelapse` | Cấu hình/proxy video timelapse |
| `parking_backend_routes.py` | 132 | `/api/parking/backends` | CRUD danh sách parking lock backends |
| `bank_account_routes.py` | 194 | `/api/bank-account` | Tích hợp VietQR, tạo mã QR thanh toán |
| `parking_lock_proxy_routes.py` | 956 | `/api/parking-lock` | **Quan trọng**: Proxy đến hardware backends |
| `report_routes.py` | 644 | `/api/reports` | Gửi báo cáo lên Drupal |

### Thư mục P2P (`p2p/`)

| File | Chức năng |
|------|-----------|
| `manager.py` | Quản lý kết nối P2P, định tuyến message |
| `client.py` | WebSocket client kết nối đến peers |
| `server.py` | WebSocket server nhận kết nối từ peers |
| `protocol.py` | Định dạng message |
| `event_handler.py` | Xử lý events P2P đến |
| `sync_manager.py` | Logic đồng bộ dữ liệu |
| `parking_integration.py` | Broadcast events parking đến peers |
| `config_loader.py` | Load cấu hình P2P từ JSON |
| `database_extensions.py` | Thêm methods DB liên quan sync |

### Các file dữ liệu

| File | Chức năng |
|------|-----------|
| `parking.backends.json` | Danh sách parking lock backend servers |
| `nvr.servers.json` | Danh sách NVR (máy ghi hình) servers |
| `data/users.json` | Tài khoản nhân viên với mật khẩu bcrypt |
| `data/work_logs.json` | Lịch sử ca trực với thống kê |
| `data/subscriptions.json` | Danh sách biển số thuê bao (xe tháng) |
| `data/drupal_session.json` | Cookies đăng nhập Drupal đã lưu |
| `data/parking_lock_reports.json` | Bản sao báo cáo |
| `config/p2p_config.json` | Cấu hình các peer P2P |

---

## 3. Cấu trúc Database (`database.py`)

### Bảng: `history` (Dữ liệu chính)
```
id, event_id, source_central, edge_id,
plate_id, plate_view,
entry_time, entry_camera_id, entry_camera_name, entry_confidence, entry_source, entry_camera_type,
exit_time, exit_camera_id, exit_camera_name, exit_confidence, exit_source, exit_camera_type,
duration, status ('IN'|'OUT'),
last_location, last_location_time, last_location_camera_type,
is_anomaly, customer_type ('guest'|'subscription'),
sync_status, created_at, updated_at
```

### Bảng: `events` (Log thô)
```
id, event_type, camera_id, camera_name, camera_type, plate_text, confidence, source, timestamp, data
```

### Bảng: `cameras` (Đăng ký camera)
```
id, name, type, status, last_heartbeat, events_sent, events_failed, created_at, updated_at
```

### Bảng: `history_changes` (Log thay đổi)
```
id, history_id, change_type, old_plate_id, old_plate_view, new_plate_id, new_plate_view, old_data, new_data, changed_at, changed_by
```

### Bảng: `parking_lots` (Cấu hình khu vực)
```
id, location_name, capacity, camera_id, camera_type, edge_id, created_at, updated_at
```

**⚠️ QUAN TRỌNG**: `database.py` KHÔNG lưu dữ liệu thanh toán. Tiền/phí được lưu trong Parking Lock backends và lấy qua proxy.

---

## 4. Các API Endpoints Chính

### Xác thực (`auth_routes.py`)
| Method | Endpoint | Chức năng |
|--------|----------|-----------|
| POST | `/api/auth/login` | Đăng nhập, trả về JWT + đồng bộ Drupal |
| POST | `/api/auth/logout` | Kết thúc ca, tính thống kê, lưu bàn giao |
| GET | `/api/auth/me` | Lấy thông tin user hiện tại |
| GET | `/api/auth/work-logs` | Lấy lịch sử ca trực |
| GET | `/api/auth/current-stats` | Tính thống kê ca hiện tại |

### Proxy Parking Lock (`parking_lock_proxy_routes.py`)
| Method | Endpoint | Chức năng |
|--------|----------|-----------|
| GET | `/api/parking-lock/{backend_id}/devices` | Danh sách devices từ backend |
| GET | `/api/parking-lock/{backend_id}/lockers` | Danh sách lockers với filters |
| POST | `/api/parking-lock/{backend_id}/lockers/{lock_id}/control` | Điều khiển khóa (mở/đóng) |
| GET | `/api/parking-lock/lockers` | **Tổng hợp** lockers từ TẤT CẢ backends |
| GET | `/api/parking-lock/payments/history` | Lịch sử giao dịch thanh toán |
| GET | `/api/parking-lock/payments/sessions` | Phiên gửi xe với chi tiết đầy đủ |
| GET | `/api/parking-lock/payments/stats` | Thống kê doanh thu |
| GET | `/api/parking-lock/global-config` | Lấy cấu hình giá/thời gian toàn cục |
| POST | `/api/parking-lock/global-config` | Áp dụng cài đặt cho TẤT CẢ lockers |

### Báo cáo (`report_routes.py`)
| Method | Endpoint | Chức năng |
|--------|----------|-----------|
| POST | `/api/reports/send-today` | Gửi báo cáo lưu lượng xe lên Drupal |
| POST | `/api/reports/send-shift/{log_id}` | Gửi báo cáo ca trực cụ thể |
| POST | `/api/reports/send-today-shifts` | Gửi tất cả ca trực hôm nay |
| POST | `/api/reports/send-parking-lock-today` | Gửi báo cáo parking lock với chi tiết sessions |

### Events từ Edge (`app.py`)
| Method | Endpoint | Chức năng |
|--------|----------|-----------|
| POST | `/api/edge/event` | Nhận phát hiện từ AI camera |
| POST | `/api/edge/heartbeat` | Camera heartbeat |
| WS | `/ws/history` | Cập nhật lịch sử real-time |
| WS | `/ws/cameras` | Cập nhật trạng thái camera real-time |

---

## 5. Các Luồng Logic

### A. Luồng Xe Vào/Ra
```
1. AI Camera (Edge) → POST /api/edge/event → app.py
2. app.py → parking_state.process_edge_event()
3. parking_state → database.add_vehicle_entry() hoặc update_vehicle_exit()
4. Broadcast đến:
   - Frontend (WebSocket /ws/history)
   - P2P Peers (p2p_broadcaster)
   - Edge backends (để đồng bộ)
```

### B. Luồng Điều khiển Khóa Parking
```
1. Frontend → POST /api/parking-lock/{backend}/lockers/{id}/control
2. parking_lock_proxy_routes.py → proxy_request()
3. HTTP đến Parking Backend → http://{host}:{port}/api/lockers/{id}/control
4. Backend thực thi lệnh → Trả response về Frontend
```

### C. Luồng Tổng hợp Doanh thu
```
1. report_routes.send_parking_lock_today_report()
2. → parking_lock_proxy_routes.get_detailed_report_data()
3. Với mỗi backend được bật:
   - Fetch /api/lockers?connected=true
   - Fetch /api/payments/sessions?start_date=...&end_date=...
4. Xây dựng cấu trúc: Backend → Device → Locker → session_list[]
5. Lưu bản sao vào data/parking_lock_reports.json
6. PATCH lên Drupal node với field_parking_lock_report
```

### D. Luồng Ca trực
```
1. Đăng nhập → auth_routes.start_work_session() → lưu vào work_logs.json
2. Trong ca → thống kê được tính động từ database.get_history()
3. Đăng xuất → auth_routes.end_work_session():
   - Tính thống kê cuối (vehicles_in, vehicles_out, revenue)
   - Lấy chi tiết history trong khoảng thời gian
   - Lưu vào work_logs.json với status='completed'
```

---

## 6. Tham chiếu Cấu hình

### Biến trong `config.py`
| Biến | Mặc định | Chức năng |
|------|----------|-----------|
| `SERVER_PORT` | 8000 | Port API |
| `DB_FILE` | `data/central.db` | Đường dẫn SQLite |
| `CAMERA_HEARTBEAT_TIMEOUT` | 60 | Số giây trước khi đánh dấu offline |
| `STAFF_API_URL` | `https://paristechno.vn/api/v1/shift` | Endpoint lấy nhân viên từ Drupal |
| `REPORT_API_URL` | `https://paristechno.vn/node/131?_format=json` | Node Drupal để gửi báo cáo |
| `BANK_ACCOUNT_NUMBER` | - | Số tài khoản cho VietQR |
| `EDGE_CAMERAS` | `{}` | Mapping Camera ID → Edge server URL |

### Cấu trúc `parking.backends.json`
```json
[
  {
    "id": "backend-1",
    "name": "Khu A",
    "host": "192.168.1.50",
    "port": 8000,
    "enabled": true
  }
]
```

---

## 7. Tham chiếu Hàm Quan trọng

### `parking_state.py`
- `process_edge_event(event_type, camera_id, ...)` → Điểm vào chính
- `_process_entry()` → Tạo record history, kiểm tra trùng lặp
- `_process_exit()` → Tìm entry tương ứng, tính duration
- `_check_subscription(plate_id)` → Trả về 'subscription' hoặc 'guest'

### `parking_lock_proxy_routes.py`
- `proxy_request(backend_id, method, endpoint, ...)` → HTTP proxy tổng quát
- `get_all_lockers(...)` → Tổng hợp từ tất cả backends
- `get_detailed_report_data(start_date, end_date)` → Xây dựng báo cáo phân cấp
- `get_all_payment_stats(...)` → Tổng hợp doanh thu/sessions

### `database.py`
- `add_vehicle_entry(...)` → INSERT vào history
- `update_vehicle_exit(...)` → UPDATE history với thông tin ra
- `find_vehicle_in_parking(plate_id)` → Tìm entry đang active
- `get_history(...)` → Query với filters (ngày, tìm kiếm, trạng thái)
- `get_history_changes(...)` → Query log thay đổi
- `update_history_entry()` → Sửa biển số + ghi log thay đổi

---

## 8. Tích hợp Bên ngoài

### Drupal CMS
- **Xác thực**: Cookies được lưu sau đăng nhập vào `data/drupal_session.json`
- **Báo cáo**: PATCH đến `/node/{id}?_format=json` với các fields:
  - `field_traffic_flow_report` (số lượng xe)
  - `field_shift_report` (chi tiết ca trực)
  - `field_parking_lock_report` (sessions parking lock)
- **Đồng bộ nhân viên**: GET từ `STAFF_API_URL`, lưu vào `data/staff.json`

### Parking Lock Backends
- **Giao thức**: HTTP REST
- **Base URL**: `http://{host}:{port}`
- **Endpoints chính**:
  - `/api/devices` - Danh sách devices
  - `/api/lockers` - Danh sách/điều khiển khóa
  - `/api/payments/sessions` - Lịch sử sessions với phí
  - `/api/config` - Cài đặt device

### VietQR
- **Danh sách ngân hàng**: `https://api.vietqr.io/v2/banks`
- **Tạo QR**: `https://img.vietqr.io/image/{BANK_CODE}-{ACCOUNT}-compact.jpg?amount=...`

---

## 9. Định dạng WebSocket Events

### `/ws/history`
```json
{
  "type": "history_update",
  "data": {
    "event_type": "ENTRY|EXIT",
    "plate_id": "30G56789",
    "plate_view": "30G-567.89",
    ...
  }
}
```

### `/ws/cameras`
```json
{
  "type": "cameras_update",
  "data": {
    "cameras": [...],
    "total": 4,
    "online": 2,
    "offline": 2
  }
}
```

---

## 10. Lưu ý Quan trọng khi Phát triển

1. **Không lưu Thanh toán**: Central không lưu phí. Luôn fetch từ parking backends.

2. **Bản sao Báo cáo**: Báo cáo được lưu vào JSON trước khi gửi Drupal (backup an toàn).

3. **Filter Connected**: Khi fetch lockers cho báo cáo, luôn dùng `connected=true` để khớp với frontend.

4. **Xử lý Thời gian**: Database dùng chuỗi thời gian local (`YYYY-MM-DD HH:MM:SS`), không phải UTC.

5. **P2P Sync**: Events tạo local có `sync_status='LOCAL'`, events đồng bộ có `'P2P'`.

6. **Heartbeat**: Camera bị đánh dấu offline sau 60 giây không có heartbeat.

7. **Ca trực**: Thống kê được tính động dựa trên `start_time` và `end_time` để query history.
