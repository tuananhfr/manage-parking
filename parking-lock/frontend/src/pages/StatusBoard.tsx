import { useState, useEffect } from "react";
import lockerApi from "../services/lockerApi";

export default function StatusBoard() {
  const [lockers, setLockers] = useState<Locker[]>([]);

  useEffect(() => {
    loadLockers();
    const interval = setInterval(loadLockers, 2000); // Refresh every 2s
    return () => clearInterval(interval);
  }, []);

  const loadLockers = async () => {
    try {
      // Only load connected lockers
      const res = await lockerApi.getLockers({ connected: true, limit: 100 });
      setLockers(res.data);
    } catch (error) {
      console.error("Failed to load lockers:", error);
    }
  };

  // Check if locker has error state (Stall, UpStall, DownStall)
  const hasError = (locker: Locker) => {
    return locker.last_action ? locker.last_action.includes("ERROR:") : false;
  };

  const getCardClass = (locker: Locker) => {
    if (hasError(locker))
      return "bg-danger text-white border border-warning border-3";
    if (locker.occupied) return "bg-danger text-white";
    if (locker.status === "DOWN") return "bg-warning";
    return "bg-success text-white";
  };

  const getIcon = (locker: Locker) => {
    if (hasError(locker)) return "bi-exclamation-triangle-fill";
    if (locker.occupied) return "bi-x-circle-fill";
    if (locker.status === "DOWN") return "bi-dash-circle-fill";
    return "bi-check-circle-fill";
  };

  return (
    <div className="container-fluid">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>
          <i className="bi bi-tv me-2"></i>
          Status Board
        </h2>
        <button
          className="btn btn-primary"
          onClick={() => document.documentElement.requestFullscreen()}
        >
          <i className="bi bi-fullscreen me-1"></i>
          Fullscreen
        </button>
      </div>

      <div className="row g-2">
        {lockers.map((locker) => (
          <div
            key={locker.lock_id}
            className="col-6 col-md-4 col-lg-3 col-xl-2"
          >
            <div className={`card ${getCardClass(locker)} h-100`}>
              <div className="card-body text-center p-2">
                <h5 className="card-title mb-1">
                  <strong>{locker.lock_id}</strong>
                </h5>
                <div style={{ fontSize: "2rem" }}>
                  <i className={`bi ${getIcon(locker)}`}></i>
                </div>
                <small>
                  {hasError(locker)
                    ? "ERROR"
                    : locker.occupied
                    ? "OCCUPIED"
                    : locker.status === "DOWN"
                    ? "OPEN"
                    : "AVAILABLE"}
                </small>
                {hasError(locker) && locker.last_action && (
                  <div className="mt-1">
                    <small className="text-warning fw-bold">
                      <i className="bi bi-exclamation-circle me-1"></i>
                      {
                        locker.last_action
                          .replace("ERROR: ", "")
                          .split(" - ")[0]
                      }
                    </small>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
