import { getDatabase } from "../database/db.js";
import { formatTimestamp } from "../utils/helpers.js";
import logger from "../utils/logger.js";

/**
 * Create status log
 */
export function createStatusLog(data) {
  const db = getDatabase();

  const {
    lock_id = null,
    device_id = null,
    old_status = null,
    new_status = null,
    old_mode = null,
    new_mode = null,
    old_occupied = null,
    new_occupied = null,
    trigger_type,
    note = null,
  } = data;

  const result = db
    .prepare(
      `
    INSERT INTO status_logs (
      lock_id, device_id, old_status, new_status, old_mode, new_mode,
      old_occupied, new_occupied, trigger_type, changed_at, note
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .run(
      lock_id,
      device_id,
      old_status,
      new_status,
      old_mode,
      new_mode,
      old_occupied,
      new_occupied,
      trigger_type,
      formatTimestamp(),
      note
    );

  logger.debug(
    `Status log created: ${trigger_type} for ${lock_id || device_id}`
  );

  return result.lastInsertRowid;
}

/**
 * Get status logs
 */
export function getStatusLogs(filters = {}) {
  const db = getDatabase();
  let sql = "SELECT * FROM status_logs WHERE 1=1";
  const params = [];

  if (filters.lock_id) {
    sql += " AND lock_id = ?";
    params.push(filters.lock_id);
  }

  if (filters.device_id) {
    sql += " AND device_id = ?";
    params.push(filters.device_id);
  }

  if (filters.trigger_type) {
    sql += " AND trigger_type = ?";
    params.push(filters.trigger_type);
  }

  if (filters.from_date) {
    sql += " AND changed_at >= ?";
    params.push(filters.from_date);
  }

  if (filters.to_date) {
    sql += " AND changed_at <= ?";
    params.push(filters.to_date);
  }

  sql += " ORDER BY changed_at DESC";

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
 * Get status logs count
 */
export function getStatusLogsCount(filters = {}) {
  const db = getDatabase();
  let sql = "SELECT COUNT(*) as count FROM status_logs WHERE 1=1";
  const params = [];

  if (filters.lock_id) {
    sql += " AND lock_id = ?";
    params.push(filters.lock_id);
  }

  if (filters.device_id) {
    sql += " AND device_id = ?";
    params.push(filters.device_id);
  }

  if (filters.trigger_type) {
    sql += " AND trigger_type = ?";
    params.push(filters.trigger_type);
  }

  if (filters.from_date) {
    sql += " AND changed_at >= ?";
    params.push(filters.from_date);
  }

  if (filters.to_date) {
    sql += " AND changed_at <= ?";
    params.push(filters.to_date);
  }

  const result = db.prepare(sql).get(params);
  return result.count;
}

/**
 * Get dashboard stats
 */
export function getDashboardStats() {
  const db = getDatabase();

  // Device stats
  const totalDevices = db
    .prepare("SELECT COUNT(*) as count FROM devices")
    .get().count;
  const onlineDevices = db
    .prepare("SELECT COUNT(*) as count FROM devices WHERE status = ?")
    .get("ONLINE").count;
  const offlineDevices = db
    .prepare("SELECT COUNT(*) as count FROM devices WHERE status = ?")
    .get("OFFLINE").count;

  // Locker stats - only count connected lockers
  const totalLockers = db
    .prepare("SELECT COUNT(*) as count FROM lockers WHERE connected = 1")
    .get().count;
  const availableLockers = db
    .prepare(
      "SELECT COUNT(*) as count FROM lockers WHERE connected = 1 AND status = ? AND occupied = 0"
    )
    .get("UP").count;
  const occupiedLockers = db
    .prepare(
      "SELECT COUNT(*) as count FROM lockers WHERE connected = 1 AND occupied = 1"
    )
    .get().count;
  const errorLockers = db
    .prepare(
      "SELECT COUNT(*) as count FROM lockers WHERE connected = 1 AND mode = ?"
    )
    .get("MAINTENANCE").count;

  // Command stats (today)
  const today = new Date().toISOString().split("T")[0];
  const todayCommands = db
    .prepare(
      "SELECT COUNT(*) as count FROM command_logs WHERE DATE(sent_at) = ?"
    )
    .get(today).count;
  const todayOpens = db
    .prepare(
      `
    SELECT COUNT(*) as count FROM command_logs
    WHERE DATE(sent_at) = ?
    AND command_type IN ('LockControl', 'OpenLockByPayment')
    AND status = 'ACK'
  `
    )
    .get(today).count;

  return {
    total_devices: totalDevices,
    online_devices: onlineDevices,
    offline_devices: offlineDevices,
    total_lockers: totalLockers,
    available_lockers: availableLockers,
    occupied_lockers: occupiedLockers,
    error_lockers: errorLockers,
    today_commands: todayCommands,
    today_opens: todayOpens,
    today_closes: todayCommands - todayOpens,
    uptime_percentage:
      totalDevices > 0 ? ((onlineDevices / totalDevices) * 100).toFixed(1) : 0,
  };
}

export default {
  createStatusLog,
  getStatusLogs,
  getStatusLogsCount,
  getDashboardStats,
};
