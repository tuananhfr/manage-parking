import { sendToDevice, isDeviceConnected } from "./connection-manager.js";
import { buildMessage } from "./protocol-parser.js";
import { parseLockId, formatLogTimestamp } from "../utils/helpers.js";
import {
  CommandType,
  MessageType,
  LockControlMode,
} from "../utils/constants.js";
import { createCommandLog } from "../services/command-service.js";
import logger from "../utils/logger.js";

/**
 * Send lock control command
 */
export async function sendLockControl(lockId, mode) {
  const { deviceId } = parseLockId(lockId);

  if (!isDeviceConnected(deviceId)) {
    throw new Error(`Device not connected: ${deviceId}`);
  }

  const message = buildMessage({
    Msg: MessageType.REQUEST,
    Type: CommandType.LOCK_CONTROL,
    Mode: mode,
    LockId: lockId,
  });

  logger.info(
    `[${formatLogTimestamp()}] [TCP-RAW-OUT] LockControl to ${deviceId}: ${message}`
  );
  logger.info(
    `[${formatLogTimestamp()}] [TCP-CMD] LockControl - LockId: ${lockId}, Mode: ${mode}`
  );

  // Create command log
  const commandId = createCommandLog(
    lockId,
    deviceId,
    CommandType.LOCK_CONTROL,
    { mode, lockId }
  );

  await sendToDevice(deviceId, message);

  return commandId;
}

/**
 * Send check state command
 * Protocol V1.4: Added ESN, Continue, DeviceType, SerialNumber fields
 * @param {string} lockId - Lock ID or device ID
 * @param {object} options - Optional parameters
 * @param {string} options.esn - Event Serial Number (01-99), default "01"
 * @param {boolean} options.checkAll - Check all locks (true) or single lock (false), default false
 * @param {string} options.deviceType - Device type (e.g., "PL3"), optional
 */
export async function sendCheckState(lockId, options = {}) {
  const { deviceId, lockNumber } = parseLockId(lockId);

  if (!isDeviceConnected(deviceId)) {
    throw new Error(`Device not connected: ${deviceId}`);
  }

  const { esn = "01", checkAll = false, deviceType = "PL3" } = options;

  // Protocol V1.4 Page 11: Required fields
  const messageData = {
    Msg: MessageType.REQUEST,
    Type: CommandType.CHECK_STATE,
    ESN: esn,
    Continue: checkAll ? "Y" : "N",
    DeviceType: deviceType,
    SerialNumber: lockId,
  };

  const message = buildMessage(messageData);

  logger.info(
    `[${formatLogTimestamp()}] [TCP-RAW-OUT] CheckState to ${deviceId}: ${message}`
  );
  logger.info(
    `[${formatLogTimestamp()}] [TCP-CMD] CheckState - LockId: ${lockId}, ESN: ${esn}, CheckAll: ${checkAll}`
  );

  // Create command log
  const commandId = createCommandLog(
    lockId,
    deviceId,
    CommandType.CHECK_STATE,
    { lockId, esn, checkAll, deviceType }
  );

  await sendToDevice(deviceId, message);

  return commandId;
}

/**
 * Send sync time command to device
 * Formats current time as: xxxx-xx-xx xx:xx:xx (Protocol V1.4 Page 27)
 */
export async function sendSyncTime(deviceId) {
  if (!isDeviceConnected(deviceId)) {
    throw new Error(`Device not connected: ${deviceId}`);
  }

  // Format current time as xxxx-xx-xx xx:xx:xx (Protocol requirement)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  const timeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

  const message = buildMessage({
    Msg: MessageType.REQUEST,
    Type: CommandType.SYNC_TIME,
    Time: timeStr,
    ID: deviceId,
  });

  logger.info(
    `[${formatLogTimestamp()}] [TCP-RAW-OUT] SyncTime to ${deviceId}: ${message}`
  );
  logger.info(
    `[${formatLogTimestamp()}] [TCP-CMD] SyncTime - DeviceId: ${deviceId}, Time: ${timeStr}`
  );

  // Create command log (no lockId for SyncTime)
  const commandId = createCommandLog(
    null, // No specific lock for SyncTime
    deviceId,
    CommandType.SYNC_TIME,
    { time: timeStr }
  );

  await sendToDevice(deviceId, message);

  return commandId;
}

