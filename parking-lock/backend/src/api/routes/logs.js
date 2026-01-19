import express from 'express';
import * as logController from '../controllers/log-controller.js';

const router = express.Router();

router.get('/commands', logController.getCommandLogs);
router.get('/status', logController.getStatusLogs);

export default router;
