import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Logger middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/**
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "parking-webhook-server",
  });
});

/**
 * Extract ORDER_ID from transaction description
 * Format: "Chuyển tiền DH00104012026 - PK001-01 - 60000" or "CHUYEN TIEN DH00104012026 - PK001-01 - 60000"
 * Returns: "DH00104012026"
 */
function extractOrderId(description) {
  if (!description) return null;

  // Try to match DH pattern (case insensitive)
  const match = description.match(/DH\d{11}/i);
  if (match) {
    return match[0].toUpperCase();
  }

  return null;
}

/**
 * In-memory cache to track processed webhooks (prevent duplicates)
 * In production, use Redis or database
 */
const processedWebhooks = new Map();

/**
 * Clean up old processed webhooks (older than 1 hour)
 */
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [key, timestamp] of processedWebhooks.entries()) {
    if (timestamp < oneHourAgo) {
      processedWebhooks.delete(key);
    }
  }
}, 5 * 60 * 1000); // Clean every 5 minutes

/**
 * Verify Sepay webhook API Key
 * Sepay sends: Authorization: Apikey YOUR_API_KEY
 */
function verifySepayApiKey(authorizationHeader) {
  const expectedApiKey = process.env.SEPAY_WEBHOOK_SECRET;

  // If no API key configured, skip verification (not recommended for production)
  if (!expectedApiKey) {
    console.warn("⚠️  SEPAY_WEBHOOK_SECRET not configured, skipping API key verification");
    return true;
  }

  if (!authorizationHeader) {
    console.error("❌ Missing Authorization header");
    return false;
  }

  // Expected format: "Apikey YOUR_API_KEY"
  const match = authorizationHeader.match(/^Apikey\s+(.+)$/i);
  if (!match) {
    console.error("❌ Invalid Authorization header format. Expected: 'Apikey YOUR_API_KEY'");
    return false;
  }

  const receivedApiKey = match[1].trim();

  if (receivedApiKey !== expectedApiKey) {
    console.error("❌ API Key mismatch");
    console.error(`Expected: ${expectedApiKey.substring(0, 5)}...`);
    console.error(`Received: ${receivedApiKey.substring(0, 5)}...`);
    return false;
  }

  console.log("✓ API Key verified successfully");
  return true;
}

/**
 * Sepay webhook endpoint
 * POST /api/sepay-webhook
 *
 * Sepay webhook payload example:
 * {
 *   "id": 123456,
 *   "gateway": "ICB",
 *   "transactionDate": "2026-01-04 15:30:00",
 *   "accountNumber": "100873110679",
 *   "subAccount": "",
 *   "transferType": "in",
 *   "transferAmount": 60000,
 *   "accumulated": 1500000,
 *   "code": "XXXX",
 *   "content": "CHUYEN TIEN BILL00104012026 - PK001-01 - 60000",
 *   "description": "CHUYEN TIEN BILL00104012026 - PK001-01 - 60000",
 *   "referenceCode": "FT26004XXXXX",
 *   "body": ""
 * }
 */
