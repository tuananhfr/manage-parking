import * as deviceService from "../../services/device-service.js";
import * as lockerService from "../../services/locker-service.js";
import {
  sendLockBusinessControl,
  sendSystemMaintenance,
} from "../../tcp-server/command-sender.js";
import { broadcastConfigUpdate } from "../../services/locker-refresh-service.js";
import logger from "../../utils/logger.js";

/**
 * GET /api/devices
 */
export async function getAllDevices(req, res, next) {
  try {
    const { status, limit = 100, offset = 0 } = req.query;

    const filters = {
      status,
      limit: parseInt(limit),
      offset: parseInt(offset),
    };

    const devices = deviceService.getAllDevices(filters);
    const total = deviceService.getDeviceCount({ status });

    // Add locker counts to each device - only count connected lockers
    const devicesWithCounts = devices.map((device) => {
      const allLockers = lockerService.getLockersByDeviceId(device.id);
      const connectedLockers = allLockers.filter((l) => l.connected === 1);
      const onlineCount = connectedLockers.filter(
        (l) => l.status === "UP" && !l.occupied
      ).length;

      return {
        ...device,
        locker_count: connectedLockers.length,
        online_count: onlineCount,
      };
    });

    res.json({
      success: true,
      total,
      data: devicesWithCounts,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/devices/:id
 */
export async function getDeviceById(req, res, next) {
  try {
    const { id } = req.params;

    const device = deviceService.getDeviceById(id);

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    // Get lockers
    const lockers = lockerService.getLockersByDeviceId(id);

    res.json({
      success: true,
      data: {
        ...device,
        lockers,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/devices/:id
 */
export async function updateDevice(req, res, next) {
  try {
    const { id } = req.params;
    const { name, location } = req.body;

    const device = deviceService.getDeviceById(id);

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    const updated = deviceService.updateDevice(id, { name, location });

    res.json({
      success: true,
      message: "Device updated successfully",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/devices/:id/business-control
 * Control parking lot business (Open/Close)
 */
export async function businessControl(req, res, next) {
  try {
    const { id } = req.params;
    const { mode } = req.body;

    if (!mode || !["Open", "Close"].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mode. Must be "Open" or "Close"',
      });
    }

    const device = deviceService.getDeviceById(id);
    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    const commandId = await sendLockBusinessControl(id, mode);

    res.json({
      success: true,
      message: `Business control command sent: ${mode}`,
      data: {
        command_id: commandId,
        device_id: id,
        mode,
        status: "SENT",
        sent_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/devices/:id/maintenance
 * System maintenance (Reboot/ClearErr)
 */
export async function maintenance(req, res, next) {
  try {
    const { id } = req.params;
    const { command, device_type, serial_number } = req.body;

    if (!command || !["Reboot", "ClearErr"].includes(command)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid command. Must be "Reboot" or "ClearErr"',
      });
    }

    const device = deviceService.getDeviceById(id);
    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    const commandId = await sendSystemMaintenance(
      id,
      command,
      device_type || null,
      serial_number || null
    );

    res.json({
      success: true,
      message: `Maintenance command sent: ${command}`,
      data: {
        command_id: commandId,
        device_id: id,
        command,
        status: "SENT",
        sent_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/devices/refresh-config
 * Broadcast config update to all online devices
 * Forces all lockers to reboot and reconnect to get updated Parks field
 */
export async function refreshConfig(req, res, next) {
  try {
    const result = await broadcastConfigUpdate();

    res.json({
      success: true,
      message: `Config refresh sent to ${result.devicesUpdated} devices`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export default {
  getAllDevices,
  getDeviceById,
  updateDevice,
  businessControl,
  maintenance,
  refreshConfig,
};
