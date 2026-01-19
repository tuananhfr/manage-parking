import { Server } from 'socket.io';
import logger from '../utils/logger.js';
import { WS_EVENTS } from '../utils/constants.js';

let io = null;

/**
 * Initialize WebSocket server
 */
export function initWebSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    logger.info(`WebSocket client connected: ${socket.id}`);

    // Handle subscriptions
    socket.on(WS_EVENTS.SUBSCRIBE_DEVICE, (data) => {
      const { device_id } = data;
      socket.join(`device:${device_id}`);
      logger.debug(`Client ${socket.id} subscribed to device: ${device_id}`);
    });

    socket.on(WS_EVENTS.SUBSCRIBE_LOCKER, (data) => {
      const { lock_id } = data;
      socket.join(`locker:${lock_id}`);
      logger.debug(`Client ${socket.id} subscribed to locker: ${lock_id}`);
    });

    socket.on(WS_EVENTS.SUBSCRIBE_ALL, () => {
      socket.join('all');
      logger.debug(`Client ${socket.id} subscribed to all events`);
    });

    socket.on('disconnect', () => {
      logger.info(`WebSocket client disconnected: ${socket.id}`);
    });
  });

  logger.info('WebSocket server initialized');

  return io;
}

/**
 * Emit event to all clients
 */
export function emitToAll(event, data) {
  if (!io) {
    logger.warn('WebSocket server not initialized');
    return;
  }

  io.to('all').emit(event, data);
  logger.debug(`Event emitted to all: ${event}`);
}

/**
 * Emit event to specific device subscribers
 */
export function emitToDevice(deviceId, event, data) {
  if (!io) {
    logger.warn('WebSocket server not initialized');
    return;
  }

  io.to(`device:${deviceId}`).emit(event, data);
  io.to('all').emit(event, data);
  logger.debug(`Event emitted to device ${deviceId}: ${event}`);
}

/**
 * Emit event to specific locker subscribers
 */
export function emitToLocker(lockId, event, data) {
  if (!io) {
    logger.warn('WebSocket server not initialized');
    return;
  }

  io.to(`locker:${lockId}`).emit(event, data);
  io.to('all').emit(event, data);
  logger.debug(`Event emitted to locker ${lockId}: ${event}`);
}

/**
 * Get WebSocket event emitter function for TCP server
 */
export function getEventEmitter() {
  return (event, data) => {
    if (!io) {
      logger.warn('WebSocket server not initialized');
      return;
    }

    // Emit to appropriate subscribers based on event type
    if (data.device_id && event.includes('device')) {
      emitToDevice(data.device_id, event, data);
    } else if (data.lock_id && event.includes('locker')) {
      emitToLocker(data.lock_id, event, data);
    } else {
      emitToAll(event, data);
    }
  };
}

export default {
  initWebSocket,
  emitToAll,
  emitToDevice,
  emitToLocker,
  getEventEmitter
};
