import { useState, useEffect } from "react";
import { CENTRAL_URL } from "../config";
import useConnectionStatus from "./useConnectionStatus";

/**
 * Custom hook để quản lý cameras (progressive loading + WebSocket)
 * - Auto-reconnect khi backend down → up
 */
const useCameras = () => {
  const [cameras, setCameras] = useState([]);
  const { isConnected } = useConnectionStatus();
  const [previousConnection, setPreviousConnection] = useState(null);

  //Auto-refetch cameras khi backend reconnect (CHI khi false → true, KHONG phai null → true)
  useEffect(() => {
    if (
      isConnected === true &&
      previousConnection === false &&
      previousConnection !== null
    ) {
      console.log("[Cameras] Backend reconnected, reloading cameras...");
      loadCameras();
    }
    if (isConnected !== null) {
      setPreviousConnection(isConnected);
    }
  }, [isConnected, previousConnection]);

  const loadCameras = async () => {
    try {
      const response = await fetch(`${CENTRAL_URL}/api/cameras`);
      const data = await response.json();

      if (data.success && data.cameras) {
        // Sort cameras by ID
        const sortedCameras = data.cameras.sort((a, b) => a.id - b.id);
        
        // Update state once
        setCameras(sortedCameras);
      }
    } catch (err) {
      console.error("[Cameras] Failed to load cameras:", err);
    }
  };

  useEffect(() => {
    // WebSocket connection logic REMOVED to prevent errors with NVR backend
    // The previous logic attempted to connect to /ws/cameras which is not fully supported
    // or causes conflicts in the current Central/NVR architecture.
    
    // Just load cameras once via HTTP
    fetchCameras();

    return () => {
      // Cleanup if any
    };
  }, []);

  const fetchCameras = async () => {
    //Fallback: Fetch cameras neu WebSocket khong ket noi duoc
    try {
      const response = await fetch(`${CENTRAL_URL}/api/cameras`);
      const data = await response.json();
      if (data.success) {
        setCameras(data.cameras);
      }
    } catch (err) {
      console.error("[Cameras] Fetch error:", err);
    }
  };

  return { cameras, fetchCameras };
};

export default useCameras;

