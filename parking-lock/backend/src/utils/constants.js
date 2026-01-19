// Device Status
export const DeviceStatus = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  ERROR: "ERROR",
};

// Locker Status
export const LockerStatus = {
  UP: "UP",
  DOWN: "DOWN",
};

// Locker Mode
export const LockerMode = {
  NORMAL: "NORMAL",
  PAYMENT: "PAYMENT",
  MAINTENANCE: "MAINTENANCE",
};

// Command Types
export const CommandType = {
  REGISTER: "Register",
  HEARTBEAT: "Heartbeat", // Real device sends "Heartbeat" not "HeartBeat"
  SYNC_TIME: "SyncTime",
  CHECK_LOCK: "CheckLock",
  LOCK_CONTROL: "LockControl",
  OPEN_LOCK_BY_PAYMENT: "OpenLockByPayment",
  CHECK_STATE: "CheckState",
  STATE: "State",
  CAR_ENTER_TIME: "CarEnterTime",
  LOCK_BUSINESS_CONTROL: "LockBusinessControl",
  SYSTEM_MAINTENANCE: "SystemMaintenance",
  SET_LOCK_ATTRIBUTE: "SetLockAttribute",
  LOCK_FREE_TIME: "LockFreeTime",
  LOCK_WARNING_TIME: "LockWarningTime",
  SERVER_CHECK_LOCK: "ServerCheckLock", // Protocol V1.4 Page 32: Query parking lock info
};

// Command Status
export const CommandStatus = {
  SENT: "SENT",
  ACK: "ACK",
  NACK: "NACK",
  TIMEOUT: "TIMEOUT",
  ERROR: "ERROR",
};

// Lock Control Mode
export const LockControlMode = {
  OPEN: "Open",
  CLOSE: "Close",
  NORMAL: "Normal",
  STOP: "Stop", // Stop immediately any lifting or lowering action
};

// Message Types
export const MessageType = {
  REQUEST: "Req",
  CONFIRM: "Cfm",
};

// Verdict
export const Verdict = {
  ACK: "ACK",
  NACK: "NACK",
};

// Trigger Types
export const TriggerType = {
  MANUAL: "MANUAL",
  AUTO: "AUTO",
  HEARTBEAT: "HEARTBEAT",
  PAYMENT: "PAYMENT",
  SYSTEM: "SYSTEM",
};

// WebSocket Events
export const WS_EVENTS = {
  LOCKER_STATUS_CHANGED: "locker:status:changed",
  LOCKER_MODE_CHANGED: "locker:mode:changed",
  DEVICE_STATUS_CHANGED: "device:status:changed",
  COMMAND_RESPONSE: "command:response",
  DEVICE_HEARTBEAT: "device:heartbeat",
  SYSTEM_ERROR: "system:error",
  SUBSCRIBE_DEVICE: "subscribe:device",
  SUBSCRIBE_LOCKER: "subscribe:locker",
  SUBSCRIBE_ALL: "subscribe:all",
};
