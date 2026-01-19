import { useState, useEffect } from "react";
import { CENTRAL_URL } from "../config";
import useConnectionStatus from "./useConnectionStatus";

/**
 * Custom hook để quản lý stats (header info)
 * - Fetch lần đầu + interval fallback
 * - Lắng nghe WebSocket /ws/history để cập nhật realtime khi có thay đổi history
 * - Auto-reconnect khi backend down → up
 */
const useStats = () => {
  const [stats, setStats] = useState(null);
  const { isConnected } = useConnectionStatus();
  const [previousConnection, setPreviousConnection] = useState(null);

  //Auto-refetch stats khi backend reconnect (CHI khi false → true, KHONG phai null → true)
  useEffect(() => {
    if (
      isConnected === true &&
      previousConnection === false &&
      previousConnection !== null
    ) {
      // console.log("[Stats] Backend reconnected, reloading stats...");
      fetchStats();
    }
    if (isConnected !== null) {
      setPreviousConnection(isConnected);
    }
  }, [isConnected, previousConnection]);

  const fetchStats = async () => {
    try {
      // Fetch daily stats from /api/stats (toàn bộ ngày từ 00:00)
      const response = await fetch(`${CENTRAL_URL}/api/stats`);
      const data = await response.json();
      if (data.success) {
        // /api/stats returns daily totals
        setStats({
          entries_today: data.entries_today,
          exits_today: data.exits_today,
          vehicles_in_parking: data.vehicles_in_parking,
          revenue_today: data.revenue_today,
        });
      }
    } catch {
      //Silent fail
    }
  };

  useEffect(() => {
    //Fetch stats NGAY de co UI nhanh
    fetchStats();

    // WebSocket update logic REMOVED for NVR compatibility
    // Instead, just fetch stats periodically (every 30s)
    
    const intervalId = setInterval(fetchStats, 30000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  return { stats };
};

export default useStats;
