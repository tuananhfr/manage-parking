import * as paymentService from "../../services/payment-service.js";
import * as lockerService from "../../services/locker-service.js";
import * as parkingSessionService from "../../services/parking-session-service.js";
import { calculateParkingFee } from "./locker-controller.js";
import logger from "../../utils/logger.js";
import axios from "axios";
import { getEventEmitter } from "../../websocket/socket-server.js";
import { sendLockControl } from "../../tcp-server/command-sender.js";
import { isDeviceConnected } from "../../tcp-server/connection-manager.js";
import { LockControlMode } from "../../utils/constants.js";
import { clearAutoLockTimer } from "../../services/auto-lock-timer-service.js";

/**
 * Generate payment QR code for a locker
 * GET /api/payments/generate/:lock_id
 */
export async function generatePaymentQR(req, res, next) {
  try {
    const { lock_id } = req.params;

    // Get locker info
    const locker = lockerService.getLockerById(lock_id);
    if (!locker) {
      return res.status(404).json({
        success: false,
        message: "Locker not found",
      });
    }

    // Validate locker is occupied and has parking fee
    if (!locker.occupied) {
      return res.status(400).json({
        success: false,
        message: "Locker is not occupied. No payment needed.",
      });
    }

    // Calculate parking fee using the same logic as locker-controller
    const amount = calculateParkingFee(locker);

    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "No parking fee to pay",
      });
    }

    // Get bank account info
    let bankAccount;

    // TODO: Uncomment this when central backend is accessible
    // const centralUrl = process.env.CENTRAL_BACKEND_URL || "http://localhost:5000";
    // try {
    //   const response = await axios.get(`${centralUrl}/api/bank-account/info`);
    //   if (!response.data.success || !response.data.configured) {
    //     return res.status(500).json({
    //       success: false,
    //       message: "Bank account not configured on central backend"
    //     });
    //   }
    //   bankAccount = response.data.data;
    // } catch (error) {
    //   logger.error("Error fetching bank account info:", error.message);
    //   return res.status(500).json({
    //     success: false,
    //     message: "Failed to fetch bank account configuration"
    //   });
    // }

    // TEMPORARY: Get bank account from environment variables (for dev/testing)
    const accountNumber = process.env.BANK_ACCOUNT_NUMBER || "100873110679";
    const accountName = process.env.BANK_ACCOUNT_NAME || "NGUYEN VIET QUAN";
    const bankName =
      process.env.BANK_NAME || "Ngân hàng TMCP Công thương Việt Nam";
    const bankCode = process.env.BANK_CODE || "ICB";
    const descriptionPrefix = process.env.DESCRIPTION_PREFIX || "Chuyển tiền";

    if (!accountNumber || !bankCode) {
      return res.status(500).json({
        success: false,
        message:
          "Bank account not configured. Please set BANK_ACCOUNT_NUMBER and BANK_CODE environment variables.",
      });
    }

    bankAccount = {
      account_number: accountNumber,
      account_name: accountName,
      bank_name: bankName,
      bank_code: bankCode,
      description_prefix: descriptionPrefix,
    };

    // Calculate parking details
    const carEnterTime = locker.last_action_time; // Time when car entered
    const freeTimeMinutes = locker.lock_free_time
      ? Math.floor(locker.lock_free_time / 60)
      : 0;
    const hourlyRate = locker.hourly_rate || 0;

    // Calculate durations
    let parkingDuration = 0;
    let billingDuration = 0;

    if (carEnterTime) {
      const now = new Date();
      const enterTime = new Date(carEnterTime);
      parkingDuration = Math.floor((now - enterTime) / 1000 / 60); // minutes

      // Calculate billing duration (parking duration - free time)
      const freeTimeSeconds = locker.lock_free_time || 0;
      const billingStart = new Date(
        enterTime.getTime() + freeTimeSeconds * 1000
      );
      if (now > billingStart) {
        billingDuration = Math.floor((now - billingStart) / 1000 / 60); // minutes
      }
    }

    // Generate ORDER_ID with parking details
    const paymentOrder = paymentService.generateOrderId(
      locker.device_id,
      lock_id,
      amount,
      {
        car_enter_time: carEnterTime,
        parking_duration: parkingDuration,
        billing_duration: billingDuration,
        free_time_minutes: freeTimeMinutes,
        hourly_rate: hourlyRate,
      }
    );

    // Build Sepay QR URL
    // Use URL encoding for description to handle special characters
    const qrCodeUrl = `https://qr.sepay.vn/img?acc=${
      bankAccount.account_number
    }&bank=${bankAccount.bank_code}&amount=${amount}&des=${encodeURIComponent(
      paymentOrder.description
    )}`;

    // Return payment info
    res.json({
      success: true,
      data: {
        order_id: paymentOrder.order_id,
        lock_id: lock_id,
        lock_name: locker.name || lock_id,
        device_id: locker.device_id,
        amount: amount,
        description: paymentOrder.description,
        bank_account: {
          account_number: bankAccount.account_number,
          account_name: bankAccount.account_name,
          bank_name: bankAccount.bank_name,
          bank_code: bankAccount.bank_code,
        },
        qr_code_url: qrCodeUrl,
        created_at: paymentOrder.created_at,
      },
    });
  } catch (error) {
    logger.error("Error generating payment QR:", error);
    next(error);
  }
}

