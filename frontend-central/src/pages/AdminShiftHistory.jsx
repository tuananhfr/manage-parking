import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { CENTRAL_URL } from "../config";
import HistoryPanel from "../components/history/HistoryPanel";

const AdminShiftHistory = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedShift, setSelectedShift] = useState(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${CENTRAL_URL}/api/auth/work-logs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch logs");
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      setError("Không thể tải lịch sử ca trực");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (isoStr) => {
    if (!isoStr) return "--:--";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return "Lỗi";

      const h = String(d.getHours()).padStart(2, "0");
      const m = String(d.getMinutes()).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const year = d.getFullYear();
      return `${h}:${m} ${day}/${month}/${year}`;
    } catch {
      return "Lỗi";
    }
  };

  /* Send Report Handler */
  const handleSendReport = async (logId) => {
    if (!window.confirm("Bạn có chắc muốn gửi báo cáo ca trực này lên hệ thống Drupal?")) return;
    try {
      setSendingReport(true);
      const response = await fetch(`${CENTRAL_URL}/api/reports/send-shift/${logId}`, {
          method: 'POST'
      });
      const data = await response.json();
      if (response.ok) {
          alert("Gửi báo cáo thành công!\n" + (data.message || ""));
      } else {
          alert("Lỗi: " + (data.detail || "Không thể gửi báo cáo"));
      }
    } catch (err) {
        alert("Lỗi kết nối: " + err.message);
    } finally {
        setSendingReport(false);
    }
  };

  return (
    <div className="container-fluid py-4 min-vh-100 bg-dark text-white">
      <h5 className="text-white mb-4">
        <i className="bi bi-clock-history me-2"></i>
        Lịch sử ca trực
      </h5>

      {loading && <div className="spinner-border text-light"></div>}
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="table-responsive">
        <table className="table table-dark table-hover border-secondary">
          <thead>
            <tr className="text-white-50">
              <th>Nhân viên</th>
              <th>Bắt đầu</th>
              <th>Kết thúc</th>
              <th>Thời lượng</th>
              <th>Trạng thái</th>
              <th className="text-end">Vào</th>
              <th className="text-end">Ra</th>
              <th className="text-end">Trong bãi</th>
              <th className="text-end">Doanh thu</th>
              <th>Ghi chú</th>
              <th className="text-center">Tác vụ</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              // Calc duration
              let duration = "--";
              if (log.start_time && log.end_time) {
                const start = new Date(log.start_time);
                const end = new Date(log.end_time);
                const diffMs = end - start;
                const diffHrs = Math.floor(diffMs / 3600000);
                const diffMins = Math.floor((diffMs % 3600000) / 60000);
                duration = `${diffHrs}h ${diffMins}p`;
              }

              return (
                <tr key={log.id}>
                  <td className="fw-bold text-info">{log.user_name}</td>
                  <td>{formatTime(log.start_time)}</td>
                  <td>{formatTime(log.end_time)}</td>
                  <td>{duration}</td>
                  <td>
                    {log.status === "ongoing" ? (
                      <span className="badge bg-success">Đang trực</span>
                    ) : (
                      <span className="badge bg-secondary">Đã xong</span>
                    )}
                  </td>
                  <td className="text-end fw-bold">
                    {log.end_time ? log.stats?.vehicles_in || 0 : "-"}
                  </td>
                  <td className="text-end fw-bold">
                    {log.end_time ? log.stats?.vehicles_out || 0 : "-"}
                  </td>
                  <td className="text-end fw-bold">
                    {log.end_time ? log.stats?.vehicles_parked || 0 : "-"}
                  </td>
                  <td className="text-success text-end fw-bold">
                    {log.end_time
                      ? (log.stats?.revenue
                        ? log.stats.revenue.toLocaleString()
                        : 0) + "đ"
                      : "-"}
                  </td>
                  <td className="text-white-50 small">
                    {log.handover?.notes || <em>Không có ghi chú</em>}
                  </td>
                  <td className="text-center">
                    <button
                      className="btn btn-sm btn-outline-info"
                      onClick={() => {
                        setSelectedShift(log);
                        setShowHistoryModal(true);
                      }}
                      title="Xem chi tiết ra vào"
                      disabled={!log.end_time}
                    >
                      <i className="bi bi-eye me-1"></i>
                      Chi tiết
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan="11" className="text-center text-white py-4">
                  Chưa có dữ liệu ca trực
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* History Detail Modal - Uses Portal to avoid overflow clipping */}
      {showHistoryModal && selectedShift && createPortal(
        <>
          <div className="modal-backdrop fade show" style={{ zIndex: 1050 }}></div>
          <div className="modal fade show d-block" tabIndex={-1} style={{ zIndex: 1060 }}>
            <div className="modal-dialog modal-fullscreen">
              <div className="modal-content bg-dark text-white">
                <div className="modal-header border-secondary">
                  <h5 className="modal-title">
                    Chi tiết ca trực: {selectedShift.user_name} (
                    {formatTime(selectedShift.start_time)} -{" "}
                    {selectedShift.end_time ? formatTime(selectedShift.end_time) : "Đang trực"})
                  </h5>
                  <div className="d-flex align-items-center gap-2">
                      {selectedShift.end_time && (
                          <button
                            className="btn btn-outline-success btn-sm"
                            onClick={() => handleSendReport(selectedShift.id)}
                            disabled={sendingReport}
                          >
                             {sendingReport ? (
                                <span className="spinner-border spinner-border-sm me-2"></span>
                             ) : (
                                <i className="bi bi-cloud-upload me-2"></i>
                             )}
                             Gửi báo cáo
                          </button>
                      )}
                      <button
                        type="button"
                        className="btn-close btn-close-white"
                        onClick={() => setShowHistoryModal(false)}
                      ></button>
                  </div>
                </div>
                <div className="modal-body p-0 bg-black">
                  <HistoryPanel
                    backendUrl={CENTRAL_URL}
                    user={{ role: "view_only" }}
                    lockedStartTime={selectedShift.start_time}
                    lockedEndTime={selectedShift.end_time || new Date().toISOString()}
                    staticData={selectedShift.details} // Pass full details (records + changes)
                    mode="shift_detail" // Enable customized view for shift details
                  />
                </div>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
};

export default AdminShiftHistory;
