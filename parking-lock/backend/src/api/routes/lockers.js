import express from "express";
import * as lockerController from "../controllers/locker-controller.js";

const router = express.Router();

router.get("/", lockerController.getAllLockers);
router.get("/:lock_id", lockerController.getLockerById);
router.post("/:lock_id/control", lockerController.controlLocker);
router.put("/:lock_id", lockerController.updateLocker);
router.post("/:lock_id/set-attribute", lockerController.setLockAttribute);
router.post("/:lock_id/free-time", lockerController.setFreeTime);
router.post("/:lock_id/warning-time", lockerController.setWarningTime);
router.post("/:lock_id/simulate-car-enter", lockerController.simulateCarEnter);
router.post("/:lock_id/simulate-car-exit", lockerController.simulateCarExit);
router.post("/:lock_id/process-payment", lockerController.processPayment);
router.post("/:lock_id/unlock-monthly", lockerController.unlockMonthly);

export default router;
