import { getDatabase } from "../database/db.js";
import {
  generateLockId,
  parseLockId,
  formatTimestamp,
  addMinutes,
} from "../utils/helpers.js";
import { LockerStatus, LockerMode } from "../utils/constants.js";
import logger from "../utils/logger.js";

/**
 * Get all lockers
 */
export function getAllLockers(filters = {}) {
  const db = getDatabase();
  let sql = `
    SELECT l.*, d.name as device_name, d.location as device_location, d.status as device_status
    FROM lockers l
    LEFT JOIN devices d ON l.device_id = d.id
    WHERE 1=1
  `;
  const params = [];

  if (filters.device_id) {
    sql += " AND l.device_id = ?";
    params.push(filters.device_id);
  }

  if (filters.status) {
    sql += " AND l.status = ?";
    params.push(filters.status);
  }

  if (filters.mode) {
    sql += " AND l.mode = ?";
    params.push(filters.mode);
  }

  if (filters.occupied !== undefined) {
    sql += " AND l.occupied = ?";
    params.push(filters.occupied ? 1 : 0);
  }

  if (filters.connected !== undefined) {
    sql += " AND l.connected = ?";
    params.push(filters.connected ? 1 : 0);
  }

  sql += " ORDER BY l.lock_id ASC";

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
 * Get locker by ID
 */
export function getLockerById(lockId) {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT l.*, d.name as device_name, d.location as device_location, d.status as device_status
    FROM lockers l
    LEFT JOIN devices d ON l.device_id = d.id
    WHERE l.lock_id = ?
  `
    )
    .get(lockId);
}

/**
 * Get lockers by device ID
 */
export function getLockersByDeviceId(deviceId) {
  const db = getDatabase();
  return db
    .prepare(
      "SELECT * FROM lockers WHERE device_id = ? ORDER BY lock_number ASC"
    )
    .all(deviceId);
}

/**
 * Create locker
 */
export function createLocker(deviceId, lockNumber, name = null) {
  const db = getDatabase();

  const lockId = generateLockId(deviceId, lockNumber);
  const now = formatTimestamp();

  db.prepare(
    `
    INSERT INTO lockers (lock_id, device_id, lock_number, name, status, mode, occupied, connected, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    lockId,
    deviceId,
    lockNumber,
    name,
    LockerStatus.UP,
    LockerMode.NORMAL,
    0,
    0,
    now,
    now
  );

  logger.info(`Locker created: ${lockId}`);

  return getLockerById(lockId);
}

/**
 * Update locker
 */
export function updateLocker(lockId, updates) {
  const db = getDatabase();

  const allowedFields = [
    "name",
    "status",
    "mode",
    "occupied",
    "last_action",
    "last_action_time",
    "connected",
    "lock_free_time",
    "lock_warning_time",
    "hourly_rate",
  ];
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) {
    return getLockerById(lockId);
  }

  fields.push("updated_at = ?");
  values.push(formatTimestamp());
  values.push(lockId);

  const sql = `UPDATE lockers SET ${fields.join(", ")} WHERE lock_id = ?`;
  db.prepare(sql).run(values);

  return getLockerById(lockId);
}

/**
 * Update locker status
 */
export function updateLockerStatus(lockId, status, action = null) {
  const updates = {
    status,
    last_action: action,
    last_action_time: formatTimestamp(),
  };

  logger.info(`Locker status updated: ${lockId} -> ${status}`);

  return updateLocker(lockId, updates);
}

/**
 * Delete locker
 */
export function deleteLocker(lockId) {
  const db = getDatabase();
  const result = db
    .prepare("DELETE FROM lockers WHERE lock_id = ?")
    .run(lockId);

  logger.info(`Locker deleted: ${lockId}`);

  return result.changes > 0;
}

/**
 * Get locker count
 */
export function getLockerCount(filters = {}) {
  const db = getDatabase();
  let sql = "SELECT COUNT(*) as count FROM lockers WHERE 1=1";
  const params = [];

  if (filters.device_id) {
    sql += " AND device_id = ?";
    params.push(filters.device_id);
  }

  if (filters.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }

  if (filters.mode) {
    sql += " AND mode = ?";
    params.push(filters.mode);
  }

  if (filters.occupied !== undefined) {
    sql += " AND occupied = ?";
    params.push(filters.occupied ? 1 : 0);
  }

  if (filters.connected !== undefined) {
    sql += " AND connected = ?";
    params.push(filters.connected ? 1 : 0);
  }

  const result = db.prepare(sql).get(params);
  return result.count;
}

/**
 * Create lockers for device (all 32 lockers)
 */
export function createLockersForDevice(deviceId) {
  const lockers = [];

  for (let i = 1; i <= 32; i++) {
    const locker = createLocker(
      deviceId,
      i,
      `Chỗ đỗ ${deviceId}-${String(i).padStart(2, "0")}`
    );
    lockers.push(locker);
  }

  logger.info(`Created 32 lockers for device: ${deviceId}`);

  return lockers;
}

export default {
  getAllLockers,
  getLockerById,
  getLockersByDeviceId,
  createLocker,
  updateLocker,
  updateLockerStatus,
  deleteLocker,
  getLockerCount,
  createLockersForDevice,
};
