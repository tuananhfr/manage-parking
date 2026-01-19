import { io, Socket } from "socket.io-client";
import config from "../config/config";

class SocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, Set<Function>> = new Map();

  connect() {
    if (this.socket?.connected) {
      console.log("Socket already connected");
      return;
    }

    this.socket = io(config.wsUrl, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    this.socket.on("connect", () => {
      console.log("WebSocket connected");
      // Subscribe to all events by default
      this.socket?.emit("subscribe:all", {});
    });

    this.socket.on("disconnect", () => {
      console.log("WebSocket disconnected");
    });

    this.socket.on("connect_error", (error) => {
      console.error("WebSocket connection error:", error);
    });

    // Forward all events to listeners
    const events = [
      "locker:status:changed",
      "locker:mode:changed",
      "device:status:changed",
      "command:response",
      "device:heartbeat",
      "device:checklock",
      "system:error",
      "payment:confirmed",
    ];

    events.forEach((event) => {
      this.socket?.on(event, (data) => {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
          callbacks.forEach((callback) => callback(data));
        }
      });
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: Function) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  subscribeToDevice(deviceId: string) {
    this.socket?.emit("subscribe:device", { device_id: deviceId });
  }

  subscribeToLocker(lockId: string) {
    this.socket?.emit("subscribe:locker", { lock_id: lockId });
  }

  isConnected() {
    return this.socket?.connected || false;
  }
}

export const socketService = new SocketService();
export default socketService;
