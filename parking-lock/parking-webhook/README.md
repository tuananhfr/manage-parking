# Parking Webhook Server

Webhook server để nhận thông báo thanh toán từ Sepay và tự động xử lý mở khóa parking lock.

## Mô tả

Server này đóng vai trò trung gian giữa Sepay và hệ thống parking-locker:

1. **Nhận webhook** từ Sepay khi có giao dịch chuyển khoản
2. **Parse nội dung** chuyển khoản để tìm ORDER_ID (format: `BILL{11 digits}`)
3. **Gọi API** của parking-locker backend để confirm payment
4. **Tự động mở khóa** parking lock sau khi confirm payment thành công

## Cài đặt

### 1. Install dependencies

```bash
cd D:\workspace\drupal-block\parking-lock\parking-webhook
npm install
```

### 2. Cấu hình .env file

Mở file `.env` và cập nhật các thông tin:

```env
PORT=4000
NODE_ENV=production
PARKING_LOCKER_BACKEND_URL=http://localhost:3000
```

**Lưu ý:**
- Khi deploy lên VPS, cập nhật `PARKING_LOCKER_BACKEND_URL` thành IP của parking-locker backend
- Ví dụ: `PARKING_LOCKER_BACKEND_URL=http://36.50.54.183:3000`

### 3. Chạy server

Development mode (với nodemon):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

Server sẽ chạy tại: `http://localhost:4000`

## API Endpoints

### 1. Health Check
**GET** `/health`

Kiểm tra trạng thái server.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-05T10:30:00.000Z",
  "service": "parking-webhook-server"
}
```

### 2. Sepay Webhook
**POST** `/api/sepay-webhook`

Endpoint này được Sepay gọi khi có giao dịch chuyển khoản.

**Request Body (từ Sepay):**
```json
{
  "id": 123456,
  "gateway": "ICB",
  "transactionDate": "2026-01-04 15:30:00",
  "accountNumber": "100873110679",
  "transferAmount": 60000,
  "content": "CHUYEN TIEN BILL00104012026 - PK001-01 - 60000",
  "description": "CHUYEN TIEN BILL00104012026 - PK001-01 - 60000",
  "referenceCode": "FT26004XXXXX"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Payment confirmed and locker unlocked",
  "data": {
    "order_id": "BILL00104012026",
    "amount": 60000,
    "reference": "FT26004XXXXX",
    "backend_response": {
      "success": true,
      "message": "Payment confirmed and locker unlocked"
    }
  }
}
```

### 3. Test Webhook
**POST** `/api/test-webhook`

Endpoint để test webhook locally mà không cần Sepay gửi thật.

**Request Body:**
```json
{
  "amount": 60000,
  "content": "CHUYEN TIEN BILL00104012026 - PK001-01 - 60000"
}
```

**Ví dụ test với curl:**
```bash
curl -X POST http://localhost:4000/api/test-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 60000,
    "content": "CHUYEN TIEN BILL00104012026 - PK001-01 - 60000"
  }'
```

## Cách hoạt động

### Flow xử lý webhook

```
1. Sepay gửi webhook
   ↓
2. Server nhận webhook tại /api/sepay-webhook
   ↓
3. Verify webhook signature (security)
   ↓
4. Validate required fields (content, amount, referenceCode)
   ↓
5. Check duplicate webhook (prevent double processing)
   ↓
6. Extract ORDER_ID từ content (BILL00104012026)
   ↓
7. Gọi API parking-locker backend:
   POST http://localhost:3000/api/payments/confirm
   Body: {
     order_id: "BILL00104012026",
     transaction_id: "FT26004XXXXX",
     amount: 60000,
     note: "Sepay webhook..."
   }
   ↓
8. Backend validates:
   - Payment order exists
   - Not already paid
   - Amount matches (if provided)
   - No duplicate transaction_id
   ↓
9. Backend confirm payment và gửi lệnh DOWN để mở khóa
   ↓
10. Mark webhook as processed (in-memory cache)
   ↓
