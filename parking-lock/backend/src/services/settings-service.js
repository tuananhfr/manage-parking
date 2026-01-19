import { query, queryOne, execute } from "../database/db.js";
import logger from "../utils/logger.js";

/**
 * Get a setting by key
 */
export function getSetting(key) {
  try {
    const sql = `SELECT * FROM settings WHERE key = ?`;
    return queryOne(sql, [key]);
  } catch (error) {
    logger.error(`Error getting setting ${key}:`, error);
    throw error;
  }
}

/**
 * Get setting value by key
 */
export function getSettingValue(key, defaultValue = null) {
  try {
    const setting = getSetting(key);
    return setting ? setting.value : defaultValue;
  } catch (error) {
    logger.error(`Error getting setting value ${key}:`, error);
    return defaultValue;
  }
}

/**
 * Update a setting value
 */
export function updateSetting(key, value) {
  try {
    const sql = `
      UPDATE settings
      SET value = ?, updated_at = CURRENT_TIMESTAMP
      WHERE key = ?
    `;
    const result = execute(sql, [value, key]);
    return result.changes > 0;
  } catch (error) {
    logger.error(`Error updating setting ${key}:`, error);
    throw error;
  }
}

/**
 * Create a new setting
 */
export function createSetting(key, value, type = 'string', description = null) {
  try {
    const sql = `
      INSERT INTO settings (key, value, type, description)
      VALUES (?, ?, ?, ?)
    `;
    execute(sql, [key, value, type, description]);
    return getSetting(key);
  } catch (error) {
    logger.error(`Error creating setting ${key}:`, error);
    throw error;
  }
}

/**
 * Get or create a setting
 */
export function getOrCreateSetting(key, defaultValue, type = 'string', description = null) {
  try {
    let setting = getSetting(key);
    if (!setting) {
      setting = createSetting(key, defaultValue, type, description);
    }
    return setting;
  } catch (error) {
    logger.error(`Error getting or creating setting ${key}:`, error);
    throw error;
  }
}

/**
 * Get global hourly rate
 */
export function getGlobalHourlyRate() {
  try {
    const value = getSettingValue('global_hourly_rate', '50000');
    return parseInt(value);
  } catch (error) {
    logger.error('Error getting global hourly rate:', error);
    return 50000; // Default fallback
  }
}

/**
 * Update global hourly rate and copy to all lockers
 */
export function updateGlobalHourlyRate(rate) {
  try {
    // Update global setting
    updateSetting('global_hourly_rate', rate.toString());

    // Copy to all lockers
    const sql = `UPDATE lockers SET hourly_rate = ?`;
    const result = execute(sql, [rate]);

    logger.info(`Global hourly rate updated to ${rate}, applied to ${result.changes} lockers`);

    return {
      rate,
      lockers_updated: result.changes
    };
  } catch (error) {
    logger.error('Error updating global hourly rate:', error);
    throw error;
  }
}

/**
 * Get all settings
 */
export function getAllSettings() {
  try {
    const sql = `SELECT * FROM settings ORDER BY setting_key`;
    return query(sql);
  } catch (error) {
    logger.error('Error getting all settings:', error);
    throw error;
  }
}

export default {
  getSetting,
  getSettingValue,
  updateSetting,
  createSetting,
  getOrCreateSetting,
  getGlobalHourlyRate,
  updateGlobalHourlyRate,
  getAllSettings
};
