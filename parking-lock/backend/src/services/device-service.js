import { getDatabase } from "../database/db.js";
import { generateDeviceId, formatTimestamp } from "../utils/helpers.js";
import { DeviceStatus } from "../utils/constants.js";
import logger from "../utils/logger.js";

/**
 * Get all devices
 */
export function getAllDevices(filters = {}) {
  const db = getDatabase();
  let sql = "SELECT * FROM devices WHERE 1=1";
  const params = [];

  if (filters.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }

  sql += " ORDER BY id ASC";

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
 * Get device by ID
 */
export function getDeviceById(deviceId) {
  const db = getDatabase();
  return db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId);
}

/**
 * Get device by serial number
 */
export function getDeviceBySerialNumber(serialNumber) {
  const db = getDatabase();
  return db
    .prepare("SELECT * FROM devices WHERE serial_number = ?")
    .get(serialNumber);
}

/**
 * Create new device
 */
export function createDevice(serialNumber, ipAddress = null) {
  const db = getDatabase();

  // Generate unique device ID
  const existingIds = db
    .prepare("SELECT id FROM devices")
    .all()
    .map((d) => d.id);
  const deviceId = generateDeviceId(existingIds);

  const now = formatTimestamp();

  const result = db
    .prepare(
      `
    INSERT INTO devices (id, serial_number, status, ip_address, registered_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(deviceId, serialNumber, DeviceStatus.ONLINE, ipAddress, now, now, now);

  logger.info(`Device created: ${deviceId} (SN: ${serialNumber})`);

  return getDeviceById(deviceId);
}

/**
 * Create device with specific ID (for auto-recovery scenarios)
 * Used when device ID is known but device doesn't exist in database
 */
export function createDeviceWithId(deviceId, serialNumber, ipAddress = null) {
  const db = getDatabase();

  // Check if device ID already exists
  const existing = getDeviceById(deviceId);
  if (existing) {
    logger.warn(`Device ${deviceId} already exists, returning existing device`);
    return existing;
  }

  const now = formatTimestamp();

  const result = db
    .prepare(
      `
    INSERT INTO devices (id, serial_number, status, ip_address, registered_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(deviceId, serialNumber, DeviceStatus.ONLINE, ipAddress, now, now, now);

  logger.info(`Device created with ID: ${deviceId} (SN: ${serialNumber})`);

  return getDeviceById(deviceId);
}

/**
 * Update device
 */
export function updateDevice(deviceId, updates) {
  const db = getDatabase();

  const allowedFields = [
    "name",
    "location",
    "status",
    "ip_address",
    "last_seen",
    "metadata",
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
    return getDeviceById(deviceId);
  }

  fields.push("updated_at = ?");
  values.push(formatTimestamp());
  values.push(deviceId);

  const sql = `UPDATE devices SET ${fields.join(", ")} WHERE id = ?`;
  db.prepare(sql).run(values);

  logger.info(`Device updated: ${deviceId}`);

  return getDeviceById(deviceId);
}

/**
 * Update device status
 */
export function updateDeviceStatus(deviceId, status, ipAddress = null) {
  const updates = {
    status,
    last_seen: formatTimestamp(),
  };

  if (ipAddress) {
    updates.ip_address = ipAddress;
  }

  return updateDevice(deviceId, updates);
}

/**
 * Delete device
 */
export function deleteDevice(deviceId) {
  const db = getDatabase();
  const result = db.prepare("DELETE FROM devices WHERE id = ?").run(deviceId);

  logger.info(`Device deleted: ${deviceId}`);

  return result.changes > 0;
}

/**
 * Get device count
 */
export function getDeviceCount(filters = {}) {
  const db = getDatabase();
  let sql = "SELECT COUNT(*) as count FROM devices WHERE 1=1";
  const params = [];

  if (filters.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }

  const result = db.prepare(sql).get(params);
  return result.count;
}

/**
 * Check offline devices
 */
export function checkOfflineDevices(timeoutSeconds = 60) {
  const db = getDatabase();

  const cutoffTime = new Date(Date.now() - timeoutSeconds * 1000).toISOString();

  const result = db
    .prepare(
      `
    UPDATE devices
    SET status = ?, updated_at = ?
    WHERE status = ?
    AND (last_seen IS NULL OR last_seen < ?)
  `
    )
    .run(
      DeviceStatus.OFFLINE,
      formatTimestamp(),
      DeviceStatus.ONLINE,
      cutoffTime
    );

  if (result.changes > 0) {
    logger.info(`Marked ${result.changes} devices as OFFLINE`);
  }

  return result.changes;
}

export default {
  getAllDevices,
  getDeviceById,
  getDeviceBySerialNumber,
  createDevice,
  createDeviceWithId,
  updateDevice,
  updateDeviceStatus,
  deleteDevice,
  getDeviceCount,
  checkOfflineDevices,
};
