import { useState, useEffect, useCallback } from "react";
import { CENTRAL_URL } from "../config";

/**
 * Global Connection Status Manager - WebSocket Based
 *
 * Monitors backend connection status using WebSocket (real-time, no polling):
 * - isConnected: boolean (backend online/offline)
 * - lastConnectedTime: timestamp của lần connected cuối
 * - retry mechanism: tự động retry khi backend down
 * - Fallback: HTTP polling nếu WebSocket không kết nối được
 *
 * Usage:
 *   const { isConnected, checkConnection } = useConnectionStatus();
 */

//Global state de share giua tat ca components
let globalIsConnected = null;
let globalLastConnectedTime = null;
let globalLastDisconnectedTime = null;
let globalListeners = new Set();
let globalWebSocket = null;
let globalReconnectTimer = null;
let globalPingInterval = null;
let globalFallbackTimer = null; // Fallback HTTP polling nếu WebSocket fail

const notifyListeners = () => {
  globalListeners.forEach((listener) => {
    listener({
      isConnected: globalIsConnected,
      lastConnectedTime: globalLastConnectedTime,
      lastDisconnectedTime: globalLastDisconnectedTime,
    });
  });
};

// Fallback HTTP check (chỉ dùng khi WebSocket không kết nối được)
const checkBackendHealthHTTP = async () => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); //3s timeout

    const response = await fetch(`${CENTRAL_URL}/api/status`, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const wasDisconnected = globalIsConnected === false;
      globalIsConnected = true;
      globalLastConnectedTime = Date.now();

      if (wasDisconnected) {
        // console.log("[Connection] Backend reconnected via HTTP fallback!");
        // Thử kết nối lại WebSocket khi HTTP OK
        startWebSocketConnection();
      }

      notifyListeners();
      return true;
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (err) {
    const wasConnected = globalIsConnected === true;
    globalIsConnected = false;
    globalLastDisconnectedTime = Date.now();

    if (wasConnected) {
      // console.log("[Connection] Backend disconnected (HTTP fallback):", err.message);
    }

    notifyListeners();
    return false;
  }
};

// WebSocket connection để detect connection status real-time
const startWebSocketConnection = () => {
    // Disabled WebSocket connection for NVR architecture compatibility
    // console.log("[Connection] WebSocket monitoring disabled");
    return;
};

const stopWebSocketConnection = () => {
  if (globalReconnectTimer) {
    clearTimeout(globalReconnectTimer);
    globalReconnectTimer = null;
  }

  if (globalPingInterval) {
    clearInterval(globalPingInterval);
    globalPingInterval = null;
  }

  if (globalFallbackTimer) {
    clearInterval(globalFallbackTimer);
    globalFallbackTimer = null;
  }

  if (globalWebSocket) {
    try {
      globalWebSocket.onclose = null; // Prevent reconnection
      globalWebSocket.close();
    } catch (e) {
      // Ignore
    }
    globalWebSocket = null;
  }
};

const useConnectionStatus = () => {
  const [state, setState] = useState({
    isConnected: globalIsConnected,
    lastConnectedTime: globalLastConnectedTime,
    lastDisconnectedTime: globalLastDisconnectedTime,
  });

  useEffect(() => {
    //Register listener
    const listener = (newState) => {
      setState(newState);
    };
    globalListeners.add(listener);

    //Start WebSocket connection neu chua chay
    if (!globalWebSocket || globalWebSocket.readyState === WebSocket.CLOSED) {
      // Always start with HTTP check and keep polling
      checkBackendHealthHTTP().then(() => {
        // WebSocket disabled, just start polling if not already started
        if (!globalFallbackTimer) {
            globalFallbackTimer = setInterval(() => {
                checkBackendHealthHTTP();
            }, 10000);
        }
      });
    }

    return () => {
      //Unregister listener
      globalListeners.delete(listener);

      //Stop WebSocket connection neu khong con listeners
      if (globalListeners.size === 0) {
        stopWebSocketConnection();
      }
    };
  }, []);

  const checkConnection = useCallback(async () => {
    // Manual check: thử HTTP trước, sau đó đảm bảo WebSocket đang chạy
    const httpOk = await checkBackendHealthHTTP();
    if (httpOk && (!globalWebSocket || globalWebSocket.readyState !== WebSocket.OPEN)) {
      startWebSocketConnection();
    }
    return httpOk;
  }, []);

  return {
    isConnected: state.isConnected,
    lastConnectedTime: state.lastConnectedTime,
    lastDisconnectedTime: state.lastDisconnectedTime,
    checkConnection,
  };
};

export default useConnectionStatus;
