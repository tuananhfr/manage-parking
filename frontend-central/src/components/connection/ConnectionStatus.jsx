import { useState, useEffect, useRef } from "react";
import useConnectionStatus from "../../hooks/useConnectionStatus";

/**
 * ConnectionStatus - Hiển thị trạng thái kết nối backend
 *
 * - Hiển thị banner khi mất kết nối
 * - Tự động ẩn khi reconnect thành công
 * - Hiển thị thời gian mất kết nối
 */
const ConnectionStatus = () => {
  const { isConnected, lastDisconnectedTime } = useConnectionStatus();
  const [disconnectedDuration, setDisconnectedDuration] = useState(0);
  const [showReconnected, setShowReconnected] = useState(false);
  const previousConnectionRef = useRef(null);

  //Track connection state changes de detect reconnect
  useEffect(() => {
    const prev = previousConnectionRef.current;
    if (isConnected !== null && isConnected !== prev) {
      //State changed
      if (isConnected === true && prev === false) {
        //Reconnected! (false → true)
        setTimeout(() => setShowReconnected(true), 0);
        const timer = setTimeout(() => {
          setShowReconnected(false);
        }, 3000); //Hide after 3s

        return () => clearTimeout(timer);
      }
      previousConnectionRef.current = isConnected;
    }
  }, [isConnected]);

  //Update disconnected duration moi giay
  useEffect(() => {
    if (isConnected === false && lastDisconnectedTime) {
      const interval = setInterval(() => {
        const duration = Math.floor(
          (Date.now() - lastDisconnectedTime) / 1000
        );
        setDisconnectedDuration(duration);
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [isConnected, lastDisconnectedTime]);

  //Hien thi loading badge khi chua biet trang thai (initial load hoặc reload)
  if (isConnected === null) {
    return (
      <div className="d-flex align-items-center">
        <span className="badge bg-secondary d-flex align-items-center">
          <div className="spinner-border spinner-border-sm me-2" role="status" style={{ width: '12px', height: '12px', borderWidth: '1px' }}>
            <span className="visually-hidden">Loading...</span>
          </div>
          Đang kiểm tra...
        </span>
      </div>
    );
  }

  //Hien thi badge "reconnected" (success)
  if (showReconnected && isConnected) {
    return (
      <div className="d-flex align-items-center">
        <span className="badge bg-success d-flex align-items-center">
          <i className="bi bi-check-circle-fill me-2"></i>
          Đã kết nối lại
        </span>
      </div>
    );
  }

  //Hien thi badge "disconnected" (danger)
  if (!isConnected) {
    return (
      <div className="d-flex align-items-center">
        <span className="badge bg-danger d-flex align-items-center">
          <div className="spinner-border spinner-border-sm me-2" role="status" style={{ width: '12px', height: '12px', borderWidth: '1px' }}>
            <span className="visually-hidden">Loading...</span>
          </div>
          Mất kết nối
          {disconnectedDuration > 0 && (
            <span className="ms-2 badge bg-dark">
              {disconnectedDuration}s
            </span>
          )}
        </span>
      </div>
    );
  }

  //Connected - hien thi badge xanh nho
  return (
    <div className="d-flex align-items-center">
      <span className="badge bg-success d-flex align-items-center">
        <i className="bi bi-circle-fill me-2" style={{ fontSize: '6px' }}></i>
        Connected
      </span>
    </div>
  );
};

export default ConnectionStatus;
