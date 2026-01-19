import express from 'express';
import * as dashboardController from '../controllers/dashboard-controller.js';

const router = express.Router();

router.get('/overview', dashboardController.getOverview);
router.get('/usage-chart', dashboardController.getUsageChart);

export default router;
