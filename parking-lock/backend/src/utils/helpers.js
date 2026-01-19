import crypto from "crypto";

/**
 * Generate unique device ID
 */
export function generateDeviceId(existingIds = []) {
  let id = 1;
  let deviceId;

  do {
    deviceId = `PK${String(id).padStart(3, "0")}`;
    id++;
  } while (existingIds.includes(deviceId));

  return deviceId;
}

/**
 * Generate lock ID from device ID and lock number
 */
export function generateLockId(deviceId, lockNumber) {
  return `${deviceId}-${String(lockNumber).padStart(2, "0")}`;
}

/**
 * Parse lock ID to get device ID and lock number
 */
export function parseLockId(lockId) {
  const parts = lockId.split("-");
  if (parts.length !== 2) {
    throw new Error("Invalid lock ID format");
  }

  return {
    deviceId: parts[0],
    lockNumber: parseInt(parts[1], 10),
  };
}

/**
 * Validate lock ID format
 */
export function isValidLockId(lockId) {
  const pattern = /^PK\d{3}-\d{2}$/;
  return pattern.test(lockId);
}

/**
 * Validate device ID format
 */
export function isValidDeviceId(deviceId) {
  const pattern = /^PK\d{3}$/;
  return pattern.test(deviceId);
}

/**
 * Format timestamp to ISO string
 */
export function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

/**
 * Format timestamp for log display: HH:mm:ss DD/MM/YYYY
 */
export function formatLogTimestamp(date = new Date()) {
  const d = new Date(date);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${hours}:${minutes}:${seconds} ${day}/${month}/${year}`;
}

/**
 * Calculate minutes difference between two dates
 */
export function minutesDifference(date1, date2) {
  return Math.floor((date2 - date1) / (1000 * 60));
}

/**
 * Add minutes to date
 */
export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

/**
 * Encrypt data with AES-128-CBC
 */
export function encryptAES(text, key, iv) {
  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    Buffer.from(key, "base64"),
    Buffer.from(iv, "base64")
  );
  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

/**
 * Decrypt data with AES-128-CBC
 */
export function decryptAES(encryptedText, key, iv) {
  try {
    const decipher = crypto.createDecipheriv(
      "aes-128-cbc",
      Buffer.from(key, "base64"),
      Buffer.from(iv, "base64")
    );
    let decrypted = decipher.update(encryptedText, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    throw new Error("Decryption failed: " + error.message);
  }
}

/**
 * Safe JSON parse
 */
export function safeJsonParse(str, defaultValue = null) {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

/**
 * Safe JSON stringify
 */
export function safeJsonStringify(obj, defaultValue = "{}") {
  try {
    return JSON.stringify(obj);
  } catch {
    return defaultValue;
  }
}
