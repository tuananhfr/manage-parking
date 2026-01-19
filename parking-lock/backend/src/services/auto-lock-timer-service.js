import { getLockerById } from "./locker-service.js";
import { sendLockControl } from "../tcp-server/command-sender.js";
import { LockControlMode } from "../utils/constants.js";
import logger from "../utils/logger.js";

/**
 * Auto-lock timer service
 * Simulates hardware behavior: when car enters, countdown free time and auto-raise lock
 */

// Store active timers: { lock_id: { timeoutId, freeTimeoutId, warningTimeoutId, startTime } }
const activeTimers = new Map();

/**
 * Start auto-lock timer when car enters
 * Simulates hardware: delay lock_free_time minutes, then auto-raise lock
 */
export function startAutoLockTimer(lockId) {
  // Clear any existing timer for this lock
  clearAutoLockTimer(lockId);

  // Get locker data
  const locker = getLockerById(lockId);
  if (!locker) {
    logger.warn(`[AUTO-LOCK] Cannot start timer: locker ${lockId} not found`);
    return;
  }

  // Check if free time is set
  const freeTimeMinutes = locker.lock_free_time;
  const warningTimeSeconds = locker.lock_warning_time || 0;

  if (freeTimeMinutes === null || freeTimeMinutes === undefined) {
    logger.info(
      `[AUTO-LOCK] Timer not started for ${lockId}: lock_free_time not set`
    );
    return;
  }

  logger.info(
    `[AUTO-LOCK] Starting timer for ${lockId}: ${freeTimeMinutes} minutes free time, ${warningTimeSeconds} seconds warning`
  );

  const startTime = Date.now();

  // Calculate timeout durations
  const freeTimeMs = freeTimeMinutes * 60 * 1000; // Convert minutes to milliseconds
  const warningTimeMs = warningTimeSeconds * 1000; // Convert seconds to milliseconds
  const totalTimeMs = freeTimeMs + warningTimeMs;

  let warningTimeoutId = null;
  let lockTimeoutId = null;

  // Set warning timeout (if warning time > 0)
  if (warningTimeSeconds > 0) {
    warningTimeoutId = setTimeout(() => {
      logger.info(
        `[AUTO-LOCK] Warning period started for ${lockId}: ${warningTimeSeconds} seconds before auto-lock`
      );
      // In real hardware, this might trigger beeper or visual warning
      // For now, just log it
    }, freeTimeMs);
  }

  // Set auto-lock timeout
  lockTimeoutId = setTimeout(async () => {
    try {
      logger.info(
        `[AUTO-LOCK] Auto-raising lock for ${lockId} after ${freeTimeMinutes} minutes + ${warningTimeSeconds} seconds`
      );

      // Send LockControl Open command (UP = hold car)
      await sendLockControl(lockId, LockControlMode.OPEN);

      logger.info(`[AUTO-LOCK] Lock raised successfully for ${lockId}`);

      // Remove timer from active list
      activeTimers.delete(lockId);
    } catch (error) {
      logger.error(
        `[AUTO-LOCK] Failed to auto-raise lock for ${lockId}:`,
        error
      );
    }
  }, totalTimeMs);

  // Store timer info
  activeTimers.set(lockId, {
    startTime,
    freeTimeMinutes,
    warningTimeSeconds,
    warningTimeoutId,
    lockTimeoutId,
  });

  logger.info(
    `[AUTO-LOCK] Timer active for ${lockId}: will auto-lock in ${
      totalTimeMs / 1000
    } seconds`
  );
}

/**
 * Clear auto-lock timer (when car exits or payment processed)
 */
export function clearAutoLockTimer(lockId) {
  const timerInfo = activeTimers.get(lockId);

  if (!timerInfo) {
    return; // No active timer
  }

  // Clear timeouts
  if (timerInfo.warningTimeoutId) {
    clearTimeout(timerInfo.warningTimeoutId);
  }
  if (timerInfo.lockTimeoutId) {
    clearTimeout(timerInfo.lockTimeoutId);
  }

  // Remove from active list
  activeTimers.delete(lockId);

  logger.info(`[AUTO-LOCK] Timer cleared for ${lockId}`);
}

/**
 * Get remaining time for a lock (in seconds)
 * Returns null if no active timer
 */
export function getRemainingTime(lockId) {
  const timerInfo = activeTimers.get(lockId);

  if (!timerInfo) {
    return null;
  }

  const { startTime, freeTimeMinutes, warningTimeSeconds } = timerInfo;
  const totalTimeMs = freeTimeMinutes * 60 * 1000 + warningTimeSeconds * 1000;
  const elapsedMs = Date.now() - startTime;
  const remainingMs = totalTimeMs - elapsedMs;

  return Math.max(0, Math.floor(remainingMs / 1000)); // Return seconds
}

/**
 * Get all active timers (for debugging)
 */
export function getActiveTimers() {
  const timers = [];

  for (const [lockId, timerInfo] of activeTimers.entries()) {
    const remainingSeconds = getRemainingTime(lockId);
    timers.push({
      lock_id: lockId,
      free_time_minutes: timerInfo.freeTimeMinutes,
      warning_time_seconds: timerInfo.warningTimeSeconds,
      remaining_seconds: remainingSeconds,
      started_at: new Date(timerInfo.startTime).toISOString(),
    });
  }

  return timers;
}

/**
 * Clear all timers (for cleanup on server shutdown)
 */
export function clearAllTimers() {
  logger.info(`[AUTO-LOCK] Clearing all ${activeTimers.size} active timers`);

  for (const lockId of activeTimers.keys()) {
    clearAutoLockTimer(lockId);
  }
}

export default {
  startAutoLockTimer,
  clearAutoLockTimer,
  getRemainingTime,
  getActiveTimers,
  clearAllTimers,
};
