import * as settingsService from "../../services/settings-service.js";
import logger from "../../utils/logger.js";

/**
 * GET /api/settings/global-hourly-rate
 * Get global hourly rate
 */
export async function getGlobalHourlyRate(req, res, next) {
  try {
    const rate = settingsService.getGlobalHourlyRate();

    res.json({
      success: true,
      data: {
        rate
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/settings/global-hourly-rate
 * Update global hourly rate and copy to all lockers
 */
export async function updateGlobalHourlyRate(req, res, next) {
  try {
    const { rate } = req.body;

    if (!rate || rate <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid rate. Must be a positive number."
      });
    }

    const result = settingsService.updateGlobalHourlyRate(parseInt(rate));

    logger.info(`Global hourly rate updated to ${rate} VND, applied to ${result.lockers_updated} lockers`);

    res.json({
      success: true,
      message: `Global hourly rate updated to ${rate} VND and applied to ${result.lockers_updated} lockers`,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/settings
 * Get all settings
 */
export async function getAllSettings(req, res, next) {
  try {
    const settings = settingsService.getAllSettings();

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    next(error);
  }
}

export default {
  getGlobalHourlyRate,
  updateGlobalHourlyRate,
  getAllSettings
};
