import { useState, useEffect } from "react";
import deviceApi from "../services/deviceApi";

import dayjs from "dayjs";

export default function DeviceManagement() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [controllingDevice, setControllingDevice] = useState<string | null>(null);
  const [maintenanceDevice, setMaintenanceDevice] = useState<string | null>(null);

  useEffect(() => {
    loadDevices();
    const interval = setInterval(loadDevices, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadDevices = async () => {
    try {
      const res = await deviceApi.getDevices({ limit: 50 });
      setDevices(res.data);
    } catch (error) {
      console.error("Failed to load devices:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleBusinessControl = async (deviceId: string, mode: "Open" | "Close") => {
    if (!confirm(`Are you sure you want to ${mode === "Open" ? "open" : "close"} business for device ${deviceId}?`)) {
      return;
    }

    setControllingDevice(deviceId);
    try {
      await deviceApi.businessControl(deviceId, { mode });
      alert(`Business control command sent: ${mode}`);
      setTimeout(loadDevices, 1000);
    } catch (error) {
      console.error("Failed to send business control:", error);
      alert("Failed to send command");
    } finally {
      setControllingDevice(null);
    }
  };

  const handleMaintenance = async (deviceId: string, command: "Reboot" | "ClearErr") => {
    if (!confirm(`Are you sure you want to ${command === "Reboot" ? "reboot" : "clear errors"} device ${deviceId}?`)) {
      return;
    }

    setMaintenanceDevice(deviceId);
    try {
      await deviceApi.maintenance(deviceId, { command });
      alert(`Maintenance command sent: ${command}`);
      setTimeout(loadDevices, 1000);
    } catch (error) {
      console.error("Failed to send maintenance command:", error);
      alert("Failed to send command");
    } finally {
      setMaintenanceDevice(null);
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
        <i className="bi bi-cpu me-2"></i>
        Device Management
      </h2>

      <div className="row g-3">
        {devices.map((device) => (
          <div key={device.id} className="col-md-6 col-lg-4">
            <div className="card h-100">
              <div className="card-header bg-primary text-white">
                <i className="bi bi-hdd-network me-2"></i>
                {device.id}
              </div>
              <div className="card-body">
                <h5 className="card-title">
                  {device.name || "Unnamed Device"}
                </h5>
                <p className="card-text text-muted">
                  {device.location || "No location"}
                </p>

                <div className="mb-2">
                  <strong>Status:</strong>{" "}
                  <span
                    className={`badge ${
                      device.status === "ONLINE" ? "bg-success" : "bg-secondary"
                    }`}
                  >
                    <i
                      className={`bi ${
                        device.status === "ONLINE"
                          ? "bi-circle-fill"
                          : "bi-circle"
                      } me-1`}
                    ></i>
                    {device.status}
                  </span>
                </div>

                <div className="mb-2">
                  <strong>IP Address:</strong> {device.ip_address || "N/A"}
                </div>

                <div className="mb-2">
                  <strong>Lockers:</strong> {device.locker_count || 0}
                </div>

                <div className="mb-2">
                  <strong>Last Seen:</strong>{" "}
                  {device.last_seen
                    ? dayjs(device.last_seen).format("DD/MM/YYYY HH:mm:ss")
                    : "Never"}
                </div>

                <div className="mb-2">
                  <strong>Registered:</strong>{" "}
                  {dayjs(device.registered_at).format("DD/MM/YYYY")}
                </div>

                <div className="mt-3 pt-3 border-top">
                  <div className="mb-2">
                    <strong>Business Control:</strong>
                  </div>
                  <div className="btn-group w-100 mb-2">
                    <button
                      className="btn btn-sm btn-success"
                      onClick={() => handleBusinessControl(device.id, "Open")}
                      disabled={controllingDevice === device.id || device.status !== "ONLINE"}
                      title="Open parking lot (all locks to Normal mode)"
                    >
                      <i className="bi bi-unlock-fill me-1"></i>
                      Open
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleBusinessControl(device.id, "Close")}
                      disabled={controllingDevice === device.id || device.status !== "ONLINE"}
                      title="Close parking lot (force empty locks down)"
                    >
                      <i className="bi bi-lock-fill me-1"></i>
                      Close
                    </button>
                  </div>

                  <div className="mb-2">
                    <strong>Maintenance:</strong>
                  </div>
                  <div className="btn-group w-100">
                    <button
                      className="btn btn-sm btn-warning"
                      onClick={() => handleMaintenance(device.id, "Reboot")}
                      disabled={maintenanceDevice === device.id || device.status !== "ONLINE"}
                      title="Reboot device"
                    >
                      <i className="bi bi-arrow-clockwise me-1"></i>
                      Reboot
                    </button>
                    <button
                      className="btn btn-sm btn-info"
                      onClick={() => handleMaintenance(device.id, "ClearErr")}
                      disabled={maintenanceDevice === device.id || device.status !== "ONLINE"}
                      title="Clear errors"
                    >
                      <i className="bi bi-x-circle me-1"></i>
                      Clear Errors
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {devices.length === 0 && (
        <div className="alert alert-info">
          <i className="bi bi-info-circle me-2"></i>
          No devices registered yet.
        </div>
      )}
    </div>
  );
}
