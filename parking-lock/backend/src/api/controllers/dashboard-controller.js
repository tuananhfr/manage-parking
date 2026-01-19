import { getDashboardStats } from '../../services/log-service.js';
import { getDatabase } from '../../database/db.js';

/**
 * GET /api/dashboard/overview
 */
export async function getOverview(req, res, next) {
  try {
    const stats = getDashboardStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/dashboard/usage-chart
 */
export async function getUsageChart(req, res, next) {
  try {
    const { type = 'hourly', from_date, to_date } = req.query;

    const db = getDatabase();

    // For simplicity, return last 24 hours hourly data
    const data = [];
    const now = new Date();

    for (let i = 23; i >= 0; i--) {
      const time = new Date(now.getTime() - i * 60 * 60 * 1000);
      const hour = time.toISOString().slice(0, 13) + ':00:00Z';

      // Get available and occupied counts at that hour
      // This is a simplified version - in production, you'd track this in logs
      const available = Math.floor(Math.random() * 20) + 20; // Random for demo
      const occupied = 40 - available;

      data.push({
        time: hour,
        available,
        occupied
      });
    }

    res.json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
}

export default {
  getOverview,
  getUsageChart
};