/**
 * Get payment order by ORDER_ID
 * GET /api/payments/order/:order_id
 */
export async function getPaymentOrder(req, res, next) {
  try {
    const { order_id } = req.params;

    const order = paymentService.getPaymentOrderById(order_id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Payment order not found",
      });
    }

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    logger.error("Error getting payment order:", error);
    next(error);
  }
}

/**
 * Get all payment orders with filters
 * GET /api/payments/orders
 */
export async function getPaymentOrders(req, res, next) {
  try {
    const { lock_id, device_id, status, order_date, limit, offset } = req.query;

    const filters = {
      lock_id,
      device_id,
      status,
      order_date,
      limit: parseInt(limit) || 100,
      offset: parseInt(offset) || 0,
    };

    const orders = paymentService.getPaymentOrders(filters);

    res.json({
      success: true,
      data: orders,
      total: orders.length,
    });
  } catch (error) {
    logger.error("Error getting payment orders:", error);
    next(error);
  }
}

/**
 * Confirm payment (called by webhook or POS)
 * POST /api/payments/confirm
 *
 * Body: {
 *   order_id: string (required),
 *   transaction_id: string (optional),
 *   amount: number (optional - for webhook validation),
 *   note: string (optional)
 * }
 */
export async function confirmPayment(req, res, next) {
  try {
    const { order_id, transaction_id, amount, note } = req.body;

    if (!order_id) {
      return res.status(400).json({
        success: false,
        message: "order_id is required",
      });
    }

    // Get payment order
    const order = paymentService.getPaymentOrderById(order_id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Payment order not found",
      });
    }

    // Check if already paid
    if (order.status === "paid") {
      logger.warn(`Payment order ${order_id} already paid`);
      return res.status(400).json({
        success: false,
        message: "Payment order already paid",
      });
    }

    // Validate amount if provided (for webhook calls)
    if (amount !== undefined && amount !== null) {
      const expectedAmount = parseInt(order.amount);
      const receivedAmount = parseInt(amount);

      if (receivedAmount !== expectedAmount) {
        logger.error(
          `Amount mismatch for order ${order_id}: expected ${expectedAmount}, received ${receivedAmount}`
        );
        return res.status(400).json({
          success: false,
          message: "Amount mismatch",
          data: {
            expected: expectedAmount,
            received: receivedAmount,
          },
        });
      }

      logger.info(
        `Amount validated for order ${order_id}: ${receivedAmount} VND`
      );
    }

    // Check for duplicate transaction_id
    if (transaction_id) {
      const existingOrder =
        paymentService.getPaymentOrderByTransactionId(transaction_id);
      if (existingOrder && existingOrder.order_id !== order_id) {
        logger.warn(
          `Duplicate transaction_id ${transaction_id} found for different order`
        );
        return res.status(400).json({
          success: false,
          message: "Duplicate transaction ID",
        });
      }
    }

    // Update payment order status (use Vietnam timezone)
    const now = new Date();
    const vnTime = new Date(
      now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })
    );
    const paidAt = vnTime.toISOString();
    const carExitTime = vnTime.toISOString(); // Car exit time = payment confirmation time

    paymentService.updatePaymentOrderStatus(
      order_id,
      "paid",
      paidAt,
      transaction_id,
      carExitTime
    );

    // Get locker info first (needed for session update and payment processing)
    const locker = lockerService.getLockerById(order.lock_id);
    if (!locker) {
      logger.warn(`Locker ${order.lock_id} not found for payment confirmation`);
      return res.status(404).json({
        success: false,
        message: "Locker not found",
      });
    }

    // Update parking session for completed single ticket payment
    // Session should already exist (created when car entered)
    try {
      const carEnterTime = order.car_enter_time || locker.last_action_time;
      if (!carEnterTime) {
        logger.warn(
          `[PAYMENT] No car_enter_time found for order ${order_id}, cannot update parking session`
        );
      } else {
        // Find existing in_progress session for this lock
        const sessions = parkingSessionService.getParkingSessions({
          lock_id: order.lock_id,
          status: "in_progress",
          limit: 1,
        });

        if (sessions.sessions && sessions.sessions.length > 0) {
          // Update existing session
          const session = sessions.sessions[0];
          const carEnterTimeDate = new Date(carEnterTime);
          const parkingDuration = Math.floor(
            (vnTime - carEnterTimeDate) / 1000 / 60
          ); // minutes

          // Set payment_time when payment is confirmed (lock DOWN)
          const paymentTime = vnTime.toISOString();

          parkingSessionService.updateParkingSession(session.id, {
            ticket_type: "single", // Ensure it's single ticket
            payment_time: paymentTime, // Time when payment confirmed (lock DOWN)
            // Don't set car_exit_time here - it will be set when occupied changes from 1 to 0
            billing_duration: order.billing_duration || null,
            free_time_minutes: order.free_time_minutes || null,
            amount: order.amount,
            payment_order_id: order_id,
            // Don't set status to completed here - it will be set when car exits
          });

          logger.info(
            `[PAYMENT] Updated parking session ${session.id} for single ticket payment ${order_id} - completed`
          );
        } else {
          // Session should have been created when car entered
          // If not found, log error but don't create new session
          logger.error(
            `[PAYMENT] No in_progress session found for lock ${order.lock_id}, order ${order_id}. Session should have been created when car entered. Cannot update session.`
          );
        }
      }
    } catch (sessionError) {
      logger.error(
        `[PAYMENT] Failed to create/update parking session for payment ${order_id}:`,
        sessionError
      );
      logger.error(`[PAYMENT] Error details:`, {
        message: sessionError.message,
        stack: sessionError.stack,
        order_id,
        lock_id: order.lock_id,
      });
      // Don't fail the payment if session creation/update fails
    }

    // Validate locker status - only allow payment if:
    // 1. Locker is occupied (has car)
    // 2. Locker status is UP (locked)
    // 3. Has parking fee > 0
    // Same validation as processPayment
    if (!locker.occupied) {
      logger.warn(
        `Locker ${order.lock_id} is not occupied. Payment not needed.`
      );
      return res.status(400).json({
        success: false,
        message: "Locker is not occupied. No payment needed.",
      });
    }

    if (locker.status !== "UP") {
      logger.warn(
        `Locker ${order.lock_id} is not locked (status: ${locker.status}). Payment not required.`
      );
      return res.status(400).json({
        success: false,
        message: `Locker is not locked (current status: ${locker.status}). Payment not required.`,
      });
    }

    // Calculate parking fee to validate
    const parkingFee = calculateParkingFee(locker);
    if (parkingFee <= 0) {
      logger.warn(
        `Parking fee for locker ${order.lock_id} is 0. Payment not needed.`
      );
      return res.status(400).json({
        success: false,
        message: "Parking fee is 0. No payment needed.",
      });
    }

    // Log payment transaction (if transaction_id provided)
    if (transaction_id) {
      logger.info(
        `[PAYMENT] Transaction ${transaction_id} processed for ${order.lock_id} via webhook`
      );
    }

    // Clear auto-lock timer (payment processed, no need to auto-lock)
    clearAutoLockTimer(order.lock_id);
    logger.info(`[PAYMENT] Auto-lock timer cleared for ${order.lock_id}`);

    // Update locker - mark payment processed
    // Use PAYMENT_PROCESSED to match test mode detection in handleState
    // This ensures HaveCar sensor updates are skipped in dev/test mode
    lockerService.updateLocker(order.lock_id, {
      last_action: `PAYMENT_PROCESSED_BANK_TRANSFER${
        transaction_id ? `_${transaction_id}` : ""
      }`,
      last_action_time: new Date().toISOString(),
    });

    // Send DOWN command to unlock (same logic as processPayment)
    try {
      const deviceId = locker.device_id;

      if (isDeviceConnected(deviceId)) {
        logger.info(
          `[PAYMENT] Lowering lock for ${order.lock_id} after payment confirmed`
        );
        await sendLockControl(order.lock_id, LockControlMode.CLOSE);
        logger.info(
          `Payment confirmed for order ${order_id}, locker ${order.lock_id} unlocked successfully`
        );
      } else {
        logger.warn(
          `[PAYMENT] Device ${deviceId} not connected, cannot lower lock for ${order.lock_id}`
        );
      }
    } catch (unlockError) {
      logger.error(
        `Failed to unlock locker ${order.lock_id} after payment confirmation:`,
        unlockError
      );
      // Payment is already marked as paid, so just log the error
      // The lock might be offline or already down
    }

    // Emit WebSocket event to notify frontend that payment was confirmed
    try {
      const emitWsEvent = getEventEmitter();
      if (emitWsEvent) {
        // Get updated locker data
        const updatedLocker = lockerService.getLockerById(order.lock_id);

        emitWsEvent("payment:confirmed", {
          order_id: order_id,
          lock_id: order.lock_id,
          device_id: order.device_id,
          amount: order.amount,
          paid_at: paidAt,
          transaction_id: transaction_id || null,
          locker: updatedLocker, // Include full locker data for frontend update
          timestamp: new Date().toISOString(),
        });

        logger.info(
          `WebSocket event 'payment:confirmed' emitted for order ${order_id}`
        );
      }
    } catch (wsError) {
      logger.warn(
        `Failed to emit WebSocket event for payment confirmation:`,
        wsError
      );
      // Don't fail the request if WebSocket emit fails
    }

    res.json({
      success: true,
      message: "Payment confirmed and locker unlocked",
      data: {
        order_id: order_id,
        lock_id: order.lock_id,
        amount: order.amount,
        paid_at: paidAt,
        transaction_id: transaction_id || null,
      },
    });
  } catch (error) {
    logger.error("Error confirming payment:", error);
    next(error);
  }
}

