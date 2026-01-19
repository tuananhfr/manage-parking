import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file
dotenv.config({ path: path.join(process.cwd(), ".env") });

const config = {
  // Environment
  nodeEnv: process.env.NODE_ENV || "development",
  isDevelopment: process.env.NODE_ENV === "development",
  isProduction: process.env.NODE_ENV === "production",

  // Server
  host: process.env.HOST || "0.0.0.0", // 0.0.0.0 để nhận kết nối từ mọi IP (IP public)
  port: parseInt(process.env.PORT || "3000", 10),
  tcpPort: parseInt(process.env.TCP_PORT || "8888", 10),

  // Database
  dbPath:
    process.env.DB_PATH || path.join(process.cwd(), "data", "parking_lock.db"),

  // AES Encryption
  aes: {
    key: process.env.AES_KEY || "AAAAAAAAAAAAAAAAAAAAAA==",
    iv: process.env.AES_IV || "BBBBBBBBBBBBBBBBBBBBBB==",
  },

  // Heartbeat
  heartbeat: {
    timeout: parseInt(process.env.HEARTBEAT_TIMEOUT || "60", 10),
    interval: parseInt(process.env.HEARTBEAT_INTERVAL || "30", 10),
  },

  // Command
  command: {
    timeout: parseInt(process.env.COMMAND_TIMEOUT || "10", 10),
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: process.env.LOG_FILE || "./logs/app.log",
  },

  // VietQR (dùng để tạo mã thanh toán)
  vietqr: {
    baseUrl: process.env.VIETQR_URL || "https://api.vietqr.io/v2/generate",
    bankUrl: process.env.VIETQR_BANK_URL || "https://api.vietqr.io/v2/banks",
    clientId: process.env.VIETQR_CLIENT_ID || "",
    apiKey: process.env.VIETQR_API_KEY || "",
    accountNumber: process.env.VIETQR_ACCOUNT_NO || "",
    accountName: process.env.VIETQR_ACCOUNT_NAME || "",
    acqId: process.env.VIETQR_ACQ_ID || "970415", // mã ngân hàng (VD: 970415 cho VCB)
    template: process.env.VIETQR_TEMPLATE || "compact",
  },

  // Sepay (dùng để check biến động và webhook)
  sepay: {
    baseUrl: process.env.SEPAY_URL || "https://api.sepay.vn",
    apiKey: process.env.SEPAY_API_KEY || "",
    apiSecret: process.env.SEPAY_API_SECRET || "",
    webhookSecret: process.env.SEPAY_WEBHOOK_SECRET || "",
    // Webhook URL sẽ là: http://YOUR_IP:PORT/api/payments/sepay-webhook
    // Ví dụ: http://36.50.54.183:3000/api/payments/sepay-webhook
  },
};

export default config;
