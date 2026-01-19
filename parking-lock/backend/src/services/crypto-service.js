import { encryptAES, decryptAES } from "../utils/helpers.js";
import config from "../config/config.js";
import logger from "../utils/logger.js";

/**
 * Encrypt serial number
 */
export function encryptSerialNumber(serialNumber) {
  try {
    return encryptAES(serialNumber, config.aes.key, config.aes.iv);
  } catch (error) {
    logger.error("Failed to encrypt serial number:", error);
    throw error;
  }
}

/**
 * Process serial number (no encryption according to manufacturer)
 * According to manufacturer: NO encryption, all values are in original text
 * SerialNumber may be Base64 encoded plain text, so we try to decode and extract valid text
 */
export function decryptSerialNumber(encryptedSerialNumber) {
  if (!encryptedSerialNumber || encryptedSerialNumber.trim().length === 0) {
    throw new Error("Empty serial number");
  }

  // According to manufacturer: no encryption, all values are original text
  // Try to decode as Base64 first (in case it's Base64 encoded plain text)
  try {
    const decoded = Buffer.from(encryptedSerialNumber, "base64").toString(
      "utf8"
    );

    // Remove null bytes and control characters, keep only printable ASCII
    const cleaned = decoded
      .replace(/\0/g, "") // Remove null bytes
      .replace(/[\x00-\x1F\x7F]/g, "") // Remove control characters
      .trim();

    // If we have valid printable characters after cleaning, use it
    if (cleaned.length > 0 && /^[\x20-\x7E]+$/.test(cleaned)) {
      logger.info(
        `SerialNumber decoded from Base64: "${cleaned}" (original: ${encryptedSerialNumber})`
      );
      return cleaned;
    }
  } catch (decodeError) {
    // If Base64 decode fails, it's probably plain text
    logger.debug(
      `SerialNumber decode failed (not Base64), using as-is: ${encryptedSerialNumber}`
    );
  }

  // Use original value (either it's plain text, or Base64 decode didn't produce valid text)
  logger.info(`Using SerialNumber as identifier: ${encryptedSerialNumber}`);
  return encryptedSerialNumber;
}

export default {
  encryptSerialNumber,
  decryptSerialNumber,
};
