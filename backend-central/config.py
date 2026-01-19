"""
Central Server Configuration
"""
import os

# SERVER
SERVER_HOST = "0.0.0.0"
SERVER_PORT = 8000

# DATABASE
# SQLite database (tong hop tu tat ca cameras)
DB_FILE = "data/central.db"

# CAMERA REGISTRY
# Timeout de danh dau camera offline (giay)
CAMERA_HEARTBEAT_TIMEOUT = 60  # 60s khong nhan heartbeat → offline


# STAFF MANAGEMENT
# API endpoint de lay danh sach nguoi truc (de trong se dung file JSON local)
STAFF_API_URL = os.getenv("STAFF_API_URL", "https://paristechno.vn/api/v1/shift?_format=json")  # Ví dụ: "https://api.example.com/staff"
STAFF_JSON_FILE = "data/staff.json"  # File JSON local mặc định

# SUBSCRIPTION MANAGEMENT
# API endpoint de lay danh sach thue bao (de trong se dung file JSON local)
SUBSCRIPTION_API_URL = os.getenv("SUBSCRIPTION_API_URL", "")  # Ví dụ: "https://api.example.com/subscriptions"
SUBSCRIPTION_JSON_FILE = "data/subscriptions.json"  # File JSON local mặc định

# REPORT MANAGEMENT
# URL để PATCH báo cáo lên Drupal (ví dụ: https://paristechno.vn/node/131?_format=json)
REPORT_API_URL = os.getenv("REPORT_API_URL", "https://paristechno.vn/node?_format=json")



# BANK ACCOUNT MANAGEMENT (for VietQR integration)
# Thong tin tai khoan ngan hang de nhan thanh toan
BANK_ACCOUNT_NUMBER = os.getenv("BANK_ACCOUNT_NUMBER", "100873110679")
BANK_ACCOUNT_NAME = os.getenv("BANK_ACCOUNT_NAME", "NGUYEN VIET QUAN")
BANK_NAME = os.getenv("BANK_NAME", "Ngân hàng TMCP Công thương Việt Nam")
BANK_CODE = os.getenv("BANK_CODE", "ICB")
DESCRIPTION_PREFIX = os.getenv("DESCRIPTION_PREFIX", "Chuyển tiền cho")

# CENTRAL SERVER CONFIG
# IP/URL cua may chu central hien tai
CENTRAL_SERVER_IP = os.getenv("CENTRAL_SERVER_IP", "192.168.1.104")  # Ví dụ: "http://192.168.1.100:8000"
# Danh sach IP/URL cac may chu central khac de dong bo du lieu (JSON string hoac list)
CENTRAL_SYNC_SERVERS = os.getenv("CENTRAL_SYNC_SERVERS", "[]")  # Ví dụ: '["http://192.168.1.101:8000", "http://192.168.1.102:8000"]'

# EDGE CAMERA ROUTING
# Mapping camera_id -> Edge backend URL de proxy WebRTC
# Dien URL thuc te thong qua bien moi truong (khuyen nghi) hoac chinh truc tiep.
EDGE_CAMERAS = {
}
