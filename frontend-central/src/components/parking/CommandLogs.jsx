import { useState, useEffect, useCallback } from "react";
import { parkingBackendApi } from "../../services/parkingBackendApi";
import dayjs from "dayjs";

export default function CommandLogs() {
  const [logs, setLogs] = useState([]);
  const [backends, setBackends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Filters
  const [filters, setFilters] = useState({
    backend_id: "",
    device_id: "",
    lock_id: "",
    command_type: "",
    status: "",
    limit: 100,
  });

  useEffect(() => {
    loadBackends();
    loadLogs();
  }, [loadBackends, loadLogs]);

  useEffect(() => {
    loadLogs();
  }, [filters, loadLogs]);

  const loadBackends = useCallback(async () => {
      try {
          const data = await parkingBackendApi.getBackends();
          setBackends(data);
      } catch (error) {
          console.error("Failed to load backends", error);
      }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params = { limit: filters.limit };
      if (filters.backend_id) params.backend_id = filters.backend_id;
      if (filters.device_id) params.device_id = filters.device_id;
      if (filters.lock_id) params.lock_id = filters.lock_id;
      if (filters.command_type) params.command_type = filters.command_type;
      if (filters.status) params.status = filters.status;

      const res = await parkingBackendApi.getLogs(params);
      setLogs(res.data);
      setTotal(res.total);
    } catch (error) {
      console.error("Failed to load command logs:", error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      backend_id: "",
      device_id: "",
      lock_id: "",
      command_type: "",
      status: "",
      limit: 100,
    });
  };

  if (loading && logs.length === 0) {
    return (
      <div className="d-flex justify-content-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h4>
          <i className="bi bi-journal-text me-2"></i>
          Nhật ký lệnh (Command Logs)
        </h4>
        <span className="badge bg-secondary">Total: {total}</span>
      </div>

      {/* Filters */}
      <div className="accordion mb-4 shadow-sm" id="accordionFilterLogs">
        <div className="accordion-item bg-dark border-secondary">
          <h2 className="accordion-header" id="headingFilterLogs">
            <button
              className="accordion-button collapsed bg-secondary text-white"
              type="button"
              data-bs-toggle="collapse"
              data-bs-target="#collapseFilterLogs"
              aria-expanded="false"
              aria-controls="collapseFilterLogs"
            >
              <i className="bi bi-funnel me-2"></i>
              Bộ lọc
            </button>
          </h2>
          <div
            id="collapseFilterLogs"
            className="accordion-collapse collapse"
            aria-labelledby="headingFilterLogs"
            data-bs-parent="#accordionFilterLogs"
          >
            <div className="accordion-body">
              <div className="row g-3">
                <div className="col-md-3">
                  <label className="form-label small fw-bold text-white">
                    Bãi xe (Backend)
                  </label>
                  <select
                    className="form-select form-select-sm bg-dark text-white border-secondary"
                    value={filters.backend_id}
                    onChange={(e) =>
                      handleFilterChange("backend_id", e.target.value)
                    }
                  >
                    <option value="">Tất cả</option>
                    {backends.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-md-3">
                  <label className="form-label small fw-bold text-white">
                    Device ID
                  </label>
                  <input
                    type="text"
                    className="form-control form-control-sm bg-dark text-white border-secondary"
                    placeholder="Nhập Device ID..."
                    value={filters.device_id}
                    onChange={(e) =>
                      handleFilterChange("device_id", e.target.value)
                    }
                  />
                </div>

                <div className="col-md-2">
                  <label className="form-label small fw-bold text-white">
                    Locker ID
                  </label>
                  <input
                    type="text"
                    className="form-control form-control-sm bg-dark text-white border-secondary"
                    placeholder="Nhập Lock ID..."
                    value={filters.lock_id}
                    onChange={(e) =>
                      handleFilterChange("lock_id", e.target.value)
                    }
                  />
                </div>

                <div className="col-md-2">
                  <label className="form-label small fw-bold text-white">
                    Loại lệnh
                  </label>
                  <select
                    className="form-select form-select-sm bg-dark text-white border-secondary"
                    value={filters.command_type}
                    onChange={(e) =>
                      handleFilterChange("command_type", e.target.value)
                    }
                  >
                    <option value="">Tất cả</option>
                    <option value="LockControl">LockControl</option>
                    <option value="CheckState">CheckState</option>
                    <option value="SyncTime">SyncTime</option>
                    <option value="LockBusinessControl">
                      LockBusinessControl
                    </option>
                    <option value="SystemMaintenance">SystemMaintenance</option>
                    <option value="SetLockAttribute">SetLockAttribute</option>
                    <option value="LockFreeTime">LockFreeTime</option>
                    <option value="LockWarningTime">LockWarningTime</option>
                  </select>
                </div>

                <div className="col-md-2">
                  <label className="form-label small fw-bold text-white">
                    Trạng thái
                  </label>
                  <select
                    className="form-select form-select-sm bg-dark text-white border-secondary"
                    value={filters.status}
                    onChange={(e) => handleFilterChange("status", e.target.value)}
                  >
                    <option value="">Tất cả</option>
                    <option value="SENT">SENT (Đã gửi)</option>
                    <option value="ACK">ACK (Thành công)</option>
                    <option value="NACK">NACK (Thất bại)</option>
                    <option value="TIMEOUT">TIMEOUT (Quá giờ)</option>
                    <option value="ERROR">ERROR (Lỗi)</option>
                  </select>
                </div>
              </div>

              <div className="mt-3 text-end">
                <button
                  className="btn btn-sm btn-outline-secondary"
                  onClick={clearFilters}
                >
                  <i className="bi bi-x-circle me-1"></i>
                  Xóa bộ lọc
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="card shadow-sm bg-dark border-secondary">
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-dark table-hover mb-0 align-middle">
              <thead>
                <tr>
                  <th>Bãi xe</th>
                  <th>Device / Locker</th>
                  <th>Lệnh</th>
                  <th>Trạng thái</th>
                  <th>Thời gian gửi</th>
                  <th>Phản hồi (ACK)</th>
                  <th>Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-secondary py-5">
                      <i className="bi bi-inbox fs-4 d-block mb-2"></i>
                      Không tìm thấy dữ liệu log
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id}>
                        <td>
                            <span className="badge bg-secondary">{log.backend_name || log.backend_id}</span>
                        </td>
                      <td>
                        <div className="d-flex flex-column">
                            <small className="text-secondary">Device: <span className="fw-bold text-white">{log.device_id || "-"}</span></small>
                            <small className="text-secondary">Locker: <span className="fw-bold text-primary">{log.lock_id || "-"}</span></small>
                        </div>
                      </td>
                      <td>
                        <span className="badge bg-info bg-opacity-10 text-info border border-info">
                          {log.command_type}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            log.status === "ACK"
                              ? "bg-success"
                              : log.status === "SENT"
                              ? "bg-warning text-dark"
                              : "bg-danger"
                          }`}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td>
                        <small>
                          {dayjs(log.sent_at).format("DD/MM/YYYY HH:mm:ss")}
                        </small>
                      </td>
                      <td>
                        {log.ack_at ? (
                          <small>
                            {dayjs(log.ack_at).format("DD/MM/YYYY HH:mm:ss")}
                          </small>
                        ) : (
                          <span className="text-secondary">-</span>
                        )}
                      </td>
                      <td>
                        <small className="text-secondary fst-italic">{log.note || "-"}</small>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
