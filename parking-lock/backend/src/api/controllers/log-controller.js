import * as commandService from '../../services/command-service.js';
import * as logService from '../../services/log-service.js';

/**
 * GET /api/logs/commands
 */
export async function getCommandLogs(req, res, next) {
  try {
    const {
      lock_id,
      device_id,
      command_type,
      status,
      from_date,
      to_date,
      limit = 100,
      offset = 0
    } = req.query;

    const filters = {
      lock_id,
      device_id,
      command_type,
      status,
      from_date,
      to_date,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    const logs = commandService.getCommandLogs(filters);
    const total = commandService.getCommandLogsCount(filters);

    res.json({
      success: true,
      total,
      data: logs
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/logs/status
 */
export async function getStatusLogs(req, res, next) {
  try {
    const {
      lock_id,
      device_id,
      trigger_type,
      from_date,
      to_date,
      limit = 100,
      offset = 0
    } = req.query;

    const filters = {
      lock_id,
      device_id,
      trigger_type,
      from_date,
      to_date,
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    const logs = logService.getStatusLogs(filters);
    const total = logService.getStatusLogsCount(filters);

    res.json({
      success: true,
      total,
      data: logs
    });
  } catch (error) {
    next(error);
  }
}

export default {
  getCommandLogs,
  getStatusLogs
};
