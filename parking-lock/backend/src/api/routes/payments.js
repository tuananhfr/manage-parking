import express from "express";
import * as paymentController from "../controllers/payment-controller.js";

const router = express.Router();

// Generate payment QR for a locker
router.get("/generate/:lock_id", paymentController.generatePaymentQR);

// Get payment order by ORDER_ID
router.get("/order/:order_id", paymentController.getPaymentOrder);

// Get all payment orders (with filters)
router.get("/orders", paymentController.getPaymentOrders);

// Confirm payment (webhook or POS)
router.post("/confirm", paymentController.confirmPayment);

// Get payment statistics for a locker
router.get("/statistics/:lock_id", paymentController.getPaymentStatistics);

// Get overall payment statistics (all lockers)
router.get("/statistics/overall", paymentController.getOverallStatistics);

// Get payment history with advanced filters and search
router.get("/history", paymentController.getPaymentHistory);

// Get parking sessions (vé lẻ và vé tháng)
router.get("/sessions", paymentController.getParkingSessions);

// Get parking session statistics
router.get(
  "/sessions/statistics",
  paymentController.getParkingSessionStatistics
);

export default router;
