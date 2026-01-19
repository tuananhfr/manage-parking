# Hướng Dẫn Check Trạng Thái Thanh Toán

## 1. Check Payment Order Status (By ORDER_ID)

**API Endpoint:**
```
GET http://36.50.54.183:3000/api/payments/order/BILL00104012026
```

**Response khi chưa thanh toán:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "device_id": "DEVICE001",
    "lock_id": "PK001-01",
    "order_number": 1,
    "order_date": "2026-01-05",
    "order_id": "BILL00104012026",
    "description": "Chuyển tiền BILL00104012026 - PK001-01 - 60000",
    "amount": 60000,
    "status": "pending",
    "paid_at": null,
    "created_at": "2026-01-05T10:30:00.000Z",
    "updated_at": "2026-01-05T10:30:00.000Z"
  }
}
```

**Response khi đã thanh toán:**
```json
{
  "success": true,
  "data": {
    ...
    "status": "paid",
    "paid_at": "2026-01-05T10:35:00.000Z",
    ...
  }
}
```

## 2. Check All Payment Orders (Filter)

**API Endpoint:**
```
GET http://36.50.54.183:3000/api/payments/orders?lock_id=PK001-01&status=paid&limit=10
```

**Query Parameters:**
- `lock_id` - Filter by locker (e.g., "PK001-01")
- `device_id` - Filter by device
- `status` - Filter by status ("pending", "paid", "cancelled")
- `order_date` - Filter by date (YYYY-MM-DD)
- `limit` - Limit results (default: 100)
- `offset` - Offset for pagination (default: 0)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "order_id": "BILL00104012026",
      "status": "paid",
      "amount": 60000,
      "paid_at": "2026-01-05T10:35:00.000Z",
      ...
    },
    ...
  ],
  "total": 5
}
```

## 3. Check Payment Statistics

**API Endpoint:**
```
GET http://36.50.54.183:3000/api/payments/statistics/PK001-01?start_date=2026-01-01&end_date=2026-01-31
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total_orders": 25,
    "paid_orders": 20,
    "pending_orders": 5,
    "total_revenue": 1500000
  }
}
```

## 4. Check Webhook Server Status

**Health Check:**
```
GET http://YOUR_VPS_IP:4000/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-01-05T10:30:00.000Z",
  "service": "parking-webhook-server"
}
```

## 5. Test Webhook Locally (Development)

**Simulate Sepay Webhook:**
```bash
curl -X POST http://localhost:4000/api/test-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 60000,
    "content": "CHUYEN TIEN BILL00104012026 - PK001-01 - 60000"
  }'
```

**Response khi thành công:**
```json
{
  "success": true,
  "message": "Test webhook sent successfully",
  "response": {
    "success": true,
    "message": "Payment confirmed and locker unlocked",
    "data": {
      "order_id": "BILL00104012026",
      "amount": 60000,
      "reference": "TEST1704454800000",
      "processing_time_ms": 250
    }
  }
}
```

## 6. Check Logs

### Webhook Server Logs (PM2):
```bash
pm2 logs parking-webhook --lines 50
```

### Backend Logs:
```bash
# If using PM2
pm2 logs parking-locker-backend --lines 50

# Or direct log file
tail -f /path/to/parking-lock/backend/logs/app.log
```

## 7. Common Scenarios & Checks

### Scenario 1: User đã chuyển khoản nhưng lock không mở

**Check 1: Verify webhook đã nhận chưa?**
```bash
pm2 logs parking-webhook | grep "SEPAY WEBHOOK RECEIVED"
```

**Check 2: ORDER_ID có trong database không?**
```bash
curl http://36.50.54.183:3000/api/payments/order/BILL00104012026
```

**Check 3: Payment status là gì?**
- Nếu `status: "pending"` → Webhook chưa xử lý hoặc fail
- Nếu `status: "paid"` → Đã xử lý, có thể lock offline hoặc lỗi TCP

**Check 4: Backend có gửi lệnh DOWN không?**
```bash
tail -f /path/to/backend/logs/app.log | grep "DOWN"
```

### Scenario 2: Webhook bị reject (401 Unauthorized)

**Nguyên nhân:** API Key không khớp

**Fix:**
```bash
# Check .env của webhook server
cat /path/to/parking-webhook/.env | grep SEPAY_WEBHOOK_SECRET

# Phải khớp với API Key đã đăng ký trên Sepay dashboard
```

### Scenario 3: Duplicate webhook

**Log sẽ hiện:**
```
⚠️  Duplicate webhook detected: FT26005XXXXX-60000
```

**Giải thích:** Webhook đã được xử lý rồi, server tự động ignore để tránh double payment.

## 8. Troubleshooting Flowchart

```
User chuyển khoản
  ↓
Sepay có gửi webhook không?
  ├─ Không → Check Sepay dashboard, webhook URL config
  └─ Có
      ↓
Webhook server nhận được không?
  ├─ Không → Check firewall, port 4000 open?
  └─ Có
      ↓
API Key đúng không?
  ├─ Không → 401 Unauthorized, check .env
  └─ Có
      ↓
ORDER_ID extract được không?
  ├─ Không → Check nội dung chuyển khoản có đúng format?
  └─ Có
      ↓
Backend confirm payment thành công?
  ├─ Không → Check backend logs, DB connection
  └─ Có
      ↓
Locker nhận lệnh DOWN không?
  ├─ Không → Check TCP connection, locker online?
  └─ Có → SUCCESS!
```

## 9. Quick Commands Cheat Sheet

```bash
# Check webhook server status
curl http://YOUR_VPS_IP:4000/health

# Check payment order
curl http://36.50.54.183:3000/api/payments/order/BILL00104012026

# Check today's paid orders
curl "http://36.50.54.183:3000/api/payments/orders?status=paid&order_date=$(date +%Y-%m-%d)&limit=50"

# Test webhook
curl -X POST http://localhost:4000/api/test-webhook \
  -H "Content-Type: application/json" \
  -d '{"amount": 60000, "content": "CHUYEN TIEN BILL00104012026 - PK001-01 - 60000"}'

# Watch webhook logs
pm2 logs parking-webhook --lines 100

# Watch backend logs
pm2 logs parking-locker-backend --lines 100
```

## 10. Monitoring & Alerts (Optional - Future)

Để production-ready hơn, nên thêm:

1. **Database query để check pending orders quá lâu:**
```sql
SELECT * FROM payment_orders
WHERE status = 'pending'
  AND created_at < datetime('now', '-10 minutes');
```

2. **Alert khi có failed webhooks:**
Monitor log file cho `❌` errors và gửi alert qua email/Slack.

3. **Dashboard thống kê:**
Tạo admin panel hiển thị:
- Total revenue today
- Pending vs Paid orders
- Failed webhook count
- Average processing time
