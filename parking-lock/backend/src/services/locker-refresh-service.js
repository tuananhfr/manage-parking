import { getAllConnectedDevices } from "../tcp-server/connection-manager.js";
import { sendSystemMaintenance } from "../tcp-server/command-sender.js";
import logger from "../utils/logger.js";

/**
 * Broadcast reboot command to all online devices
 * This forces lockers to reconnect and receive updated Parks config
 *
 * Use case: When admin updates payment account settings,
 * we want all lockers to get the new QR prefix immediately
 */
export async function broadcastConfigUpdate() {
  const devices = getAllConnectedDevices();

  if (devices.length === 0) {
    logger.info("[REFRESH] No online devices to update");
    return { success: true, devicesUpdated: 0 };
  }

  logger.info(`[REFRESH] Broadcasting config update to ${devices.length} online devices`);

  const results = [];
  for (const deviceId of devices) {
    try {
      await sendSystemMaintenance(deviceId, "Reboot");
      results.push({ deviceId, success: true });
      logger.info(`[REFRESH] Sent reboot command to ${deviceId}`);
    } catch (error) {
      const errorMsg = error?.message || String(error);
      results.push({ deviceId, success: false, error: errorMsg });
      logger.error(`[REFRESH] Failed to send reboot to ${deviceId}: ${errorMsg}`);
      logger.error(`[REFRESH] Error stack:`, error);
    }
  }

  const successCount = results.filter(r => r.success).length;
  logger.info(`[REFRESH] Config update sent to ${successCount}/${devices.length} devices`);

  return {
    success: true,
    devicesUpdated: successCount,
    total: devices.length,
    results,
  };
}

export default {
  broadcastConfigUpdate,
};