app.post("/api/sepay-webhook", async (req, res) => {
  const startTime = Date.now();

  try {
    console.log("\n=== SEPAY WEBHOOK RECEIVED ===");
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log("Headers:", JSON.stringify(req.headers, null, 2));
    console.log("Body:", JSON.stringify(req.body, null, 2));

    const {
      id,
      gateway,
      transactionDate,
      accountNumber,
      transferAmount,
      transferType,
      content,
      description,
      referenceCode,
    } = req.body;

    // 1. Verify Sepay API Key (security check)
    const authorizationHeader = req.headers["authorization"];
    if (!verifySepayApiKey(authorizationHeader)) {
      console.error("❌ Unauthorized webhook request");
      return res.status(401).json({
        success: false,
        message: "Unauthorized - Invalid API Key",
      });
    }

    // 2. Validate required fields
    if (!content && !description) {
      console.error("❌ Missing transaction content/description");
      // Return 200 to prevent Sepay retry, but log error
      return res.status(200).json({
        success: false,
        message: "Missing transaction content",
      });
    }

    if (!transferAmount || !referenceCode) {
      console.error("❌ Missing required fields: transferAmount or referenceCode");
      return res.status(200).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // 3. Check transfer type (must be "in" - incoming transfer)
    if (transferType && transferType !== "in") {
      console.warn(`⚠️  Ignoring non-incoming transfer: ${transferType}`);
      return res.status(200).json({
        success: true,
        message: "Webhook received but transfer type is not 'in'",
      });
    }

    // 4. Check for duplicate webhook using referenceCode
    const webhookKey = `${referenceCode}-${transferAmount}`;
    if (processedWebhooks.has(webhookKey)) {
      console.warn(`⚠️  Duplicate webhook detected: ${webhookKey}`);
      return res.status(200).json({
        success: true,
        message: "Webhook already processed (duplicate)",
        data: { reference: referenceCode },
      });
    }

    // 5. Extract ORDER_ID from content or description
    const transactionContent = content || description;
    const orderId = extractOrderId(transactionContent);

    if (!orderId) {
      console.warn(`⚠️  No ORDER_ID found in: "${transactionContent}"`);
      return res.status(200).json({
        success: true,
        message: "Webhook received but no ORDER_ID found",
        data: { content: transactionContent },
      });
    }

    console.log(`✓ ORDER_ID extracted: ${orderId}`);
    console.log(`✓ Amount: ${transferAmount} VND`);
    console.log(`✓ Reference: ${referenceCode}`);
    console.log(`✓ Transaction Date: ${transactionDate}`);
    console.log(`✓ Gateway: ${gateway}`);

    // 6. Get parking-locker backend URL from environment
    const backendUrl = process.env.PARKING_LOCKER_BACKEND_URL || "http://localhost:3000";

    // 7. Call parking-locker backend to confirm payment
    try {
      const confirmResponse = await axios.post(
        `${backendUrl}/api/payments/confirm`,
        {
          order_id: orderId,
          transaction_id: referenceCode,
          amount: transferAmount, // Send amount for backend validation
          note: `Sepay webhook: ${transactionContent} (Ref: ${referenceCode})`,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000, // 10s timeout
        }
      );

      console.log("✓ Payment confirmed successfully");
      console.log("Backend response:", JSON.stringify(confirmResponse.data, null, 2));

      // 8. Mark webhook as processed (prevent duplicates)
      processedWebhooks.set(webhookKey, Date.now());

      const processingTime = Date.now() - startTime;
      console.log(`✓ Total processing time: ${processingTime}ms`);

      // Always return 200 to Sepay
      return res.status(200).json({
        success: true,
        message: "Payment confirmed and locker unlocked",
        data: {
          order_id: orderId,
          amount: transferAmount,
          reference: referenceCode,
          transaction_date: transactionDate,
          processing_time_ms: processingTime,
          backend_response: confirmResponse.data,
        },
      });

    } catch (backendError) {
      console.error("❌ Error confirming payment with backend:", backendError.message);

      if (backendError.response) {
        console.error("Backend status:", backendError.response.status);
        console.error("Backend response:", backendError.response.data);

        // If backend says payment already processed or order not found, mark as processed
        const backendMessage = backendError.response.data?.message || "";
        if (
          backendMessage.includes("already paid") ||
          backendMessage.includes("Payment order not found")
        ) {
          processedWebhooks.set(webhookKey, Date.now());
        }
      }

      // Still return 200 to Sepay so they don't retry
      // Log error for manual investigation
      return res.status(200).json({
        success: false,
        message: "Webhook received but failed to confirm payment",
        error: backendError.response?.data?.message || backendError.message,
        data: {
          order_id: orderId,
          amount: transferAmount,
          reference: referenceCode,
          requires_manual_check: true,
        },
      });
    }

  } catch (error) {
    console.error("❌ Webhook processing error:", error);

    // Always return 200 to Sepay to prevent retries
    return res.status(200).json({
      success: false,
      message: "Internal error processing webhook",
      error: error.message,
    });
  }
});

/**
 * Test endpoint to simulate Sepay webhook
 * POST /api/test-webhook
 */
app.post("/api/test-webhook", async (req, res) => {
  console.log("\n=== TEST WEBHOOK ===");

  const testPayload = {
    id: 999999,
    gateway: "ICB",
    transactionDate: new Date().toISOString().replace("T", " ").substring(0, 19),
    accountNumber: "100873110679",
    subAccount: "",
    transferType: "in",
    transferAmount: req.body.amount || 60000,
    accumulated: 1500000,
    code: "TEST",
    content: req.body.content || "CHUYEN TIEN BILL00104012026 - PK001-01 - 60000",
    description: req.body.content || "CHUYEN TIEN BILL00104012026 - PK001-01 - 60000",
    referenceCode: "TEST" + Date.now(),
    body: "",
  };

  console.log("Simulating webhook with payload:", testPayload);

  // Forward to actual webhook handler
  try {
    const apiKey = process.env.SEPAY_WEBHOOK_SECRET || "parking-lock";
    const response = await axios.post(
      `http://localhost:${PORT}/api/sepay-webhook`,
      testPayload,
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Apikey ${apiKey}`,
        },
      }
    );

    res.json({
      success: true,
      message: "Test webhook sent successfully",
      response: response.data,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Test webhook failed",
      error: error.message,
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found",
    path: req.path,
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: err.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log("\n========================================");
  console.log(`🚀 Parking Webhook Server Running`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔗 Backend URL: ${process.env.PARKING_LOCKER_BACKEND_URL || "http://localhost:3000"}`);
  console.log(`📍 Webhook Endpoint: http://localhost:${PORT}/api/sepay-webhook`);
  console.log(`🧪 Test Endpoint: http://localhost:${PORT}/api/test-webhook`);
  console.log(`💚 Health Check: http://localhost:${PORT}/health`);
  console.log("========================================\n");
});
