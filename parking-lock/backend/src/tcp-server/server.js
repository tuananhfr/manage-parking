import net from "net";
import config from "../config/config.js";
import logger from "../utils/logger.js";
import {
  parseMessage,
  buildMessage,
  validateMessage,
} from "./protocol-parser.js";
import {
  registerConnection,
  unregisterConnection,
  getDeviceIdBySocket,
} from "./connection-manager.js";
import {
  startHeartbeatMonitor,
  stopHeartbeatMonitor,
} from "./heartbeat-monitor.js";
import { decryptSerialNumber } from "../services/crypto-service.js";
import {
  getDeviceBySerialNumber,
  getDeviceById,
  createDevice,
  createDeviceWithId,
  updateDeviceStatus,
} from "../services/device-service.js";
import { sendSyncTime } from "./command-sender.js";
import { formatLogTimestamp } from "../utils/helpers.js";
import {
  createLockersForDevice,
  updateLockerStatus,
  getLockerById,
  updateLocker,
  getLockersByDeviceId,
} from "../services/locker-service.js";
import { createStatusLog } from "../services/log-service.js";
import {
  updateCommandLogStatus,
  findLatestPendingCommand,
} from "../services/command-service.js";
import * as parkingSessionService from "../services/parking-session-service.js";
import {
  CommandType,
  MessageType,
  Verdict,
  DeviceStatus,
  LockerStatus,
  TriggerType,
  CommandStatus,
} from "../utils/constants.js";

let tcpServer = null;
let wsEventEmitter = null;

/**
 * Set WebSocket event emitter
 */
export function setWebSocketEmitter(emitter) {
  wsEventEmitter = emitter;
  logger.info("WebSocket emitter registered");
}

/**
 * Auto-recover device: Create device if not exists (for database recovery scenarios)
 * This handles cases where database was deleted but device still tries to connect
 */
function autoRecoverDevice(deviceId, socket) {
  try {
    // Check if device exists
    let device = getDeviceById(deviceId);

    if (!device) {
      logger.warn(
        `Device ${deviceId} not found in database. Auto-recovering by creating new device...`
      );

      // Create device with specific ID (using ID as serial number for recovery)
      // This ensures the device ID matches what the device expects
      device = createDeviceWithId(deviceId, deviceId, socket.remoteAddress);

      // Create 32 lockers for recovered device
      createLockersForDevice(device.id);

      logger.info(
        `Device ${deviceId} auto-recovered: Created device and 32 lockers`
      );

      // Emit WebSocket event
      emitWsEvent("device:status:changed", {
        device_id: device.id,
        status: DeviceStatus.ONLINE,
        timestamp: new Date().toISOString(),
      });
    }

    // Register connection
    registerConnection(device.id, socket);
    updateDeviceStatus(device.id, DeviceStatus.ONLINE, socket.remoteAddress);

    return device;
  } catch (error) {
    logger.error(`Failed to auto-recover device ${deviceId}:`, error);
    throw error;
  }
}

/**
 * Emit WebSocket event
 */
function emitWsEvent(event, data) {
  if (wsEventEmitter) {
    wsEventEmitter(event, data);
  }
}

/**
 * Handle Register request
 */
