import * as lockerService from "../../services/locker-service.js";
import * as commandService from "../../services/command-service.js";
import * as logService from "../../services/log-service.js";
import * as parkingSessionService from "../../services/parking-session-service.js";
import {
  sendLockControl,
  sendCheckState,
  sendSetLockAttribute,
  sendLockFreeTime,
  sendLockWarningTime,
} from "../../tcp-server/command-sender.js";
import { isDeviceConnected } from "../../tcp-server/connection-manager.js";
import { LockControlMode, TriggerType } from "../../utils/constants.js";
import logger from "../../utils/logger.js";
import { getEventEmitter } from "../../websocket/socket-server.js";
import {
  startAutoLockTimer,
  clearAutoLockTimer,
  getRemainingTime,
} from "../../services/auto-lock-timer-service.js";

/**
 * GET /api/lockers
 */
export async function getAllLockers(req, res, next) {
  try {
    const {
      device_id,
      status,
      mode,
      occupied,
      connected,
      limit = 100,
      offset = 0,
    } = req.query;

    const filters = {
      device_id,
      status,
      mode,
      occupied: occupied !== undefined ? occupied === "true" : undefined,
      connected: connected !== undefined ? connected === "true" : undefined,
      limit: parseInt(limit),
      offset: parseInt(offset),
    };

    const lockers = lockerService.getAllLockers(filters);
    const total = lockerService.getLockerCount(filters);

    // Add remaining_time and parking_fee to each locker
    const lockersWithTimer = lockers.map((locker) => ({
      ...locker,
      remaining_time: getRemainingTime(locker.lock_id),
      parking_fee: calculateParkingFee(locker),
    }));

    res.json({
      success: true,
      total,
      data: lockersWithTimer,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Calculate parking fee based on car enter time and hourly rate
 * Rounds up to nearest hour (15 minutes = 1 hour)
 */
export function calculateParkingFee(locker) {
  // Check if locker is occupied and has car enter time
  if (!locker.occupied || !locker.last_action_time) {
    return 0;
  }

  // Check if last action indicates car entered
  const hasCarEntered =
    locker.last_action &&
    (locker.last_action.includes("CAR_ENTERED") ||
      locker.last_action.includes("CAR_ENTER"));

  if (!hasCarEntered) {
    return 0;
  }

  // Check if hourly rate is set
  if (!locker.hourly_rate || locker.hourly_rate <= 0) {
    return 0;
  }

  const carEnterTime = new Date(locker.last_action_time);
  const now = new Date();
  const totalMinutes = Math.floor((now - carEnterTime) / (1000 * 60));

  // Free time (minutes)
  const freeTimeMinutes = locker.lock_free_time || 0;

  // If still in free time, no charge
  if (totalMinutes <= freeTimeMinutes) {
    return 0;
  }

  // Calculate paid minutes (after free time)
  const paidMinutes = totalMinutes - freeTimeMinutes;

  // Round up to nearest hour (15 minutes = 1 hour)
  // Math.ceil(paidMinutes / 60) rounds up to hours
  const paidHours = Math.ceil(paidMinutes / 60);

  // Calculate fee: paidHours * hourly_rate
  const fee = paidHours * locker.hourly_rate;

  return fee;
}

/**
 * GET /api/lockers/:lock_id
 */
export async function getLockerById(req, res, next) {
  try {
    const { lock_id } = req.params;

    const locker = lockerService.getLockerById(lock_id);

    if (!locker) {
      return res.status(404).json({
        success: false,
        message: "Locker not found",
      });
    }

    // Get recent commands
    const recentCommands = commandService.getCommandLogs({
      lock_id,
      limit: 10,
    });

    // Get status history
    const statusHistory = logService.getStatusLogs({
      lock_id,
      limit: 20,
    });

    // Get remaining time for auto-lock timer (if active)
    const remainingTime = getRemainingTime(lock_id);

    // Calculate parking fee
    const parkingFee = calculateParkingFee(locker);

    res.json({
      success: true,
      data: {
        ...locker,
        recent_commands: recentCommands,
        status_history: statusHistory,
        remaining_time: remainingTime,
        parking_fee: parkingFee,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/lockers/:lock_id/control
 */
export async function controlLocker(req, res, next) {
  try {
    const { lock_id } = req.params;
    const { action, note } = req.body;

    // Validate locker exists
    const locker = lockerService.getLockerById(lock_id);

    if (!locker) {
      return res.status(404).json({
        success: false,
        message: "Locker not found",
      });
    }

    // Validate action
    if (!["open", "close", "stop", "normal", "check"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Must be: open, close, stop, normal, or check",
      });
    }

    let commandId;

    // Handle different actions
    if (action === "check") {
      // Send CheckState command
      commandId = await sendCheckState(lock_id);
    } else {
      // Send LockControl command (open, close, stop, normal)
      let controlMode;
      if (action === "open") {
        controlMode = LockControlMode.OPEN;
      } else if (action === "close") {
        controlMode = LockControlMode.CLOSE;
      } else if (action === "stop") {
        controlMode = LockControlMode.STOP;
      } else if (action === "normal") {
        controlMode = LockControlMode.NORMAL;
      }

      commandId = await sendLockControl(lock_id, controlMode);

      // DO NOT update status optimistically
      // Wait for device to confirm via State message, which will update status automatically
      // This ensures status reflects actual device state, not just command sent

      // Just log the last action for tracking
      lockerService.updateLocker(lock_id, {
        last_action: `LOCK_CONTROL_${action.toUpperCase()}`,
      });
    }

    res.json({
      success: true,
      message: "Command sent successfully",
      data: {
        command_id: commandId,
        lock_id,
        action,
        status: "SENT",
        sent_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/lockers/:lock_id
 */
export async function updateLocker(req, res, next) {
  try {
    const { lock_id } = req.params;
    const { name, occupied, hourly_rate } = req.body;

    const locker = lockerService.getLockerById(lock_id);

    if (!locker) {
      return res.status(404).json({
        success: false,
        message: "Locker not found",
      });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (occupied !== undefined) updates.occupied = occupied ? 1 : 0;
    if (hourly_rate !== undefined) {
      const rate = parseInt(hourly_rate);
      if (rate < 0) {
        return res.status(400).json({
          success: false,
          message: "Hourly rate must be >= 0",
        });
      }
      updates.hourly_rate = rate;
    }

    const updated = lockerService.updateLocker(lock_id, updates);

    res.json({
      success: true,
      message: "Locker updated successfully",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/lockers/:lock_id/set-attribute
 * Set lock protection attributes
 */
export async function setLockAttribute(req, res, next) {
  try {
    const { lock_id } = req.params;
    const { up_protect, down_protect, ids, device_id } = req.body;

    let targetDeviceId;
    let targetLockId = lock_id;

    // If lock_id is "All", device_id must be provided
    if (lock_id === "All" || lock_id === "all") {
      if (!device_id) {
        return res.status(400).json({
          success: false,
          message: 'device_id is required when lock_id is "All"',
        });
      }
      targetDeviceId = device_id;
      targetLockId = "All";
    } else {
      // Get locker to find device_id
      const locker = lockerService.getLockerById(lock_id);
      if (!locker) {
        return res.status(404).json({
          success: false,
          message: "Locker not found",
        });
      }
      targetDeviceId = locker.device_id;
    }

    const commandId = await sendSetLockAttribute(targetDeviceId, targetLockId, {
      upProtect: up_protect,
      downProtect: down_protect,
      ids: ids,
    });

    res.json({
      success: true,
      message: "Set lock attribute command sent",
      data: {
        command_id: commandId,
        lock_id,
        up_protect,
        down_protect,
        ids,
        status: "SENT",
        sent_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/lockers/:lock_id/free-time
 * Set free time (minutes before auto-lock)
 */
export async function setFreeTime(req, res, next) {
  try {
    const { lock_id } = req.params;
    const { time } = req.body;

    if (time === undefined || time < 0) {
      return res.status(400).json({
        success: false,
        message: "Time must be >= 0 minutes",
      });
    }

    const locker = lockerService.getLockerById(lock_id);
    if (!locker) {
      return res.status(404).json({
        success: false,
        message: "Locker not found",
      });
    }

    const commandId = await sendLockFreeTime(lock_id, parseInt(time));

    // Update locker with the new free time value
    lockerService.updateLocker(lock_id, {
      lock_free_time: parseInt(time),
    });

    res.json({
      success: true,
      message: "Free time command sent",
      data: {
        command_id: commandId,
        lock_id,
        time,
        status: "SENT",
        sent_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/lockers/:lock_id/warning-time
 * Set warning time (seconds before action)
 */
export async function setWarningTime(req, res, next) {
  try {
    const { lock_id } = req.params;
    const { time } = req.body;

    if (time === undefined || time < 0) {
      return res.status(400).json({
        success: false,
        message: "Time must be >= 0 seconds",
      });
    }

    const locker = lockerService.getLockerById(lock_id);
    if (!locker) {
      return res.status(404).json({
        success: false,
        message: "Locker not found",
      });
    }

    const commandId = await sendLockWarningTime(lock_id, parseInt(time));

    // Update locker with the new warning time value
    lockerService.updateLocker(lock_id, {
      lock_warning_time: parseInt(time),
    });

    res.json({
      success: true,
      message: "Warning time command sent",
      data: {
        command_id: commandId,
        lock_id,
        time,
        status: "SENT",
        sent_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/lockers/:lock_id/simulate-car-enter
 * Simulate CarEnterTime event for testing (when no physical device)
 */
export async function simulateCarEnter(req, res, next) {
  try {
    const { lock_id } = req.params;

    // Validate locker exists
    const locker = lockerService.getLockerById(lock_id);
    if (!locker) {
      return res.status(404).json({
        success: false,
        message: "Locker not found",
      });
    }

    const deviceId = locker.device_id;
    const oldOccupied = locker.occupied;
    const newOccupied = 1; // Car entered = occupied

    // Update locker - mark as occupied
    const updates = {
      occupied: newOccupied,
      last_action: "CAR_ENTERED_TEST",
      last_action_time: new Date().toISOString(),
    };

    lockerService.updateLocker(lock_id, updates);

    // Create status log
    if (oldOccupied !== newOccupied) {
      logService.createStatusLog({
        lock_id: lock_id,
        device_id: deviceId,
        old_occupied: oldOccupied,
        new_occupied: newOccupied,
        trigger_type: TriggerType.AUTO,
        note: `CarEnterTime simulated for testing (manual trigger)`,
      });

      // Get updated locker to include full data
      const updatedLocker = lockerService.getLockerById(lock_id);

      // Emit WebSocket event with full locker data
      const wsEmitter = getEventEmitter();
      if (wsEmitter) {
        wsEmitter("locker:status:changed", {
          lock_id: lock_id,
          device_id: deviceId,
          old_occupied: oldOccupied,
          new_occupied: newOccupied,
          locker: updatedLocker,
          timestamp: new Date().toISOString(),
        });
      }

      logger.info(
        `[TEST] Locker ${lock_id} marked as occupied (CarEnterTime simulated)`
      );

      // Create parking session when car enters (for single ticket - default)
      // For monthly ticket, session will be created/updated when unlock monthly
      try {
        const carEnterTime = updates.last_action_time;
        // Check if there's already an in_progress session for this lock
        const existingSessions = parkingSessionService.getParkingSessions({
          lock_id: lock_id,
          status: "in_progress",
          limit: 1,
        });

        if (
          !existingSessions.sessions ||
          existingSessions.sessions.length === 0
        ) {
          // Create new session when car enters (ticket_type will be set later when payment/unlock)
          const newSession = parkingSessionService.createParkingSession({
            device_id: deviceId,
            lock_id: lock_id,
            ticket_type: null, // Will be set when payment (single) or unlock (monthly)
            license_plate: null, // Will be updated for monthly tickets
            car_enter_time: carEnterTime,
            car_exit_time: null,
            parking_duration: null,
            billing_duration: null,
            free_time_minutes: null,
            amount: 0, // Default to 0, will be updated for single tickets when payment
            payment_order_id: null,
            status: "in_progress",
          });

          if (newSession) {
            logger.info(
              `[TEST] Created parking session ${newSession.id} (in_progress) for lock ${lock_id} when car entered`
            );
          } else {
            logger.error(
              `[TEST] Failed to create parking session - session is null for lock ${lock_id}`
            );
          }
        }
      } catch (sessionError) {
        logger.error(
          `[TEST] Failed to create parking session when car entered:`,
          sessionError
        );
        // Don't fail car enter if session creation fails
      }

      // Start auto-lock timer to simulate hardware behavior
      // Hardware automatically locks after LockFreeTime + LockWarningTime
      startAutoLockTimer(lock_id);
      logger.info(
        `[TEST] Auto-lock timer started for ${lock_id} (will raise lock after free time expires)`
      );
    }

    res.json({
      success: true,
      message: "CarEnterTime simulated successfully",
      data: {
        lock_id,
        old_occupied: oldOccupied,
        new_occupied: newOccupied,
        locker: lockerService.getLockerById(lock_id),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/lockers/:lock_id/process-payment
 * Process payment - lower the lock and clear timer (but keep occupied status)
 */
export async function processPayment(req, res, next) {
  try {
    const { lock_id } = req.params;
    const { payment_method = "bank_transfer", transaction_id, note } = req.body;

    // Validate locker exists
    const locker = lockerService.getLockerById(lock_id);
    if (!locker) {
      return res.status(404).json({
        success: false,
        message: "Locker not found",
      });
    }

    // Validate locker status - only allow payment if:
    // 1. Locker is occupied (has car)
    // 2. Locker status is UP (locked)
    // 3. Has parking fee > 0
    if (!locker.occupied) {
      return res.status(400).json({
        success: false,
        message: "Locker is not occupied. No payment needed.",
      });
    }

    if (locker.status !== "UP") {
      return res.status(400).json({
        success: false,
        message: `Locker is not locked (current status: ${locker.status}). Payment not required.`,
      });
    }

    // Calculate parking fee
    const parkingFee = calculateParkingFee(locker);
    if (parkingFee <= 0) {
      return res.status(400).json({
        success: false,
        message: "Parking fee is 0. No payment needed.",
      });
    }

    const deviceId = locker.device_id;

    // Clear auto-lock timer (payment processed, no need to auto-lock)
    clearAutoLockTimer(lock_id);
    logger.info(`[PAYMENT] Auto-lock timer cleared for ${lock_id}`);

    // Update locker - mark payment processed
    const updates = {
      last_action: `PAYMENT_PROCESSED_${payment_method.toUpperCase()}`,
      last_action_time: new Date().toISOString(),
    };

    lockerService.updateLocker(lock_id, updates);

    // Log payment transaction (if transaction_id provided)
    if (transaction_id) {
      logger.info(
        `[PAYMENT] Transaction ${transaction_id} processed for ${lock_id} via ${payment_method}`
      );
    }

    // Send LockControl Close to lower the lock (allow car to exit)
    try {
      if (isDeviceConnected(deviceId)) {
        logger.info(
          `[PAYMENT] Lowering lock for ${lock_id} after payment processed`
        );
        await sendLockControl(lock_id, LockControlMode.CLOSE);
      } else {
        logger.warn(
          `[PAYMENT] Device ${deviceId} not connected, cannot lower lock`
        );
      }
    } catch (cmdError) {
      logger.warn(`[PAYMENT] Failed to lower lock: ${cmdError.message}`);
    }

    // Get updated locker
    const updatedLocker = lockerService.getLockerById(lock_id);

    res.json({
      success: true,
      message: "Payment processed, lock lowered",
      data: {
        lock_id,
        locker: updatedLocker,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function simulateCarExit(req, res, next) {
  try {
    const { lock_id } = req.params;

    // Validate locker exists
    const locker = lockerService.getLockerById(lock_id);
    if (!locker) {
      return res.status(404).json({
        success: false,
        message: "Locker not found",
      });
    }

    const deviceId = locker.device_id;
    const oldOccupied = locker.occupied;
    const newOccupied = 0; // Car exited = not occupied

    // Update locker - mark as not occupied
    const updates = {
      occupied: newOccupied,
      last_action: "CAR_EXITED_TEST",
      last_action_time: new Date().toISOString(),
    };

    lockerService.updateLocker(lock_id, updates);

    // Create status log
    if (oldOccupied !== newOccupied) {
      logService.createStatusLog({
        lock_id: lock_id,
        device_id: deviceId,
        old_occupied: oldOccupied,
        new_occupied: newOccupied,
        trigger_type: TriggerType.AUTO,
        note: `CarExit simulated for testing (manual trigger)`,
      });

      // Get updated locker to include full data
      const updatedLocker = lockerService.getLockerById(lock_id);

      // Emit WebSocket event with full locker data
      const wsEmitter = getEventEmitter();
      if (wsEmitter) {
        wsEmitter("locker:status:changed", {
          lock_id: lock_id,
          device_id: deviceId,
          old_occupied: oldOccupied,
          new_occupied: newOccupied,
          locker: updatedLocker,
          timestamp: new Date().toISOString(),
        });
      }

      logger.info(
        `[TEST] Locker ${lock_id} marked as not occupied (CarExit simulated)`
      );

      // Update parking session if exists (mark as completed)
      try {
        const sessions = parkingSessionService.getParkingSessions({
          lock_id: lock_id,
          status: "in_progress",
          limit: 1,
        });

        if (sessions.sessions && sessions.sessions.length > 0) {
          const session = sessions.sessions[0];
          const carEnterTime = new Date(session.car_enter_time);
          const carExitTime = new Date();
          const parkingDuration = Math.floor(
            (carExitTime - carEnterTime) / 1000 / 60
          ); // minutes

          parkingSessionService.updateParkingSession(session.id, {
            car_exit_time: carExitTime.toISOString(),
            parking_duration: parkingDuration,
            status: "completed",
          });

          logger.info(
            `Updated parking session ${session.id} for lock ${lock_id} - completed`
          );
        }
      } catch (sessionError) {
        logger.error(
          `Failed to update parking session for lock ${lock_id}:`,
          sessionError
        );
        // Don't fail the request if session update fails
      }

      // Clear auto-lock timer if it's still running
      clearAutoLockTimer(lock_id);
      logger.info(`[TEST] Auto-lock timer cleared for ${lock_id}`);

      // Send LockControl Close to lower the lock (DOWN)
      // This simulates the device behavior when car exits
      try {
        // Check if device is connected before sending command
        if (isDeviceConnected(deviceId)) {
          logger.info(
            `[TEST] Auto-triggering LockControl Close for ${lock_id} to simulate device lowering lock after car exit`
          );
          // Send LockControl Close (DOWN) to simulate device lowering lock
          // Mode "Close" = DOWN = Car can exit (according to protocol)
          await sendLockControl(lock_id, "Close");
        } else {
          logger.warn(
            `[TEST] Device ${deviceId} not connected, cannot auto-trigger LockControl Close`
          );
        }
      } catch (cmdError) {
        // If command fails, just log - don't fail the whole request
        logger.warn(
          `[TEST] Failed to auto-trigger LockControl Close: ${cmdError.message}`
        );
      }
    }

    res.json({
      success: true,
      message: "CarExit simulated successfully",
      data: {
        lock_id,
        old_occupied: oldOccupied,
        new_occupied: newOccupied,
        locker: lockerService.getLockerById(lock_id),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/lockers/:lock_id/unlock-monthly
 * Unlock locker for monthly ticket holders
 */
export async function unlockMonthly(req, res, next) {
  try {
    const { lock_id } = req.params;
    const { license_plate, code } = req.body;

    if (!license_plate) {
      return res.status(400).json({
        success: false,
        message: "license_plate is required",
      });
    }

    // Validate locker exists
    const locker = lockerService.getLockerById(lock_id);
    if (!locker) {
      return res.status(404).json({
        success: false,
        message: "Locker not found",
      });
    }

    // Validate locker is occupied (car must be there to exit)
    // Monthly ticket is for car EXIT, not car ENTER
    // occupied = 1 means car is there, can exit
    // occupied = 0 means no car, cannot exit
    if (!locker.occupied) {
      return res.status(400).json({
        success: false,
        message: "Locker is not occupied (no car to exit)",
      });
    }

    // Logic for car EXIT (same as payment QR code):
    // - UP (locked/khóa) + occupied = 1 → need DOWN (mở) so car can exit
    // - DOWN (unlocked/mở) + occupied = 1 → car can exit directly, no need to send command

    // TODO: Validate monthly ticket code (currently always "000000")
    // In the future, check database for valid monthly tickets
    if (code && code !== "000000") {
      return res.status(400).json({
        success: false,
        message: "Invalid monthly ticket code",
      });
    }

    // DOWN locker to allow car EXIT (same logic as payment QR code)
    // UP = locked (khóa) → need DOWN to open (mở) so car can exit
    // DOWN = unlocked (mở) → car can exit directly, no need to send command
    const deviceId = locker.device_id;
    let commandId = null;

    if (locker.status === "UP") {
      // Locker is UP (locked/khóa) → need to DOWN (mở) for car to exit
      if (isDeviceConnected(deviceId)) {
        logger.info(
          `[MONTHLY] DOWN lock for ${lock_id} (status: UP/khóa) to allow car EXIT for monthly ticket holder ${license_plate}`
        );
        commandId = await sendLockControl(lock_id, LockControlMode.CLOSE); // CLOSE = DOWN = unlock
      } else {
        logger.warn(
          `[MONTHLY] Device ${deviceId} not connected, cannot DOWN lock for ${lock_id}`
        );
        return res.status(503).json({
          success: false,
          message: "Device not connected",
        });
      }
    } else {
      // Locker is already DOWN (unlocked/mở) → car can exit directly, no need to send command
      logger.info(
        `[MONTHLY] Locker ${lock_id} is already DOWN (mở), car can exit directly for monthly ticket holder ${license_plate}`
      );
    }

    // Update parking session for monthly ticket (mark as completed)
    const now = new Date();
    const vnTime = new Date(
      now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" })
    );
    const carExitTime = vnTime.toISOString();

    try {
      // Find existing in_progress session for this lock (created when car entered)
      // Don't filter by ticket_type because session was created as "single" when car entered
      const sessions = parkingSessionService.getParkingSessions({
        lock_id: lock_id,
        status: "in_progress",
        limit: 1,
      });

      if (sessions.sessions && sessions.sessions.length > 0) {
        const session = sessions.sessions[0];
        const carEnterTime = new Date(session.car_enter_time);
        const parkingDuration = Math.floor((vnTime - carEnterTime) / 1000 / 60); // minutes

        // Set payment_time when unlock monthly (lock DOWN)
        const paymentTime = carExitTime; // carExitTime is when unlock happens

        // For monthly tickets, billing_duration = parking_duration (no free time, but still track duration)
        // Amount = 0 because monthly tickets are pre-paid
        const billingDuration = parkingDuration; // Monthly tickets: billing_duration = parking_duration

        parkingSessionService.updateParkingSession(session.id, {
          ticket_type: "monthly", // Update to monthly ticket
          license_plate: license_plate, // Add license plate
          payment_time: paymentTime, // Time when unlock monthly (lock DOWN)
          billing_duration: billingDuration, // Thời gian tính tiền (bằng parking_duration cho vé tháng)
          // amount is already 0 (set when car entered), no need to update for monthly tickets
          // Don't set car_exit_time here - it will be set when occupied changes from 1 to 0
          // Don't set status to completed here - it will be set when car exits
        });

        logger.info(
          `[MONTHLY] Updated parking session ${session.id} for monthly ticket: ${license_plate} at ${lock_id} - completed`
        );
      } else {
        // Session should have been created when car entered
        // If not found, log error but don't create new session
        logger.error(
          `[MONTHLY] No in_progress session found for lock ${lock_id}, license ${license_plate}. Session should have been created when car entered. Cannot update session.`
        );
      }
    } catch (sessionError) {
      logger.error(
        `Failed to update parking session for monthly ticket:`,
        sessionError
      );
      // Don't fail the unlock if session update fails
    }

    // Update locker - Keep occupied=1 (car still there), but mark monthly exit authorized
    // Use PAYMENT_PROCESSED_MONTHLY prefix to prevent "HaveCar=N" from resetting occupied in server.js
    lockerService.updateLocker(lock_id, {
      last_action: `PAYMENT_PROCESSED_MONTHLY_${license_plate}`,
      last_action_time: carExitTime,
    });

    // Create status log
    logService.createStatusLog({
      lock_id: lock_id,
      device_id: deviceId,
      old_occupied: 1,
      new_occupied: 1, // Occupied status remains 1 until car physically exits
      trigger_type: TriggerType.AUTO,
      note: `Monthly ticket unlock - Plate: ${license_plate}`,
    });

    // Emit WebSocket event
    const wsEmitter = getEventEmitter();
    if (wsEmitter) {
      const updatedLocker = lockerService.getLockerById(lock_id);
      wsEmitter("locker:status:changed", {
        lock_id: lock_id,
        device_id: deviceId,
        old_occupied: 1,
        new_occupied: 1,
        locker: updatedLocker,
        timestamp: new Date().toISOString(),
      });
    }

    res.json({
      success: true,
      message: "Locker unlocked for monthly ticket holder",
      data: {
        lock_id,
        license_plate,
        code: code || null,
        exited_at: carExitTime,
        command_id: commandId,
      },
    });
  } catch (error) {
    logger.error("Error unlocking for monthly ticket:", error);
    next(error);
  }
}

export default {
  getAllLockers,
  getLockerById,
  controlLocker,
  updateLocker,
  setLockAttribute,
  setFreeTime,
  setWarningTime,
  simulateCarEnter,
  simulateCarExit,
  processPayment,
  unlockMonthly,
};
