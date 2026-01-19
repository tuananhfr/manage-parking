import { useState, useEffect } from "react";
import logApi from "../services/logApi";
import deviceApi from "../services/deviceApi";
import lockerApi from "../services/lockerApi";
import dayjs from "dayjs";

export default function CommandLogs() {
  const [logs, setLogs] = useState<CommandLog[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [lockers, setLockers] = useState<Locker[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Filters
  const [filters, setFilters] = useState({
    device_id: "",
    lock_id: "",
    command_type: "",
    status: "",
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
      if (filters.command_type) params.command_type = filters.command_type;
      if (filters.status) params.status = filters.status;

      const res = await logApi.getCommandLogs(params);
      setLogs(res.data);
      setTotal(res.total);
    } catch (error) {
      console.error("Failed to load command logs:", error);
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
      command_type: "",
      status: "",
      limit: 100,
    });
  };

  const getDeviceName = (deviceId: string | null) => {
    if (!deviceId) return "-";
    const device = devices.find((d) => d.id === deviceId);
    return device ? `${device.name || device.id}` : deviceId;
  };

  const getLockerName = (lockId: string) => {
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
          <i className="bi bi-journal-text me-2"></i>
          Command Logs
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
            <div className="col-md-3">
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

            <div className="col-md-3">
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
              <label className="form-label small">Command Type</label>
              <select
                className="form-select form-select-sm"
                value={filters.command_type}
                onChange={(e) =>
                  handleFilterChange("command_type", e.target.value)
                }
              >
                <option value="">All Types</option>
                <option value="LockControl">LockControl</option>
                <option value="CheckState">CheckState</option>
                <option value="SyncTime">SyncTime</option>
                <option value="LockBusinessControl">LockBusinessControl</option>
                <option value="SystemMaintenance">SystemMaintenance</option>
                <option value="SetLockAttribute">SetLockAttribute</option>
                <option value="LockFreeTime">LockFreeTime</option>
                <option value="LockWarningTime">LockWarningTime</option>
              </select>
            </div>

            <div className="col-md-2">
              <label className="form-label small">Status</label>
              <select
                className="form-select form-select-sm"
                value={filters.status}
                onChange={(e) => handleFilterChange("status", e.target.value)}
              >
                <option value="">All Status</option>
                <option value="SENT">SENT</option>
                <option value="ACK">ACK</option>
                <option value="NACK">NACK</option>
                <option value="TIMEOUT">TIMEOUT</option>
                <option value="ERROR">ERROR</option>
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
                  <th>Command</th>
                  <th>Status</th>
                  <th>Sent At</th>
                  <th>ACK At</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center text-muted py-4">
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
                        <small>
                          <strong>{getDeviceName(log.device_id)}</strong>
                        </small>
                        {log.device_id && (
                          <div>
                            <span className="badge bg-secondary badge-sm">
                              {log.device_id}
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        <strong>{getLockerName(log.lock_id)}</strong>
                      </td>
                      <td>
                        <span className="badge bg-info">
                          {log.command_type}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            log.status === "ACK"
                              ? "bg-success"
                              : log.status === "SENT"
                              ? "bg-warning"
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
                          <span className="text-muted">-</span>
                        )}
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
