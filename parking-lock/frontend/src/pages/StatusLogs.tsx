import { useState, useEffect } from "react";
import logApi from "../services/logApi";
import deviceApi from "../services/deviceApi";
import lockerApi from "../services/lockerApi";
import dayjs from "dayjs";

export default function StatusLogs() {
  const [logs, setLogs] = useState<StatusLog[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [lockers, setLockers] = useState<Locker[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Filters
  const [filters, setFilters] = useState({
    device_id: "",
    lock_id: "",
    trigger_type: "",
    limit: 100,
  });

  useEffect(() => {
    loadDevicesAndLockers();
    loadLogs();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [filters]);

  const loadDevicesAndLockers = async () => {
    try {
      const [devicesRes, lockersRes] = await Promise.all([
        deviceApi.getDevices({ limit: 100 }),
        lockerApi.getLockers({ connected: true, limit: 1000 }),
      ]);
      setDevices(devicesRes.data);
      setLockers(lockersRes.data);
    } catch (error) {
      console.error("Failed to load devices/lockers:", error);
    }
  };

  const loadLogs = async () => {
    try {
      setLoading(true);
      const params: any = { limit: filters.limit };
      if (filters.device_id) params.device_id = filters.device_id;
      if (filters.lock_id) params.lock_id = filters.lock_id;
      if (filters.trigger_type) params.trigger_type = filters.trigger_type;

      const res = await logApi.getStatusLogs(params);
      setLogs(res.data);
      setTotal(res.total);
    } catch (error) {
      console.error("Failed to load status logs:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({
      device_id: "",
      lock_id: "",
      trigger_type: "",
      limit: 100,
    });
  };

  const getDeviceName = (deviceId: string | null) => {
    if (!deviceId) return "-";
    const device = devices.find((d) => d.id === deviceId);
    return device ? `${device.name || device.id}` : deviceId;
  };

  const getLockerName = (lockId: string | null) => {
    if (!lockId) return "-";
    const locker = lockers.find((l) => l.id === lockId);
    return locker ? `${locker.name || lockId}` : lockId;
  };

  if (loading && logs.length === 0) {
    return (
      <div className="loading-container">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>
          <i className="bi bi-card-list me-2"></i>
          Status Logs
        </h2>
        <span className="badge bg-secondary">Total: {total}</span>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-header bg-light">
          <i className="bi bi-funnel me-2"></i>
          Filters
        </div>
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label small">Device</label>
              <select
                className="form-select form-select-sm"
                value={filters.device_id}
                onChange={(e) =>
                  handleFilterChange("device_id", e.target.value)
                }
              >
                <option value="">All Devices</option>
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name || device.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-md-4">
              <label className="form-label small">Locker</label>
              <select
                className="form-select form-select-sm"
                value={filters.lock_id}
                onChange={(e) => handleFilterChange("lock_id", e.target.value)}
              >
                <option value="">All Lockers</option>
                {lockers
                  .filter(
                    (l) =>
                      !filters.device_id || l.device_id === filters.device_id
                  )
                  .map((locker) => (
                    <option key={locker.id} value={locker.id}>
                      {locker.name || locker.id}
                    </option>
                  ))}
              </select>
            </div>

            <div className="col-md-2">
              <label className="form-label small">Trigger Type</label>
              <select
                className="form-select form-select-sm"
                value={filters.trigger_type}
                onChange={(e) =>
                  handleFilterChange("trigger_type", e.target.value)
                }
              >
                <option value="">All Types</option>
                <option value="AUTO">AUTO</option>
                <option value="MANUAL">MANUAL</option>
                <option value="DEVICE">DEVICE</option>
              </select>
            </div>

            <div className="col-md-2">
              <label className="form-label small">Limit</label>
              <select
                className="form-select form-select-sm"
                value={filters.limit}
                onChange={(e) => handleFilterChange("limit", e.target.value)}
              >
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
                <option value="500">500</option>
              </select>
            </div>
          </div>

          <div className="mt-3">
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={clearFilters}
            >
              <i className="bi bi-x-circle me-1"></i>
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="card">
        <div className="card-body">
          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Device</th>
                  <th>Locker</th>
                  <th>Status Change</th>
                  <th>Mode Change</th>
                  <th>Occupied</th>
                  <th>Trigger</th>
                  <th>Changed At</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center text-muted py-4">
                      No logs found
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id}>
                      <td>
                        <small className="text-muted">#{log.id}</small>
                      </td>
                      <td>
                        {log.device_id ? (
                          <>
                            <small>
                              <strong>{getDeviceName(log.device_id)}</strong>
                            </small>
                            <div>
                              <span className="badge bg-secondary badge-sm">
                                {log.device_id}
                              </span>
                            </div>
                          </>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        {log.lock_id ? (
                          <strong>{getLockerName(log.lock_id)}</strong>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        {log.old_status && log.new_status ? (
                          <span>
                            <span className="badge bg-secondary">
                              {log.old_status}
                            </span>
                            {" → "}
                            <span
                              className={`badge ${
                                log.new_status === "UP"
                                  ? "bg-success"
                                  : log.new_status === "DOWN"
                                  ? "bg-danger"
                                  : "bg-warning"
                              }`}
                            >
                              {log.new_status}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        {log.old_mode && log.new_mode ? (
                          <span>
                            <span className="badge bg-secondary">
                              {log.old_mode}
                            </span>
                            {" → "}
                            <span className="badge bg-primary">
                              {log.new_mode}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        {log.old_occupied !== null &&
                        log.new_occupied !== null ? (
                          <span>
                            <span
                              className={`badge ${
                                log.old_occupied ? "bg-danger" : "bg-success"
                              }`}
                            >
                              {log.old_occupied ? "Yes" : "No"}
                            </span>
                            {" → "}
                            <span
                              className={`badge ${
                                log.new_occupied ? "bg-danger" : "bg-success"
                              }`}
                            >
                              {log.new_occupied ? "Yes" : "No"}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            log.trigger_type === "MANUAL"
                              ? "bg-primary"
                              : log.trigger_type === "AUTO"
                              ? "bg-success"
                              : "bg-info"
                          }`}
                        >
                          {log.trigger_type}
                        </span>
                      </td>
                      <td>
                        <small>
                          {dayjs(log.changed_at).format("DD/MM/YYYY HH:mm:ss")}
                        </small>
                      </td>
                      <td>
                        <small className="text-muted">{log.note || "-"}</small>
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
