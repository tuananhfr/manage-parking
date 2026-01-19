import { useState, useEffect, useCallback } from "react";

const TimelapseSettingsModal = ({ show, onClose, timelapseConfig, onSave }) => {
  const [periodValue, setPeriodValue] = useState(1);
  const [periodUnit, setPeriodUnit] = useState("hour");
  const [intervalValue, setIntervalValue] = useState(5);
  const [intervalUnit, setIntervalUnit] = useState("seconds");
  const [savingTimelapseConfig, setSavingTimelapseConfig] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [config, setConfig] = useState(timelapseConfig);

  const BACKEND_URL =
    import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

  const loadTimelapseConfig = useCallback(async () => {
    try {
      setLoadingConfig(true);
      const response = await fetch(`${BACKEND_URL}/api/timelapse/config`);
      if (!response.ok) {
        // Nếu không có config, dùng default
        setConfig({
          intervalSeconds: 5,
          periodValue: 1,
          periodUnit: "hour",
          enabledCameraIds: []
        });
        return;
      }
      const result = await response.json();
      const loadedConfig = result.data || result;
      setConfig(loadedConfig);
      
      setPeriodValue(loadedConfig.periodValue || 1);
      setPeriodUnit(loadedConfig.periodUnit || "hour");
      
      // Parse intervalSeconds
      const intervalSeconds = loadedConfig.intervalSeconds || 5;
      if (intervalSeconds >= 3600 && intervalSeconds % 3600 === 0) {
        setIntervalValue(intervalSeconds / 3600);
        setIntervalUnit("hours");
      } else if (intervalSeconds >= 60 && intervalSeconds % 60 === 0) {
        setIntervalValue(intervalSeconds / 60);
        setIntervalUnit("minutes");
      } else {
        setIntervalValue(intervalSeconds);
        setIntervalUnit("seconds");
      }
    } catch (error) {
      console.error("Error loading timelapse config:", error);
      // Dùng default nếu lỗi
      setConfig({
        intervalSeconds: 5,
        periodValue: 1,
        periodUnit: "hour",
        enabledCameraIds: []
      });
    } finally {
      setLoadingConfig(false);
    }
  }, [BACKEND_URL]);

  useEffect(() => {
    if (show) {
      if (timelapseConfig) {
        setConfig(timelapseConfig);
        setPeriodValue(timelapseConfig.periodValue || 1);
        setPeriodUnit(timelapseConfig.periodUnit || "hour");
        
        // Parse intervalSeconds
        const intervalSeconds = timelapseConfig.intervalSeconds || 5;
        if (intervalSeconds >= 3600 && intervalSeconds % 3600 === 0) {
          setIntervalValue(intervalSeconds / 3600);
          setIntervalUnit("hours");
        } else if (intervalSeconds >= 60 && intervalSeconds % 60 === 0) {
          setIntervalValue(intervalSeconds / 60);
          setIntervalUnit("minutes");
        } else {
          setIntervalValue(intervalSeconds);
          setIntervalUnit("seconds");
        }
      } else {
        loadTimelapseConfig();
      }
    }
  }, [show, timelapseConfig, loadTimelapseConfig]);


  const handleSaveTimelapseConfig = async (e) => {
    e.preventDefault();
    if (!config) return;
    if (!intervalValue || intervalValue <= 0) {
      alert("Khoảng thời gian extract frame phải > 0.");
      return;
    }

    const multiplier =
      intervalUnit === "hours"
        ? 3600
        : intervalUnit === "minutes"
        ? 60
        : 1;
    const intervalSeconds = intervalValue * multiplier;

    try {
      setSavingTimelapseConfig(true);
      const response = await fetch(`${BACKEND_URL}/api/timelapse/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intervalSeconds,
          periodValue,
          periodUnit,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Failed to save config");
      }
      const result = await response.json();
      const updated = result.data || result.config || result;
      if (onSave) {
        onSave(updated);
      }
      alert("Đã lưu cài đặt timelapse thành công!");
      onClose();
    } catch (error) {
      console.error("Error saving timelapse config:", error);
      alert(`Lỗi khi lưu cài đặt timelapse: ${error.message}`);
    } finally {
      setSavingTimelapseConfig(false);
    }
  };

  if (!show) return null;

  return (
    <div
      className="modal show d-block"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
    >
      <div
        className="modal-dialog modal-dialog-centered modal-dialog-scrollable"
        style={{
          maxWidth: "90vw",
          width: "600px",
          maxHeight: "90vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="modal-content bg-dark text-white border-secondary"
          style={{ maxHeight: "90vh" }}
        >
          <div className="modal-header border-secondary flex-shrink-0">
            <h5 className="modal-title">Cài đặt Timelapse tự động</h5>
            <button
              type="button"
              className="btn-close btn-close-white"
              onClick={onClose}
            ></button>
          </div>
          <div
            className="modal-body"
            style={{ overflowY: "auto", maxHeight: "calc(90vh - 120px)" }}
          >
            {config ? (
              <form
                className="d-flex flex-column gap-3"
                onSubmit={handleSaveTimelapseConfig}
              >
                <div>
                  <label className="form-label">
                    Chu kỳ tạo video timelapse
                  </label>
                  <div className="input-group mb-2">
                    <input
                      type="number"
                      className="form-control bg-dark text-white border-secondary"
                      min="1"
                      value={periodValue}
                      onChange={(e) => setPeriodValue(Number(e.target.value))}
                    />
                    <select
                      className="form-select bg-dark text-white border-secondary"
                      value={periodUnit}
                      onChange={(e) => setPeriodUnit(e.target.value)}
                    >
                      <option value="minute">Phút</option>
                      <option value="hour">Giờ</option>
                      <option value="day">Ngày</option>
                      <option value="month">Tháng</option>
                      <option value="year">Năm</option>
                    </select>
                  </div>
                  <small className="text-secondary">
                    Mỗi {periodValue}{" "}
                    {periodUnit === "minute"
                      ? "phút"
                      : periodUnit === "hour"
                      ? "giờ"
                      : periodUnit === "day"
                      ? "ngày"
                      : periodUnit === "month"
                      ? "tháng"
                      : "năm"}{" "}
                    sẽ tạo 1 video timelapse
                  </small>
                </div>

                <div>
                  <label className="form-label">
                    Khoảng thời gian extract frame từ recordings
                  </label>
                  <div className="input-group">
                    <input
                      type="number"
                      className="form-control bg-dark text-white border-secondary"
                      min="1"
                      value={intervalValue}
                      onChange={(e) =>
                        setIntervalValue(Number(e.target.value))
                      }
                    />
                    <select
                      className="form-select bg-dark text-white border-secondary"
                      value={intervalUnit}
                      onChange={(e) => setIntervalUnit(e.target.value)}
                    >
                      <option value="seconds">Giây</option>
                      <option value="minutes">Phút</option>
                      <option value="hours">Giờ</option>
                    </select>
                  </div>
                  <small className="text-secondary">
                    Mỗi {intervalValue}{" "}
                    {intervalUnit === "hours"
                      ? "giờ"
                      : intervalUnit === "minutes"
                      ? "phút"
                      : "giây"}{" "}
                    sẽ extract 1 frame từ recordings để tạo timelapse
                  </small>
                </div>



                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingTimelapseConfig}
                >
                  {savingTimelapseConfig ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2"></span>
                      Đang lưu...
                    </>
                  ) : (
                    "Lưu cài đặt"
                  )}
                </button>
              </form>
            ) : loadingConfig ? (
              <div className="text-center">
                <span className="spinner-border"></span>
                <p className="mt-2 text-secondary">Đang tải cài đặt...</p>
              </div>
            ) : (
              <div className="text-center text-secondary">
                <p>Không thể tải cài đặt. Vui lòng thử lại.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimelapseSettingsModal;