11. Return 200 OK to Sepay (always!)
```

### Security Features

✅ **API Key Authentication** - Validates Sepay webhook using `Authorization: Apikey YOUR_KEY` header
✅ **Duplicate Detection** - Prevents processing same webhook twice
✅ **Amount Validation** - Ensures received amount matches expected
✅ **Transaction ID Check** - Prevents duplicate transactions
✅ **Transfer Type Filter** - Only processes incoming transfers ("in")
✅ **Always Return 200** - Prevents Sepay retry storms

### Sepay API Key Configuration

Khi đăng ký webhook với Sepay, bạn cần cung cấp một API Key (do bạn tự đặt). Ví dụ: `parking-lock`

Sepay sẽ gửi API Key này trong header của mỗi webhook request:
```
Authorization: Apikey parking-lock
```

Server sẽ verify API Key này với giá trị trong `SEPAY_WEBHOOK_SECRET` environment variable.

### Error Handling

- **Invalid API Key** → Return 401 Unauthorized
- **Missing fields** → Return 200 (log error, don't retry)
- **Duplicate webhook** → Return 200 (already processed)
- **No ORDER_ID found** → Return 200 (not a parking payment)
- **Backend error** → Return 200 (log for manual check)
- **Amount mismatch** → Backend rejects, webhook returns 200

### ORDER_ID Format

Server tìm ORDER_ID trong nội dung chuyển khoản theo pattern:
- Format: `BILL` + 11 chữ số
- Ví dụ: `BILL00104012026`
- Case insensitive: `BILL`, `bill`, hoặc `Bill` đều được

Các format nội dung chuyển khoản hỗ trợ:
- `"CHUYEN TIEN BILL00104012026 - PK001-01 - 60000"`
- `"Chuyển tiền BILL00104012026 - PK001-01 - 60000"`
- `"BILL00104012026"`
- Bất kỳ text nào có chứa `BILL{11 digits}`

## Deploy lên VPS

### 1. Copy files lên VPS

```bash
scp -r D:\workspace\drupal-block\parking-lock\parking-webhook user@your-vps:/path/to/parking-webhook
```

### 2. Cập nhật .env trên VPS

```env
PORT=4000
NODE_ENV=production
PARKING_LOCKER_BACKEND_URL=http://localhost:3000
```

### 3. Install và chạy

```bash
cd /path/to/parking-webhook
npm install
npm start
```

### 4. Chạy với PM2 (recommended)

```bash
npm install -g pm2
pm2 start index.js --name parking-webhook
pm2 startup
pm2 save
```

### 5. Đăng ký webhook với Sepay

Truy cập Sepay dashboard và đăng ký webhook với các thông tin sau:

**Webhook URL:**
```
http://YOUR_VPS_IP:4000/api/sepay-webhook
```
Ví dụ: `http://36.50.54.183:4000/api/sepay-webhook`

**Cấu hình chứng thực:**
- Kiểu chứng thực: `API Key`
- Request Content type: `application/json`
- API Key: `parking-lock` (hoặc bất kỳ key nào bạn muốn)

**Lưu ý:** API Key bạn nhập vào Sepay phải khớp với giá trị `SEPAY_WEBHOOK_SECRET` trong file `.env` của webhook server.

## Logging

Server log tất cả webhook requests với format:

```
[2026-01-05T10:30:00.000Z] POST /api/sepay-webhook

=== SEPAY WEBHOOK RECEIVED ===
Headers: {...}
Body: {...}
✓ ORDER_ID extracted: BILL00104012026
✓ Amount: 60000
✓ Reference: FT26004XXXXX
✓ Payment confirmed successfully
```

## Testing

### Test locally trước khi deploy

1. Chạy parking-locker backend ở port 3000
2. Chạy webhook server:
   ```bash
   npm run dev
   ```
3. Test webhook:
   ```bash
   curl -X POST http://localhost:4000/api/test-webhook \
     -H "Content-Type: application/json" \
     -d '{"amount": 60000, "content": "CHUYEN TIEN BILL00104012026 - PK001-01 - 60000"}'
   ```
4. Kiểm tra logs để xem flow hoạt động

### Test với Sepay sandbox (nếu có)

Nếu Sepay có sandbox environment, sử dụng webhook test tool của họ để gửi test webhook.

## Troubleshooting

### Webhook không nhận được

1. Kiểm tra firewall VPS có mở port 4000
2. Kiểm tra Sepay webhook URL đã đúng chưa
3. Xem logs server để debug

### Backend không confirm được payment

1. Kiểm tra `PARKING_LOCKER_BACKEND_URL` trong .env
2. Kiểm tra parking-locker backend đang chạy
3. Kiểm tra ORDER_ID có tồn tại trong database không
4. Xem logs của cả webhook server và parking-locker backend

### ORDER_ID không extract được

1. Kiểm tra format nội dung chuyển khoản
2. ORDER_ID phải theo format `BILL` + 11 chữ số
3. Xem logs để debug regex matching

## License

ISC