/**
 * Send lock business control command (Open/Close parking lot)
 */
export async function sendLockBusinessControl(deviceId, mode) {
  if (!isDeviceConnected(deviceId)) {
    throw new Error(`Device not connected: ${deviceId}`);
  }

  // Mode must be "Open" or "Close"
  if (mode !== "Open" && mode !== "Close") {
    throw new Error(`Invalid mode. Must be "Open" or "Close"`);
  }

  const message = buildMessage({
    Msg: MessageType.REQUEST,
    Type: CommandType.LOCK_BUSINESS_CONTROL,
    Mode: mode,
  });

  logger.info(
    `[${formatLogTimestamp()}] [TCP-RAW-OUT] LockBusinessControl to ${deviceId}: ${message}`
  );
  logger.info(
    `[${formatLogTimestamp()}] [TCP-CMD] LockBusinessControl - DeviceId: ${deviceId}, Mode: ${mode}`
  );

  // Create command log (no specific lock for business control)
  const commandId = createCommandLog(
    null,
    deviceId,
    CommandType.LOCK_BUSINESS_CONTROL,
    { mode }
  );

  await sendToDevice(deviceId, message);

  return commandId;
}

/**
 * Send system maintenance command (Reboot/ClearErr)
 */
export async function sendSystemMaintenance(
  deviceId,
  command,
  deviceType = null,
  serialNumber = null
) {
  if (!isDeviceConnected(deviceId)) {
    throw new Error(`Device not connected: ${deviceId}`);
  }

  // Command must be "Reboot" or "ClearErr"
  if (command !== "Reboot" && command !== "ClearErr") {
    throw new Error(`Invalid command. Must be "Reboot" or "ClearErr"`);
  }

  const messageData = {
    Msg: MessageType.REQUEST,
    Type: CommandType.SYSTEM_MAINTENANCE,
    Command: command,
  };

  if (deviceType) {
    messageData.DeviceType = deviceType;
  }

  if (serialNumber) {
    messageData.SerialNumber = serialNumber;
  }

  const message = buildMessage(messageData);

  logger.info(
    `[${formatLogTimestamp()}] [TCP-RAW-OUT] SystemMaintenance to ${deviceId}: ${message}`
  );
  logger.info(
    `[${formatLogTimestamp()}] [TCP-CMD] SystemMaintenance - DeviceId: ${deviceId}, Command: ${command}`
  );

  // Create command log
  const commandId = createCommandLog(
    null,
    deviceId,
    CommandType.SYSTEM_MAINTENANCE,
    { command, deviceType, serialNumber }
  );

  await sendToDevice(deviceId, message);

  return commandId;
}

/**
 * Send set lock attribute command
 */
export async function sendSetLockAttribute(deviceId, lockId, options) {
  if (!isDeviceConnected(deviceId)) {
    throw new Error(`Device not connected: ${deviceId}`);
  }

  const { upProtect, downProtect, ids } = options;

  // Validate protect values (20-95)
  if (upProtect !== undefined && (upProtect < 20 || upProtect > 95)) {
    throw new Error(`UpProtect must be between 20 and 95`);
  }

  if (downProtect !== undefined && (downProtect < 20 || downProtect > 95)) {
    throw new Error(`DownProtect must be between 20 and 95`);
  }

  const messageData = {
    Msg: MessageType.REQUEST,
    Type: CommandType.SET_LOCK_ATTRIBUTE,
    LockId: lockId || "All",
    ID: deviceId,
  };

  if (upProtect !== undefined) {
    messageData.UpProtect = String(upProtect);
  }

  if (downProtect !== undefined) {
    messageData.DownProtect = String(downProtect);
  }

  if (ids) {
    messageData.IDs = ids; // Comma-separated list of lock serial numbers
  }

  const message = buildMessage(messageData);

  logger.info(
    `[${formatLogTimestamp()}] [TCP-RAW-OUT] SetLockAttribute to ${deviceId}: ${message}`
  );
  logger.info(
    `[${formatLogTimestamp()}] [TCP-CMD] SetLockAttribute - DeviceId: ${deviceId}, LockId: ${lockId}, UpProtect: ${upProtect}, DownProtect: ${downProtect}`
  );

  // Create command log
  const commandId = createCommandLog(
    lockId || null,
    deviceId,
    CommandType.SET_LOCK_ATTRIBUTE,
    { upProtect, downProtect, ids, lockId }
  );

  await sendToDevice(deviceId, message);

  return commandId;
}

