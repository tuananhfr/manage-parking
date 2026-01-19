import React, { useState, useEffect } from "react";
import { CENTRAL_URL as BACKEND_URL } from "../../config"; // Assumes config.js exports BACKEND_URL or use hook

const HandoverModal = ({ show, onClose, onConfirmLogout }) => {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [sessionInfo, setSessionInfo] = useState(null);
  const [notes, setNotes] = useState("");
  const [actualRevenue, setActualRevenue] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (show) {
      fetchSessionStats();
    }
  }, [show]);

  const fetchSessionStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      const baseUrl =
        import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";
      const res = await fetch(`${baseUrl}/api/auth/work-stats/current`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.active) {
        setStats(data.stats);
        setSessionInfo({
          start_time: data.start_time,
          current_time: data.current_time || new Date().toISOString(),
        });
        setActualRevenue(data.stats.revenue || 0);
      } else {
        setStats(null);
      }
    } catch (err) {
      setError("Không thể tải thống kê phiên");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const baseUrl =
        import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

      await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          notes: notes,
          revenue: parseInt(actualRevenue),
        }),
      });

      onConfirmLogout();
    } catch (err) {
      console.error("Handover failed", err);
      setError("Lỗi khi gửi bàn giao. Vẫn tiếp tục đăng xuất?");
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
      // const year = d.getFullYear();
      return `${h}:${m} ${day}/${month}`;
    } catch {
      return "Lỗi";
    }
  };

  if (!show) return null;

  return (
    <>
      <div
        className="modal show d-block"
        style={{ backgroundColor: "rgba(0,0,0,0.8)" }}
      >
        <div className="modal-dialog modal-dialog-centered modal-lg">
          <div className="modal-content bg-dark text-white border-secondary">
            <div className="modal-header border-secondary">
              <h5 className="modal-title text-white">
                <i className="bi bi-clipboard-check me-2"></i>
                Bàn giao ca trực
              </h5>
            </div>
            <div className="modal-body">
              {loading && !stats ? (
                <div className="text-center py-4">
                  <div className="spinner-border text-light"></div>
                  <p className="mt-2 text-white-50">Đang tổng hợp số liệu...</p>
                </div>
              ) : (
                <>
                  {/* Session Info & Stats */}
                  {stats && sessionInfo && (
                    <div className="card bg-secondary bg-opacity-10 border-secondary mb-4">
                      <div className="card-body">
                        {/* Row 1: Time */}
                        <div className="row mb-3 pb-3 border-bottom border-secondary">
                          <div className="col-6 border-end border-secondary">
                            <small className="text-white-50 d-block text-uppercase">
                              Bắt đầu ca
                            </small>
                            <span className="fs-5 text-white">
                              {formatTime(sessionInfo.start_time)}
                            </span>
                          </div>
                          <div className="col-6">
                            <small className="text-white-50 d-block text-uppercase">
                              Kết thúc (Hiện tại)
                            </small>
                            <span className="fs-5 text-white">
                              {formatTime(sessionInfo.current_time)}
                            </span>
                          </div>
                        </div>

                        {/* Row 2: Stats Grid */}
                        <div className="row text-center">
                          <div className="col-3 border-end border-secondary">
                            <h3 className="mb-0 text-white">
                              {stats.vehicles_in}
                            </h3>
                            <small className="text-white-50 fw-bold">
                              Xe Vào
                            </small>
                          </div>
                          <div className="col-3 border-end border-secondary">
                            <h3 className="mb-0 text-white">
                              {stats.vehicles_out}
                            </h3>
                            <small className="text-white-50 fw-bold">
                              Xe Ra
                            </small>
                          </div>
                          <div className="col-3 border-end border-secondary">
                            <h3 className="mb-0 text-white">
                              {stats.vehicles_parked || 0}
                            </h3>
                            <small className="text-white-50">Trong bãi</small>
                          </div>
                          <div className="col-3">
                            <h3 className="mb-0 text-white">
                              {(stats.revenue || 0).toLocaleString()}
                            </h3>
                            <small className="text-white-50">Doanh thu</small>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="row g-3">
                    {/* Revenue Display Only - Full Width if Notes is also Full Width or put side by side with stats? 
                          Notes is more important now. Let's make Notes full width.
                       */}

                    {/* To keep it balanced, maybe just show Revenue as read-only stat block above? 
                          Actually user said "ko cần tiền mặt". 
                          Does "Doanh thu hệ thống" still need to be shown? 
                          "đầu tiên ko cần tiền mặt" likely means "input thực thu". 
                          System revenue is still useful info.
                          I will move System Revenue to the stats grid or keep it read-only.
                          Let's keep System Revenue read-only but make it look like a stat, not an input form.
                      */}

                    {/* Notes Input - Full Width */}
                    <div className="col-12">
                      <label className="form-label text-light">
                        Ghi chú bàn giao
                      </label>
                      <textarea
                        className="form-control bg-dark text-white border-secondary"
                        rows="3"
                        placeholder="Nhập ghi chú quan trọng cho ca sau..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                      ></textarea>
                    </div>
                  </div>

                  {error && (
                    <div className="alert alert-danger mt-3 mb-0 py-2">
                      {error}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="modal-footer border-secondary">
              <button
                className="btn btn-outline-light"
                onClick={onClose}
                disabled={loading}
              >
                Quay lại
              </button>
              <button
                className="btn btn-danger fw-bold px-4"
                onClick={handleSubmit}
                disabled={loading}
              >
                <i className="bi bi-check-lg me-2"></i>
                Xác nhận & Kết thúc ca
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show" style={{ opacity: 0.8 }}></div>
    </>
  );
};

export default HandoverModal;