/**
 * Get payment statistics for a locker
 * GET /api/payments/statistics/:lock_id
 */
export async function getPaymentStatistics(req, res, next) {
  try {
    const { lock_id } = req.params;
    const { start_date, end_date } = req.query;

    const stats = paymentService.getPaymentStatistics(
      lock_id,
      start_date,
      end_date
    );

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Error getting payment statistics:", error);
    next(error);
  }
}

/**
 * Get payment history with advanced filters
 * GET /api/payments/history
 *
 * Query params:
 * - lock_id: Filter by lock ID
 * - device_id: Filter by device ID
 * - status: Filter by status (paid, pending)
 * - start_date: Start date (YYYY-MM-DD)
 * - end_date: End date (YYYY-MM-DD)
 * - search: Search by order_id, description, or transaction_id
 * - limit: Results per page (default: 50)
 * - offset: Offset (default: 0)
 */
export async function getPaymentHistory(req, res, next) {
  try {
    const {
      lock_id,
      device_id,
      status,
      start_date,
      end_date,
      search,
      limit,
      offset,
    } = req.query;

    const filters = {
      lock_id,
      device_id,
      status,
      start_date,
      end_date,
      search,
      limit: parseInt(limit) || 50,
      offset: parseInt(offset) || 0,
    };

    const result = paymentService.getPaymentHistory(filters);

    res.json({
      success: true,
      data: result.orders,
      total: result.total,
      summary: result.summary,
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        has_more: result.total > filters.offset + filters.limit,
      },
    });
  } catch (error) {
    logger.error("Error getting payment history:", error);
    next(error);
  }
}

