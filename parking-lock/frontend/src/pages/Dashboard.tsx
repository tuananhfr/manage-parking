import { useState, useEffect } from "react";
import dashboardApi from "../services/dashboardApi";
import deviceApi from "../services/deviceApi";

import dayjs from "dayjs";

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [statsRes, devicesRes] = await Promise.all([
        dashboardApi.getOverview(),
        deviceApi.getDevices({ limit: 10 }),
      ]);
      setStats(statsRes.data);
      setDevices(devicesRes.data);
    } catch (error) {
      console.error("Failed to load dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
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
      <h2 className="mb-4">
        <i className="bi bi-speedometer2 me-2"></i>
        Dashboard
      </h2>

      {/* Stats Cards */}
      <div className="row g-3 mb-4">
        <div className="col-md-3">
          <div className="card">
            <div className="card-body">
              <h6 className="card-subtitle mb-2 text-muted">Total Devices</h6>
              <h3 className="card-title">{stats?.total_devices || 0}</h3>
              <small className="text-success">
                <i className="bi bi-circle-fill me-1"></i>
                {stats?.online_devices || 0} Online
              </small>
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card">
            <div className="card-body">
              <h6 className="card-subtitle mb-2 text-muted">Total Lockers</h6>
              <h3 className="card-title">{stats?.total_lockers || 0}</h3>
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card bg-success text-white">
            <div className="card-body">
              <h6 className="card-subtitle mb-2">Available</h6>
              <h3 className="card-title">{stats?.available_lockers || 0}</h3>
            </div>
          </div>
        </div>
        <div className="col-md-3">
          <div className="card bg-danger text-white">
            <div className="card-body">
              <h6 className="card-subtitle mb-2">Occupied</h6>
              <h3 className="card-title">{stats?.occupied_lockers || 0}</h3>
            </div>
          </div>
        </div>
      </div>

      {/* Devices List */}
      <div className="row">
        <div className="col-12">
          <div className="card">
            <div className="card-header bg-primary text-white">
              <i className="bi bi-hdd-network me-2"></i>
              Devices Status
            </div>
            <div className="card-body">
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Device ID</th>
                      <th>Name</th>
                      <th>Location</th>
                      <th>Status</th>
                      <th>Lockers</th>
                      <th>Last Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((device) => (
                      <tr key={device.id}>
                        <td>
                          <strong>{device.id}</strong>
                        </td>
                        <td>{device.name || "-"}</td>
                        <td>{device.location || "-"}</td>
                        <td>
                          <span
                            className={`badge ${
                              device.status === "ONLINE"
                                ? "bg-success"
                                : "bg-secondary"
                            }`}
                          >
                            {device.status}
                          </span>
                        </td>
                        <td>
                          {device.online_count || 0} /{" "}
                          {device.locker_count || 0}
                        </td>
                        <td>
                          {device.last_seen
                            ? dayjs(device.last_seen).format("DD/MM HH:mm:ss")
                            : "Never"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
