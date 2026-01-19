import logger from "../utils/logger.js";
import { formatLogTimestamp } from "../utils/helpers.js";

// Store socket connections: deviceId -> socket
const deviceConnections = new Map();

// Store reverse mapping: socket -> deviceId
const socketDevices = new Map();

/**
 * Register connection
 */
export function registerConnection(deviceId, socket) {
  // Remove old connection if exists
  if (deviceConnections.has(deviceId)) {
    const oldSocket = deviceConnections.get(deviceId);
    if (oldSocket !== socket) {
      logger.info(`Replacing old connection for device: ${deviceId}`);
      oldSocket.destroy();
    }
  }

  deviceConnections.set(deviceId, socket);
  socketDevices.set(socket, deviceId);

  logger.info(
    `Connection registered: ${deviceId} (${socket.remoteAddress}:${socket.remotePort})`
  );
}

/**
 * Unregister connection
 */
export function unregisterConnection(socket) {
  const deviceId = socketDevices.get(socket);

  if (deviceId) {
    deviceConnections.delete(deviceId);
    socketDevices.delete(socket);
    logger.info(`Connection unregistered: ${deviceId}`);
    return deviceId;
  }

  return null;
}

/**
 * Get socket by device ID
 */
export function getSocketByDeviceId(deviceId) {
  return deviceConnections.get(deviceId);
}

/**
 * Get device ID by socket
 */
export function getDeviceIdBySocket(socket) {
  return socketDevices.get(socket);
}

/**
 * Get all connected devices
 */
export function getAllConnectedDevices() {
  return Array.from(deviceConnections.keys());
}

/**
 * Get connection count
 */
export function getConnectionCount() {
  return deviceConnections.size;
}

/**
 * Check if device is connected
 */
export function isDeviceConnected(deviceId) {
  return deviceConnections.has(deviceId);
}

/**
 * Send message to device
 */
export function sendToDevice(deviceId, message) {
  const socket = getSocketByDeviceId(deviceId);

  if (!socket) {
    throw new Error(`Device not connected: ${deviceId}`);
  }

  return new Promise((resolve, reject) => {
    socket.write(message + "\n", (error) => {
      if (error) {
        logger.error(`Failed to send message to ${deviceId}:`, error);
        reject(error);
      } else {
        logger.debug(
          `[${formatLogTimestamp()}] Message sent to ${deviceId}: ${message}`
        );
        resolve();
      }
    });
  });
}

/**
 * Clear all connections
 */
export function clearAllConnections() {
  for (const socket of deviceConnections.values()) {
    socket.destroy();
  }

  deviceConnections.clear();
  socketDevices.clear();

  logger.info("All connections cleared");
}

export default {
  registerConnection,
  unregisterConnection,
  getSocketByDeviceId,
  getDeviceIdBySocket,
  getAllConnectedDevices,
  getConnectionCount,
  isDeviceConnected,
  sendToDevice,
  clearAllConnections,
};
