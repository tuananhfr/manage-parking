import express from "express";
import * as settingsController from "../controllers/settings-controller.js";

const router = express.Router();

router.get("/", settingsController.getAllSettings);
router.get("/global-hourly-rate", settingsController.getGlobalHourlyRate);
router.post("/global-hourly-rate", settingsController.updateGlobalHourlyRate);

export default router;
