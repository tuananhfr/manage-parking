import express from 'express';
import * as deviceController from '../controllers/device-controller.js';

const router = express.Router();

router.get('/', deviceController.getAllDevices);
router.get('/:id', deviceController.getDeviceById);
router.put('/:id', deviceController.updateDevice);
router.post('/:id/business-control', deviceController.businessControl);
router.post('/:id/maintenance', deviceController.maintenance);
router.post('/refresh-config', deviceController.refreshConfig);

export default router;