/**
 * Get overall payment statistics
 * GET /api/payments/statistics/overall
 */
export async function getOverallStatistics(req, res, next) {
  try {
    const { start_date, end_date } = req.query;

    const stats = paymentService.getOverallStatistics(start_date, end_date);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Error getting overall statistics:", error);
    next(error);
  }
}

/**
 * Get parking sessions (vé lẻ và vé tháng)
 * GET /api/payments/sessions
 */
export async function getParkingSessions(req, res, next) {
  try {
    const {
      device_id,
      lock_id,
      ticket_type,
      license_plate,
      status,
      start_date,
      end_date,
      limit = 100,
      offset = 0,
    } = req.query;

    const filters = {
      device_id: device_id || undefined,
      lock_id: lock_id || undefined,
      ticket_type: ticket_type || undefined,
      license_plate: license_plate || undefined,
      status: status || undefined,
      start_date: start_date || undefined,
      end_date: end_date || undefined,
      limit: parseInt(limit),
      offset: parseInt(offset),
    };

    const result = parkingSessionService.getParkingSessions(filters);

    res.json({
      success: true,
      data: result.sessions,
      total: result.total,
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        has_more: filters.offset + filters.limit < result.total,
      },
    });
  } catch (error) {
    logger.error("Error getting parking sessions:", error);
    next(error);
  }
}

/**
 * Get parking session statistics
 * GET /api/payments/sessions/statistics
 */
export async function getParkingSessionStatistics(req, res, next) {
  try {
    const { device_id, lock_id, ticket_type, start_date, end_date } = req.query;

    const filters = {
      device_id: device_id || undefined,
      lock_id: lock_id || undefined,
      ticket_type: ticket_type || undefined,
      start_date: start_date || undefined,
      end_date: end_date || undefined,
    };

    const stats = parkingSessionService.getParkingSessionStatistics(filters);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Error getting parking session statistics:", error);
    next(error);
  }
}

export default {
  generatePaymentQR,
  getPaymentOrder,
  getPaymentOrders,
  confirmPayment,
  getPaymentStatistics,
  getPaymentHistory,
  getOverallStatistics,
  getParkingSessions,
  getParkingSessionStatistics,
};