/**
 * Send lock free time command
 */
export async function sendLockFreeTime(lockId, timeMinutes) {
  const { deviceId } = parseLockId(lockId);

  if (!isDeviceConnected(deviceId)) {
    throw new Error(`Device not connected: ${deviceId}`);
  }

  if (!timeMinutes || timeMinutes < 0) {
    throw new Error(`Time must be >= 0 minutes`);
  }

  const message = buildMessage({
    Msg: MessageType.REQUEST,
    Type: CommandType.LOCK_FREE_TIME,
    Time: String(timeMinutes),
    LockId: lockId,
  });

  logger.info(
    `[${formatLogTimestamp()}] [TCP-RAW-OUT] LockFreeTime to ${deviceId}: ${message}`
  );
  logger.info(
    `[${formatLogTimestamp()}] [TCP-CMD] LockFreeTime - LockId: ${lockId}, Time: ${timeMinutes} minutes`
  );

  // Create command log
  const commandId = createCommandLog(
    lockId,
    deviceId,
    CommandType.LOCK_FREE_TIME,
    { time: timeMinutes, lockId }
  );

  await sendToDevice(deviceId, message);

  return commandId;
}

/**
 * Send lock warning time command
 */
export async function sendLockWarningTime(lockId, timeSeconds) {
  const { deviceId } = parseLockId(lockId);

  if (!isDeviceConnected(deviceId)) {
    throw new Error(`Device not connected: ${deviceId}`);
  }

  if (!timeSeconds || timeSeconds < 0) {
    throw new Error(`Time must be >= 0 seconds`);
  }

  const message = buildMessage({
    Msg: MessageType.REQUEST,
    Type: CommandType.LOCK_WARNING_TIME,
    Time: String(timeSeconds),
    LockId: lockId,
  });

  logger.info(
    `[${formatLogTimestamp()}] [TCP-RAW-OUT] LockWarningTime to ${deviceId}: ${message}`
  );
  logger.info(
    `[${formatLogTimestamp()}] [TCP-CMD] LockWarningTime - LockId: ${lockId}, Time: ${timeSeconds} seconds`
  );

  // Create command log
  const commandId = createCommandLog(
    lockId,
    deviceId,
    CommandType.LOCK_WARNING_TIME,
    { time: timeSeconds, lockId }
  );

  await sendToDevice(deviceId, message);

  return commandId;
}

/**
 * Send ServerCheckLock command (Protocol Page 32)
 * Server queries parking lock information connected to node controller
 */
export async function sendServerCheckLock(deviceId) {
  if (!isDeviceConnected(deviceId)) {
    throw new Error(`Device not connected: ${deviceId}`);
  }

  const message = buildMessage({
    Msg: MessageType.REQUEST,
    Type: CommandType.SERVER_CHECK_LOCK,
  });

  logger.info(
    `[${formatLogTimestamp()}] [TCP-RAW-OUT] ServerCheckLock to ${deviceId}: ${message}`
  );
  logger.info(
    `[${formatLogTimestamp()}] [TCP-CMD] ServerCheckLock - DeviceId: ${deviceId}`
  );

  // Create command log
  const commandId = createCommandLog(
    null,
    deviceId,
    CommandType.SERVER_CHECK_LOCK,
    { deviceId }
  );

  await sendToDevice(deviceId, message);

  return commandId;
}

export default {
  sendLockControl,
  sendCheckState,
  sendSyncTime,
  sendLockBusinessControl,
  sendSystemMaintenance,
  sendSetLockAttribute,
  sendLockFreeTime,
  sendLockWarningTime,
  sendServerCheckLock,
};
