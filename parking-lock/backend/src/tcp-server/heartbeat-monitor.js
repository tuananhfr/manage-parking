import config from '../config/config.js';
import { checkOfflineDevices } from '../services/device-service.js';
import { getAllConnectedDevices } from './connection-manager.js';
import logger from '../utils/logger.js';

let heartbeatInterval = null;

/**
 * Start heartbeat monitor
 */
export function startHeartbeatMonitor() {
  if (heartbeatInterval) {
    logger.warn('Heartbeat monitor already running');
    return;
  }

  const checkInterval = config.heartbeat.timeout * 1000; // Convert to milliseconds

  heartbeatInterval = setInterval(() => {
    try {
      const changedCount = checkOfflineDevices(config.heartbeat.timeout);

      if (changedCount > 0) {
        logger.info(`Heartbeat check: ${changedCount} devices marked offline`);
      }

      const connectedDevices = getAllConnectedDevices();
      logger.debug(`Heartbeat check: ${connectedDevices.length} devices connected`);
    } catch (error) {
      logger.error('Heartbeat monitor error:', error);
    }
  }, checkInterval);

  logger.info(`Heartbeat monitor started (interval: ${config.heartbeat.timeout}s)`);
}

/**
 * Stop heartbeat monitor
 */
export function stopHeartbeatMonitor() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    logger.info('Heartbeat monitor stopped');
  }
}

export default {
  startHeartbeatMonitor,
  stopHeartbeatMonitor
};