function handleRegister(socket, parsed) {
  try {
    const { SerialNumber } = parsed;

    if (!SerialNumber) {
      throw new Error("Missing SerialNumber");
    }

    // Decrypt serial number
    const decryptedSN = decryptSerialNumber(SerialNumber);
    logger.info(
      `[${formatLogTimestamp()}] [TCP-IN] Register request: SerialNumber=${decryptedSN}, Parsed: ${JSON.stringify(
        parsed
      )}`
    );

    // Get or create device
    let device = getDeviceBySerialNumber(decryptedSN);

    if (!device) {
      // Create new device
      device = createDevice(decryptedSN, socket.remoteAddress);

      // Create 32 lockers for new device
      createLockersForDevice(device.id);

      logger.info(`New device registered: ${device.id}`);
    } else {
      // Update existing device
      updateDeviceStatus(device.id, DeviceStatus.ONLINE, socket.remoteAddress);
      logger.info(`Device reconnected: ${device.id}`);
    }

    // Register connection
    registerConnection(device.id, socket);

    // Prepare parking information
    // Parks format: ID,Name,QR (ID of parking lot, Name, QR code prefix)
    const parkingId = device.id;
    const parkingName = device.name || device.location || parkingId;
    const parkingQR = parkingId; // Use device ID as QR prefix
    const parksValue = `${parkingId},${parkingName},${parkingQR}`;

    // Send response with required fields
    const response = buildMessage({
      Msg: MessageType.CONFIRM,
      Type: CommandType.REGISTER,
      MT: "0", // Message Type / Encryption mode (0 = no encryption for subsequent messages)
      Parks: parksValue, // Parking lot info: ID,Name,QR
      Verdict: Verdict.ACK,
      ErrorCode: "0", // 0 = no error
      ID: device.id,
    });

    logger.info(
      `[${formatLogTimestamp()}] [TCP-OUT] Register ACK: ${response}`
    );
    socket.write(response + "\n");

    // Send SyncTime command after successful registration
    // This ensures device clock is synchronized for accurate event timestamps
    try {
      setTimeout(async () => {
        try {
          await sendSyncTime(device.id);
          logger.info(
            `SyncTime sent to device ${device.id} after registration`
          );
        } catch (error) {
          logger.warn(
            `Failed to send SyncTime to device ${device.id}:`,
            error.message
          );
        }
      }, 100); // Small delay to ensure Register ACK is sent first
    } catch (error) {
      logger.warn(
        `Error scheduling SyncTime for device ${device.id}:`,
        error.message
      );
    }

    // Emit WebSocket event
    emitWsEvent("device:status:changed", {
      device_id: device.id,
      status: DeviceStatus.ONLINE,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(
      `[${formatLogTimestamp()}] [TCP-ERROR] Register failed:`,
      error
    );

    // Send NACK with error code
    const response = buildMessage({
      Msg: MessageType.CONFIRM,
      Type: CommandType.REGISTER,
      Verdict: Verdict.NACK,
      ErrorCode: "1", // 1 = error occurred
    });

    logger.info(
      `[${formatLogTimestamp()}] [TCP-OUT] Register NACK: ${response}`
    );
    socket.write(response + "\n");
  }
}

/**
 * Handle HeartBeat request
 */
function handleHeartBeat(socket, parsed) {
  try {
    let deviceId = getDeviceIdBySocket(socket);

    // If socket not registered but message has ID, register it
    if (!deviceId && parsed.ID) {
      deviceId = parsed.ID;
      // Verify device exists in database, auto-recover if not found
      let device = getDeviceById(deviceId);
      if (device) {
        registerConnection(deviceId, socket);
        updateDeviceStatus(deviceId, DeviceStatus.ONLINE, socket.remoteAddress);
        logger.info(
          `HeartBeat: Re-registered connection for device ${deviceId}`
        );
      } else {
        // Auto-recover: Create device if not exists (database recovery scenario)
        logger.warn(
          `HeartBeat: Device ID ${deviceId} not found in database, attempting auto-recovery...`
        );
        try {
          device = autoRecoverDevice(deviceId, socket);
          logger.info(
            `HeartBeat: Device ${deviceId} auto-recovered and re-registered`
          );
        } catch (error) {
          logger.error(
            `HeartBeat: Failed to auto-recover device ${deviceId}:`,
            error
          );
          return;
        }
      }
    }

    if (!deviceId) {
      throw new Error("Device not registered and no ID in message");
    }

    logger.debug(
      `[${formatLogTimestamp()}] [TCP-IN] HeartBeat from ${deviceId}, Parsed: ${JSON.stringify(
        parsed
      )}`
    );

    // Update device status
    updateDeviceStatus(deviceId, DeviceStatus.ONLINE);

    // Send response
    const response = buildMessage({
      Msg: MessageType.CONFIRM,
      Type: CommandType.HEARTBEAT,
      Verdict: Verdict.ACK,
    });

    logger.debug(
      `[${formatLogTimestamp()}] [TCP-OUT] HeartBeat ACK to ${deviceId}: ${response}`
    );
    socket.write(response + "\n");

    // Emit WebSocket event
    emitWsEvent("device:heartbeat", {
      device_id: deviceId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(
      `[${formatLogTimestamp()}] [TCP-ERROR] HeartBeat failed:`,
      error
    );
  }
}

/**
 * Handle CheckLock request
 * Device reports which locks are physically connected and requests authorization
 */
function handleCheckLock(socket, parsed) {
  try {
    let deviceId = getDeviceIdBySocket(socket);

    // If socket not registered but message has ID, register it
    if (!deviceId && parsed.ID) {
      deviceId = parsed.ID;
      // Verify device exists in database, auto-recover if not found
      let device = getDeviceById(deviceId);
      if (device) {
        registerConnection(deviceId, socket);
        updateDeviceStatus(deviceId, DeviceStatus.ONLINE, socket.remoteAddress);
        logger.info(
          `CheckLock: Re-registered connection for device ${deviceId}`
        );
      } else {
        // Auto-recover: Create device if not exists (database recovery scenario)
        logger.warn(
          `CheckLock: Device ID ${deviceId} not found in database, attempting auto-recovery...`
        );
        try {
          device = autoRecoverDevice(deviceId, socket);
          logger.info(
            `CheckLock: Device ${deviceId} auto-recovered and re-registered`
          );
        } catch (error) {
          logger.error(
            `CheckLock: Failed to auto-recover device ${deviceId}:`,
            error
          );
          throw new Error(
            `Device ${deviceId} not found and auto-recovery failed`
          );
        }
      }
    }

    if (!deviceId) {
      throw new Error("Device not registered and no ID in message");
    }

    const { LockState: deviceLockState, ID } = parsed;

    logger.info(
      `[${formatLogTimestamp()}] [TCP-IN] CheckLock from ${deviceId}, LockState=${deviceLockState}, ID=${ID}, Full: ${JSON.stringify(
        parsed
      )}`
    );

    // Get all lockers for this device from database
    const lockers = getLockersByDeviceId(deviceId);

    // Parse device LockState to determine which locks are physically connected
    // deviceLockState is a 32-character string: '0' = not connected, '1' = connected
    const deviceLockStateArray = deviceLockState
      ? deviceLockState.split("")
      : [];

    // Update connected status for each locker based on device's LockState
    for (const locker of lockers) {
      const lockNumber = locker.lock_number; // 1-32
      const lockIndex = lockNumber - 1; // 0-31 (array index)

      if (lockIndex >= 0 && lockIndex < 32) {
        const isConnected = deviceLockStateArray[lockIndex] === "1";
        // Update connected status in database
        if (locker.connected !== (isConnected ? 1 : 0)) {
          updateLocker(locker.lock_id, { connected: isConnected ? 1 : 0 });
        }
      }
    }

    // Theo yêu cầu NSX: phản hồi LockState giống hệt chuỗi thiết bị gửi lên (mirror 1:1)
    // Nếu thiết bị không gửi đủ 32 ký tự, pad/truncate cho đủ 32.
    let lockStateBits = "00000000000000000000000000000000";
    if (deviceLockState) {
      if (deviceLockState.length >= 32) {
        lockStateBits = deviceLockState.slice(0, 32);
      } else {
        lockStateBits =
          deviceLockState + "0".repeat(32 - deviceLockState.length);
      }
    }

    // Send response with authorization LockState
    // NOTE: Include ID so gateway knows which controller this response belongs to.
    const response = buildMessage({
      Msg: MessageType.CONFIRM,
      Type: CommandType.CHECK_LOCK,
      LockState: lockStateBits,
      Verdict: Verdict.ACK,
      ErrorCode: "0",
      ID: deviceId || ID,
    });

    logger.info(
      `[${formatLogTimestamp()}] [TCP-OUT] CheckLock ACK to ${deviceId}: LockState=${lockStateBits}, Response: ${response}`
    );
    socket.write(response + "\n");

    // Emit WebSocket event
    emitWsEvent("device:checklock", {
      device_id: deviceId,
      lock_state: lockStateBits,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(
      `[${formatLogTimestamp()}] [TCP-ERROR] CheckLock failed:`,
      error
    );

    // Send NACK on error
    const response = buildMessage({
      Msg: MessageType.CONFIRM,
      Type: CommandType.CHECK_LOCK,
      Verdict: Verdict.NACK,
      ErrorCode: "1",
      ID: getDeviceIdBySocket(socket) || parsed.ID,
    });

    logger.info(
      `[${formatLogTimestamp()}] [TCP-OUT] CheckLock NACK: ${response}`
    );
    socket.write(response + "\n");
  }
}

/**
 * Handle command confirmation (LockControl, OpenLockByPayment, CheckState)
 */
function handleCommandConfirm(socket, parsed) {
  try {
    const deviceId = getDeviceIdBySocket(socket);

    if (!deviceId) {
      throw new Error("Device not registered");
    }

    const { Type, Verdict: verdict, LockId } = parsed;
    const commandType = Type;

    logger.info(
      `[${formatLogTimestamp()}] [TCP-IN] Command confirm from ${deviceId}: Type=${commandType}, Verdict=${verdict}, LockId=${
        LockId || "N/A"
      }, Full: ${JSON.stringify(parsed)}`
    );

    // Find latest pending command log for this device/lock and command type
    const pendingCommand = findLatestPendingCommand(
      deviceId,
      LockId || null,
      commandType
    );

    if (pendingCommand) {
      // Update command log status based on Verdict
      const status =
        verdict === Verdict.ACK ? CommandStatus.ACK : CommandStatus.NACK;
      updateCommandLogStatus(pendingCommand.id, status, parsed);
      logger.info(
        `[TCP-CMD] Updated command log ${pendingCommand.id} to ${status}`
      );
    } else {
      logger.warn(
        `[TCP-WARN] No pending command found for device ${deviceId}, lock ${
          LockId || "N/A"
        }, type ${commandType}`
      );
    }

    // Emit WebSocket event
    emitWsEvent("command:response", {
      device_id: deviceId,
      type: commandType,
      verdict: verdict,
      lock_id: LockId,
      status: parsed.Status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(
      `[${formatLogTimestamp()}] [TCP-ERROR] Command confirm handling failed:`,
      error
    );
  }
}

/**
 * Handle State message - Device reports locker status change
 */
function handleState(socket, parsed) {
  try {
    const deviceId = getDeviceIdBySocket(socket);

    if (!deviceId) {
      throw new Error("Device not registered");
    }

    // State message format uses SerialNumber as LockId and LockState as Status
    const lockId = parsed.SerialNumber || parsed.LockId;
    const lockState = parsed.LockState || parsed.Status;

    if (!lockId || !lockState) {
      throw new Error(
        `Missing LockId (SerialNumber) or Status (LockState) in State message. Received: ${JSON.stringify(
          parsed
        )}`
      );
    }

    // Extract additional info for debugging
    const lockMode = parsed.LockMode || "N/A";
    const controlState = parsed.ControlState || "N/A";
    const haveCar = parsed.HaveCar || "N/A";
    const lockError = parsed.LockError || "N/A";

    logger.info(
      `[${formatLogTimestamp()}] [TCP-IN] State report from ${deviceId}: LockId=${lockId}, LockState=${lockState}, LockMode=${lockMode}, ControlState=${controlState}, HaveCar=${haveCar}, LockError=${lockError}`
    );
    logger.debug(
      `[${formatLogTimestamp()}] [TCP-DEBUG] Full State message: ${JSON.stringify(
        parsed
      )}`
    );

    // Get current locker state
    const locker = getLockerById(lockId);
    if (!locker) {
      logger.warn(
        `[${formatLogTimestamp()}] [TCP-WARN] Locker not found: ${lockId}`
      );
      return;
    }

    const oldStatus = locker.status;

    // Parse LockState to UP/DOWN/ERROR
    // LockState can be: "DownBotton", "Up", "UpBotton", "Stall", "UpStall", "DownStall", "WaitForAction", etc.
    const lockStateUpper = lockState.toUpperCase();
    let newStatus;
    let statusNote = lockState;
    let shouldUpdate = false; // Flag to determine if we should update status

    // Check for error/stall states first
    if (lockStateUpper.includes("STALL")) {
      shouldUpdate = true;
      // Stall states indicate lock is stuck
      if (lockStateUpper.includes("UPSTALL")) {
        newStatus = LockerStatus.UP; // Stuck while going up, treat as UP but log error
        statusNote = `ERROR: UpStall (Lock stuck while going up) - ${lockState}`;
      } else if (lockStateUpper.includes("DOWNSTALL")) {
        newStatus = LockerStatus.DOWN; // Stuck while going down, treat as DOWN but log error
        statusNote = `ERROR: DownStall (Lock stuck while going down) - ${lockState}`;
      } else {
        // Generic Stall - keep current status but mark as error
        newStatus = oldStatus; // Keep current status
        statusNote = `ERROR: Stall (Lock stuck) - ${lockState}`;
      }
    }
    // Check for intermediate/transitional states - don't update status, just log
    else if (
      lockStateUpper.includes("WAIT") ||
      lockStateUpper.includes("ACTION") ||
      lockStateUpper.includes("PENDING") ||
      lockStateUpper.includes("PROCESSING")
    ) {
      // Intermediate states: "WaitForAction", "Waiting", etc.
      // Don't update status, keep current status
      newStatus = oldStatus;
      statusNote = `TRANSITION: ${lockState} (keeping current status: ${oldStatus})`;
      shouldUpdate = false; // Don't update status for transitional states
      logger.debug(
        `[TCP-DEBUG] Intermediate state detected: ${lockState}, keeping status: ${oldStatus}`
      );
    }
    // Check for UP states (including RiseInPlace, UpTop, UpBottom, etc.)
    else if (
      lockStateUpper.includes("UP") ||
      lockStateUpper === "UP" ||
      lockStateUpper.includes("RISE") ||
      lockStateUpper.includes("RISING") ||
      lockStateUpper.includes("UPTOP") ||
      lockStateUpper.includes("UPBOTTOM")
    ) {
      shouldUpdate = true;
      newStatus = LockerStatus.UP;
      // If it's a transition state like RiseInPlace, log it but still update to UP
      if (
        lockStateUpper.includes("INPLACE") ||
        lockStateUpper.includes("RISING")
      ) {
        statusNote = `TRANSITION_TO_UP: ${lockState} (lock is rising)`;
      }
    }
    // Check for DOWN states (including DownInPlace, DownBottom, etc.)
    else if (
      lockStateUpper.includes("DOWN") ||
      lockStateUpper === "DOWN" ||
      lockStateUpper.includes("BOTTON") ||
      lockStateUpper.includes("BOTTOM") ||
      lockStateUpper.includes("LOWER") ||
      lockStateUpper.includes("LOWERING")
    ) {
      shouldUpdate = true;
      newStatus = LockerStatus.DOWN;
      // If it's a transition state like DownInPlace, log it but still update to DOWN
      if (
        lockStateUpper.includes("INPLACE") ||
        lockStateUpper.includes("LOWERING")
      ) {
        statusNote = `TRANSITION_TO_DOWN: ${lockState} (lock is lowering)`;
      }
    }
    // Unknown state - keep current status, don't update
    else {
      newStatus = oldStatus;
      statusNote = `UNKNOWN: ${lockState} (keeping current status: ${oldStatus})`;
      shouldUpdate = false;
      logger.warn(
        `[TCP-WARN] Unknown LockState: ${lockState}, keeping current status: ${oldStatus}`
      );
    }

    // Update occupied status based on HaveCar field if provided
    // BUT: Don't override occupied in these cases:
    // 1. Test mode (simulateCarEnter/Exit)
    // 2. Auto-lock scenario: When locker is UP and currently occupied (car is being held)
    //    - HaveCar sensor may be unreliable when lock is UP (sensor may not detect car)
    //    - When status changes from DOWN to UP while occupied, it's likely auto-lock to hold car
    let shouldUpdateOccupied = false;
    let newOccupied = locker.occupied;
    const isTestMode =
      locker.last_action &&
      (locker.last_action.includes("CAR_ENTERED_TEST") ||
        locker.last_action.includes("CAR_EXITED_TEST") ||
        locker.last_action.includes("PAYMENT_PROCESSED"));

    // Check if this is auto-lock scenario (locker UP to hold car)
    // When lock is UP, HaveCar sensor may not detect car properly
    const isAutoLockScenario =
      locker.occupied === 1 &&
      ((newStatus === LockerStatus.UP && oldStatus === LockerStatus.DOWN) ||
        (locker.status === LockerStatus.UP && newStatus === LockerStatus.UP));

    if (
      haveCar !== "N/A" &&
      haveCar !== undefined &&
      !isTestMode &&
      !isAutoLockScenario
    ) {
      const haveCarUpper = String(haveCar).toUpperCase();
      const targetOccupied =
        haveCarUpper === "Y" || haveCarUpper === "YES" ? 1 : 0;
      if (locker.occupied !== targetOccupied) {
        shouldUpdateOccupied = true;
        newOccupied = targetOccupied;
        logger.info(
          `[TCP-DEBUG] HaveCar=${haveCar} indicates occupied should be ${targetOccupied} (current: ${locker.occupied})`
        );
      }
    } else if (isTestMode || isAutoLockScenario) {
      logger.debug(
        `[TCP-DEBUG] Skipping HaveCar update - test mode or auto-lock scenario (last_action: ${locker.last_action}, status: ${locker.status}->${newStatus}, occupied: ${locker.occupied})`
      );
    }

    // Update locker status only if shouldUpdate is true and status changed, or if there's an error state
    const hasError = lockStateUpper.includes("STALL");
    if (shouldUpdate && (oldStatus !== newStatus || hasError)) {
      const oldMode = locker.mode;
      const oldOccupied = locker.occupied;

      const actionNote = hasError ? statusNote : `STATE_REPORT_${newStatus}`;

      // Preserve test mode flag in last_action if in test mode
      // This ensures HaveCar updates are skipped even after status changes
      let finalActionNote = actionNote;
      if (isTestMode && locker.last_action) {
        // Keep test mode indicator: append status to existing test action
        // Or keep original test action if it's more recent
        const testActionMatch = locker.last_action.match(
          /(CAR_ENTERED_TEST|CAR_EXITED_TEST|PAYMENT_PROCESSED)/
        );
        if (testActionMatch) {
          // Preserve test mode flag: keep original test action, just update time
          finalActionNote = locker.last_action; // Keep test mode flag
        }
      }

      // Update status and optionally occupied
      const updates = { status: newStatus, last_action: finalActionNote };
      if (shouldUpdateOccupied) {
        updates.occupied = newOccupied;
        updates.last_action_time = new Date().toISOString();

        // If occupied changed from 1 to 0 (car exited), update parking session
        if (oldOccupied === 1 && newOccupied === 0) {
          try {
            const sessions = parkingSessionService.getParkingSessions({
              lock_id: lockId,
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

              // If billing_duration is not set yet (for monthly tickets), set it equal to parking_duration
              const updates = {
                car_exit_time: carExitTime.toISOString(),
                parking_duration: parkingDuration,
                status: "completed",
              };

              // For monthly tickets, if billing_duration is null, set it to parking_duration
              if (
                session.ticket_type === "monthly" &&
                !session.billing_duration
              ) {
                updates.billing_duration = parkingDuration;
              }

              parkingSessionService.updateParkingSession(session.id, updates);

              logger.info(
                `Updated parking session ${session.id} for lock ${lockId} - car exited (occupied: 1 → 0)`
              );
            }
          } catch (sessionError) {
            logger.error(
              `Failed to update parking session when car exited:`,
              sessionError
            );
            // Don't fail the state update if session update fails
          }
        }
      }
      updateLocker(lockId, updates);

      // Get updated locker to check if mode/occupied changed
      const updatedLocker = getLockerById(lockId);
      const newMode = updatedLocker.mode;
      const finalOccupied = updatedLocker.occupied;

      // Create status log
      // Note: This AUTO log reflects the actual physical state reported by the device.
      // If this differs from a recent MANUAL command, it means the device's automatic
      // logic (e.g., car detection, Normal mode behavior) is overriding the manual command.
      createStatusLog({
        lock_id: lockId,
        device_id: deviceId,
        old_status: oldStatus,
        new_status: newStatus,
        old_mode: oldMode !== newMode ? oldMode : null,
        new_mode: oldMode !== newMode ? newMode : null,
        old_occupied: oldOccupied !== finalOccupied ? oldOccupied : null,
        new_occupied: oldOccupied !== finalOccupied ? finalOccupied : null,
        trigger_type: TriggerType.AUTO,
        note: hasError
          ? statusNote
          : `Device reported actual state: ${lockState} (may override manual command if device is in auto mode)`,
      });

      // Emit WebSocket event with full locker data
      emitWsEvent("locker:status:changed", {
        lock_id: lockId,
        device_id: deviceId,
        old_status: oldStatus,
        new_status: newStatus,
        old_mode: oldMode !== newMode ? oldMode : null,
        new_mode: oldMode !== newMode ? newMode : null,
        old_occupied: oldOccupied !== finalOccupied ? oldOccupied : null,
        new_occupied: oldOccupied !== finalOccupied ? finalOccupied : null,
        // Include full locker data for frontend to update
        locker: updatedLocker,
        timestamp: new Date().toISOString(),
      });

      // Log detailed reason for status change
      const reason = hasError
        ? "ERROR DETECTED"
        : `Device auto-report (LockMode=${lockMode}, ControlState=${controlState}, HaveCar=${haveCar})`;

      logger.info(
        `[${formatLogTimestamp()}] Locker ${lockId} status updated: ${oldStatus} -> ${newStatus} (LockState: ${lockState}) - ${reason}`
      );

      // Log warning if device is in auto mode and status changed unexpectedly
      if (
        controlState === "Normal" &&
        lockMode !== "0" &&
        oldStatus === "UP" &&
        newStatus === "DOWN"
      ) {
        logger.warn(
          `[${formatLogTimestamp()}] [TCP-WARN] Device ${deviceId} auto-lowered lock ${lockId} (LockMode=${lockMode}, ControlState=${controlState}). This is device behavior, not backend action.`
        );
      }
    }
    // Update occupied status even if status didn't change
    else if (shouldUpdateOccupied) {
      const oldOccupied = locker.occupied;
      updateLocker(lockId, {
        occupied: newOccupied,
        last_action_time: new Date().toISOString(),
      });

      const updatedLocker = getLockerById(lockId);

      // Create status log for occupied change only
      createStatusLog({
        lock_id: lockId,
        device_id: deviceId,
        old_occupied: oldOccupied,
        new_occupied: newOccupied,
        trigger_type: TriggerType.AUTO,
        note: `Device reported HaveCar=${haveCar} in State message`,
      });

      // Emit WebSocket event
      emitWsEvent("locker:status:changed", {
        lock_id: lockId,
        device_id: deviceId,
        old_occupied: oldOccupied,
        new_occupied: newOccupied,
        locker: updatedLocker,
        timestamp: new Date().toISOString(),
      });

      logger.info(
        `[${formatLogTimestamp()}] Locker ${lockId} occupied updated: ${oldOccupied} -> ${newOccupied} (HaveCar=${haveCar})`
      );
    }
  } catch (error) {
    logger.error(
      `[${formatLogTimestamp()}] [TCP-ERROR] State handling failed:`,
      error
    );
  }
}

/**
 * Handle CarEnterTime message - Device reports car entered
 */
function handleCarEnterTime(socket, parsed) {
  try {
    const deviceId = getDeviceIdBySocket(socket);

    if (!deviceId) {
      throw new Error("Device not registered");
    }

    const { LockId, Time } = parsed;

    if (!LockId) {
      throw new Error("Missing LockId in CarEnterTime message");
    }

    logger.info(
      `[${formatLogTimestamp()}] [TCP-IN] CarEnterTime from ${deviceId}: LockId=${LockId}, Time=${Time}, Full: ${JSON.stringify(
        parsed
      )}`
    );

    // Get current locker state
    const locker = getLockerById(LockId);
    if (!locker) {
      logger.warn(
        `[${formatLogTimestamp()}] [TCP-WARN] Locker not found: ${LockId}`
      );
      return;
    }

    const oldOccupied = locker.occupied;
    const newOccupied = 1; // Car entered = occupied

    // Update locker - mark as occupied
    const updates = {
      occupied: newOccupied,
      last_action: "CAR_ENTERED",
      last_action_time: new Date().toISOString(),
    };

    updateLocker(LockId, updates);

    // Send ACK response immediately to prevent device from resending
    const response = buildMessage({
      Msg: MessageType.CONFIRM,
      Type: CommandType.CAR_ENTER_TIME,
      Verdict: Verdict.ACK,
      LockId: LockId,
    });

    logger.info(
      `[${formatLogTimestamp()}] [TCP-OUT] CarEnterTime ACK to ${deviceId}: ${response}`
    );
    socket.write(response + "\n");

    // Create status log
    if (oldOccupied !== newOccupied) {
      createStatusLog({
        lock_id: LockId,
        device_id: deviceId,
        old_occupied: oldOccupied,
        new_occupied: newOccupied,
        trigger_type: TriggerType.AUTO,
        note: `Car entered at time: ${Time || new Date().toISOString()}`,
      });

      // Get updated locker to include full data
      const updatedLocker = getLockerById(LockId);

      // Emit WebSocket event with full locker data
      emitWsEvent("locker:status:changed", {
        lock_id: LockId,
        device_id: deviceId,
        old_occupied: oldOccupied,
        new_occupied: newOccupied,
        // Include full locker data for frontend to update
        locker: updatedLocker,
        timestamp: new Date().toISOString(),
      });

      logger.info(`Locker ${LockId} marked as occupied (Car entered)`);

      // Create parking session when car enters (for single ticket - default)
      // For monthly ticket, session will be updated when unlock monthly with license_plate
      try {
        const carEnterTime = updates.last_action_time;
        // Check if there's already an in_progress session for this lock
        const existingSessions = parkingSessionService.getParkingSessions({
          lock_id: LockId,
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
            lock_id: LockId,
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
              `Created parking session ${newSession.id} (in_progress) for lock ${LockId} when car entered`
            );
          } else {
            logger.error(
              `Failed to create parking session - session is null for lock ${LockId}`
            );
          }
        }
      } catch (sessionError) {
        logger.error(
          `Failed to create parking session when car entered:`,
          sessionError
        );
        // Don't fail car enter if session creation fails
      }
    }
  } catch (error) {
    logger.error(
      `[${formatLogTimestamp()}] [TCP-ERROR] CarEnterTime handling failed:`,
      error
    );
  }
}

/**
 * Handle incoming message
 */
function handleMessage(socket, message) {
  const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;

  try {
    // Log raw message received
    logger.info(
      `[${formatLogTimestamp()}] [TCP-RAW-IN] From ${clientAddress}: ${message}`
    );

    const parsed = parseMessage(message);
    validateMessage(parsed);

    const { Msg, Type } = parsed;

    logger.debug(
      `[TCP-PARSED] Msg=${Msg}, Type=${Type}, Data: ${JSON.stringify(parsed)}`
    );

    // Handle Request messages
    if (Msg === MessageType.REQUEST) {
      switch (Type) {
        case CommandType.REGISTER:
          handleRegister(socket, parsed);
          break;

        case CommandType.HEARTBEAT:
          handleHeartBeat(socket, parsed);
          break;

        case CommandType.CHECK_LOCK:
          handleCheckLock(socket, parsed);
          break;

        case CommandType.STATE:
          handleState(socket, parsed);
          break;

        case CommandType.CAR_ENTER_TIME:
          handleCarEnterTime(socket, parsed);
          break;

        default:
          logger.warn(
            `[${formatLogTimestamp()}] [TCP-WARN] Unknown request type: ${Type}`
          );
      }
    }

    // Handle Confirm messages (responses from device)
    else if (Msg === MessageType.CONFIRM) {
      switch (Type) {
        case CommandType.LOCK_CONTROL:
        case CommandType.OPEN_LOCK_BY_PAYMENT:
        case CommandType.CHECK_STATE:
        case CommandType.SYNC_TIME:
        case CommandType.LOCK_BUSINESS_CONTROL:
        case CommandType.SYSTEM_MAINTENANCE:
        case CommandType.SET_LOCK_ATTRIBUTE:
        case CommandType.LOCK_FREE_TIME:
        case CommandType.LOCK_WARNING_TIME:
          handleCommandConfirm(socket, parsed);
          break;

        default:
          logger.warn(
            `[${formatLogTimestamp()}] [TCP-WARN] Unknown confirm type: ${Type}`
          );
      }
    }
  } catch (error) {
    logger.error(
      `[${formatLogTimestamp()}] [TCP-ERROR] Message handling failed from ${clientAddress}:`,
      error
    );
    logger.error(
      `[${formatLogTimestamp()}] [TCP-ERROR] Raw message: ${message}`
    );
  }
}

/**
 * Handle connection
 */
function handleConnection(socket) {
  const clientAddress = `${socket.remoteAddress}:${socket.remotePort}`;
  logger.info(
    `[${formatLogTimestamp()}] New TCP connection from: ${clientAddress}`
  );

  let buffer = "";
  let errorCount = 0;
  const MAX_ERRORS = 5; // Close connection after 5 consecutive errors

  socket.on("data", (data) => {
    // Log raw TCP data received
    const rawData = data.toString();

    // Check if data contains binary/non-printable characters
    const hasBinary = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/.test(rawData);
    if (hasBinary) {
      // Count non-printable bytes
      const binaryCount = (
        rawData.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g) || []
      ).length;
      const binaryRatio = binaryCount / rawData.length;

      // If more than 10% of data is binary, it's likely not our protocol
      if (binaryRatio > 0.1) {
        errorCount++;
        logger.warn(
          `[${formatLogTimestamp()}] [TCP-WARN] Binary data detected from ${clientAddress} (${Math.round(
            binaryRatio * 100
          )}% binary, error count: ${errorCount})`
        );

        if (errorCount >= MAX_ERRORS) {
          logger.warn(
            `[${formatLogTimestamp()}] [TCP-WARN] Closing connection from ${clientAddress} due to too many invalid messages (likely not a parking lock device)`
          );
          socket.destroy();
          return;
        }

        // Don't process binary data, just log and reset buffer
        buffer = "";
        return;
      }
    }

    // Reset error count on successful text data
    if (!hasBinary) {
      errorCount = 0;
    }

    logger.info(
      `[${formatLogTimestamp()}] [TCP-RAW-DATA] From ${clientAddress}: ${rawData
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")}`
    );

    buffer += rawData;

    // Process complete messages with newline delimiter
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const message = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (message) {
        try {
          handleMessage(socket, message);
          errorCount = 0; // Reset error count on successful message
        } catch (error) {
          errorCount++;
          if (errorCount >= MAX_ERRORS) {
            logger.warn(
              `[${formatLogTimestamp()}] [TCP-WARN] Closing connection from ${clientAddress} due to too many parse errors`
            );
            socket.destroy();
            return;
          }
        }
      }
    }

    // Process complete messages with carriage return delimiter (but not part of \r\n)
    let crIndex;
    while ((crIndex = buffer.indexOf("\r")) !== -1) {
      // Check if this \r is followed by \n (skip if it is, \n handler will process it)
      if (crIndex + 1 < buffer.length && buffer[crIndex + 1] === "\n") {
        break; // Let \n handler process this
      }
      const message = buffer.slice(0, crIndex).trim();
      buffer = buffer.slice(crIndex + 1);

      if (message) {
        try {
          handleMessage(socket, message);
          errorCount = 0; // Reset error count on successful message
        } catch (error) {
          errorCount++;
          if (errorCount >= MAX_ERRORS) {
            logger.warn(
              `[${formatLogTimestamp()}] [TCP-WARN] Closing connection from ${clientAddress} due to too many parse errors`
            );
            socket.destroy();
            return;
          }
        }
      }
    }

    // Handle case where message doesn't have delimiter (starts with < and ends with >)
    // Process immediately if buffer looks like a complete message
    const trimmedBuffer = buffer.trim();
    if (
      trimmedBuffer &&
      trimmedBuffer.startsWith("<") &&
      trimmedBuffer.endsWith(">")
    ) {
      // If buffer is exactly the trimmed version (no leading/trailing whitespace except what we trimmed)
      // and looks reasonable in length, assume it's a complete message
      if (trimmedBuffer.length < 500) {
        try {
          handleMessage(socket, trimmedBuffer);
          errorCount = 0; // Reset error count on successful message
          buffer = "";
        } catch (error) {
          errorCount++;
          if (errorCount >= MAX_ERRORS) {
            logger.warn(
              `[${formatLogTimestamp()}] [TCP-WARN] Closing connection from ${clientAddress} due to too many parse errors`
            );
            socket.destroy();
            return;
          }
          buffer = ""; // Clear buffer on error to prevent retry loops
        }
      }
    }

    // Prevent buffer overflow - clear if too large
    if (buffer.length > 10000) {
      logger.warn(
        `[${formatLogTimestamp()}] [TCP-WARN] Buffer overflow detected from ${clientAddress}, clearing buffer`
      );
      buffer = "";
      errorCount++;
      if (errorCount >= MAX_ERRORS) {
        socket.destroy();
        return;
      }
    }
  });

  socket.on("end", () => {
    const deviceId = unregisterConnection(socket);
    logger.info(
      `[${formatLogTimestamp()}] Connection closed: ${clientAddress} (Device: ${
        deviceId || "unknown"
      })`
    );

    // Update device status to OFFLINE
    if (deviceId) {
      updateDeviceStatus(deviceId, DeviceStatus.OFFLINE);

      emitWsEvent("device:status:changed", {
        device_id: deviceId,
        status: DeviceStatus.OFFLINE,
        timestamp: new Date().toISOString(),
      });
    }
  });

  socket.on("error", (error) => {
    logger.error(
      `[${formatLogTimestamp()}] Socket error (${clientAddress}):`,
      error
    );
  });
}

/**
 * Start TCP server
 */
export function startTcpServer() {
  return new Promise((resolve, reject) => {
    if (tcpServer) {
      logger.warn("TCP server already running");
      return resolve(tcpServer);
    }

    tcpServer = net.createServer(handleConnection);

    tcpServer.on("error", (error) => {
      logger.error("TCP server error:", error);
      reject(error);
    });

    tcpServer.listen(config.tcpPort, config.host, () => {
      logger.info(`TCP server listening on ${config.host}:${config.tcpPort}`);

      // Start heartbeat monitor
      startHeartbeatMonitor();

      resolve(tcpServer);
    });
  });
}

/**
 * Stop TCP server
 */
export function stopTcpServer() {
  return new Promise((resolve) => {
    if (!tcpServer) {
      return resolve();
    }

    // Stop heartbeat monitor
    stopHeartbeatMonitor();

    tcpServer.close(() => {
      logger.info("TCP server stopped");
      tcpServer = null;
      resolve();
    });
  });
}

export default {
  startTcpServer,
  stopTcpServer,
  setWebSocketEmitter,
};
