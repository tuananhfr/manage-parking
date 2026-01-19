import { getDatabase } from "../database/db.js";
import { formatTimestamp, safeJsonStringify } from "../utils/helpers.js";
import { CommandStatus } from "../utils/constants.js";
import logger from "../utils/logger.js";

/**
 * Create command log
 */
export function createCommandLog(
  lockId,
  deviceId,
  commandType,
  commandData,
  note = null
) {
  const db = getDatabase();

  const result = db
    .prepare(
      `
    INSERT INTO command_logs (lock_id, device_id, command_type, command_data, status, sent_at, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      lockId,
      deviceId,
      commandType,
      safeJsonStringify(commandData),
      CommandStatus.SENT,
      formatTimestamp(),
      note
    );

  logger.info(
    `Command log created: ${commandType} for ${lockId || deviceId || "system"}`
  );

  return result.lastInsertRowid;
}

/**
 * Update command log status
 */
export function updateCommandLogStatus(commandId, status, responseData = null) {
  const db = getDatabase();

  const updates = {
    status,
    ack_at:
      status === CommandStatus.ACK || status === CommandStatus.NACK
        ? formatTimestamp()
        : null,
    response_data: responseData ? safeJsonStringify(responseData) : null,
  };

  db.prepare(
    `
    UPDATE command_logs
    SET status = ?, ack_at = ?, response_data = ?
    WHERE id = ?
  `
  ).run(updates.status, updates.ack_at, updates.response_data, commandId);

  return getCommandLogById(commandId);
}

/**
 * Get command log by ID
 */
export function getCommandLogById(commandId) {
  const db = getDatabase();
  return db.prepare("SELECT * FROM command_logs WHERE id = ?").get(commandId);
}

/**
 * Get command logs
 */
export function getCommandLogs(filters = {}) {
  const db = getDatabase();
  let sql = "SELECT * FROM command_logs WHERE 1=1";
  const params = [];

  if (filters.lock_id) {
    sql += " AND lock_id = ?";
    params.push(filters.lock_id);
  }

  if (filters.device_id) {
    sql += " AND device_id = ?";
    params.push(filters.device_id);
  }

  if (filters.command_type) {
    sql += " AND command_type = ?";
    params.push(filters.command_type);
  }

  if (filters.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }

  if (filters.from_date) {
    sql += " AND sent_at >= ?";
    params.push(filters.from_date);
  }

  if (filters.to_date) {
    sql += " AND sent_at <= ?";
    params.push(filters.to_date);
  }

  sql += " ORDER BY sent_at DESC";

  if (filters.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }

  if (filters.offset) {
    sql += " OFFSET ?";
    params.push(filters.offset);
  }

  return db.prepare(sql).all(params);
}

/**
 * Get command logs count
 */
export function getCommandLogsCount(filters = {}) {
  const db = getDatabase();
  let sql = "SELECT COUNT(*) as count FROM command_logs WHERE 1=1";
  const params = [];

  if (filters.lock_id) {
    sql += " AND lock_id = ?";
    params.push(filters.lock_id);
  }

  if (filters.device_id) {
    sql += " AND device_id = ?";
    params.push(filters.device_id);
  }

  if (filters.command_type) {
    sql += " AND command_type = ?";
    params.push(filters.command_type);
  }

  if (filters.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }

  if (filters.from_date) {
    sql += " AND sent_at >= ?";
    params.push(filters.from_date);
  }

  if (filters.to_date) {
    sql += " AND sent_at <= ?";
    params.push(filters.to_date);
  }

  const result = db.prepare(sql).get(params);
  return result.count;
}

/**
 * Find latest pending command log for a device/lock and command type
 * Used to match response with the command that was sent
 */
export function findLatestPendingCommand(deviceId, lockId, commandType) {
  const db = getDatabase();

  let sql = `
    SELECT * FROM command_logs 
    WHERE device_id = ? 
    AND command_type = ?
    AND status = ?
    ORDER BY sent_at DESC
    LIMIT 1
  `;

  const params = [deviceId, commandType, CommandStatus.SENT];

  // If lockId is provided, also filter by lock_id
  if (lockId) {
    sql = `
      SELECT * FROM command_logs 
      WHERE device_id = ? 
      AND lock_id = ?
      AND command_type = ?
      AND status = ?
      ORDER BY sent_at DESC
      LIMIT 1
    `;
    params.splice(1, 0, lockId);
  }

  return db.prepare(sql).get(params);
}

export default {
  createCommandLog,
  updateCommandLogStatus,
  getCommandLogById,
  getCommandLogs,
  getCommandLogsCount,
  findLatestPendingCommand,
};
