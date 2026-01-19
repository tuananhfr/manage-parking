import { useState, useEffect } from "react";
import { CENTRAL_URL } from "@/config";
import useBackendType from "@/hooks/useBackendType";
import SubscriptionList from "./subscription/SubscriptionList";
import StaffList from "./staff/StaffList";
import P2PSettings from "./p2p/P2PSettings";
import NVRServerSettings from "./nvr/NVRServerSettings";
import BankAccountSettings from "./bank/BankAccountSettings";

/**
 * SettingsModal - Component modal cài đặt hệ thống
 */
const SettingsModal = ({ show, onClose, onSaveSuccess }) => {
  const { backendType } = useBackendType();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);
  const [message, setMessage] = useState(null);
  const [activeTab, setActiveTab] = useState("cameras");
  const [showAddCameraForm, setShowAddCameraForm] = useState(false);
  const [newCamera, setNewCamera] = useState({
    name: "",
    ip: "",
    camera_type: "ENTRY",
  });

  useEffect(() => {
    if (show) {
      fetchConfig();
      // Default to 'staff' tab
      setActiveTab("staff");
      setShowAddCameraForm(false);
      setNewCamera({
        name: "",
        ip: "",
        camera_type: "ENTRY",
      });
      setMessage(null);
    }
  }, [show]);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      // Timeout 2 giây để không block quá lâu khi backend sai
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${CENTRAL_URL}/api/config`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await response.json();
      // console.log("[Settings] Fetched config:", data);
      console.log(
        "[Settings] Parking lot capacity from backend:",
        data.config?.parking_lot?.capacity
      );
      if (data.success) {
        setConfig(data.config);
        setMessage(null); // Clear error message nếu fetch thành công
      } else {
        setMessage({
          type: "error",
          text: "Không thể tải cấu hình từ backend",
        });
      }
    } catch (err) {
      console.error("[Settings] Fetch error:", err);

      // Tự động chuyển sang tab frontend_backend để user có thể fix ngay
      setActiveTab("frontend_backend");
      // Không set config = null để các tab khác vẫn có thể hoạt động với config cũ
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      // console.log("[Settings] Saving config:", config);
      console.log(
        "[Settings] Parking lot capacity:",
        config.parking_lot?.capacity
      );

      const response = await fetch(`${CENTRAL_URL}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await response.json();

      console.log("[Settings] Save response:", data);

      if (data.success) {
        // console.log("[Settings] Config saved successfully");
        // console.log("[Settings] Returned config:", data.config);

        // Broadcast config change event to all components
        window.dispatchEvent(
          new CustomEvent("configUpdated", {
            detail: { timestamp: Date.now() },
          })
        );

        onClose();
        if (typeof onSaveSuccess === "function") {
          onSaveSuccess();
        }
      } else {
        setMessage({
          type: "error",
          text: `${data.error || "Lỗi lưu cấu hình"}`,
        });
      }
    } catch (err) {
      console.error("[Settings] Save error:", err);
      setMessage({ type: "error", text: "Không thể lưu cấu hình" });
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = (section, key, value) => {
    setConfig((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value,
      },
    }));
  };

  const updateCameraConfig = (camId, key, value) => {
    setConfig((prev) => ({
      ...prev,
      edge_cameras: {
        ...(prev.edge_cameras || {}),
        [camId]: {
          ...(prev.edge_cameras?.[camId] || {}),
          [key]: value,
        },
      },
    }));
  };

  const handleAddCamera = () => {
    if (!newCamera.name.trim() || !newCamera.ip.trim()) {
      setMessage({
        type: "error",
        text: "Vui lòng điền đầy đủ tên camera và IP address",
      });
      return;
    }

    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipPattern.test(newCamera.ip.trim())) {
      setMessage({
        type: "error",
        text: "IP address không hợp lệ. Vui lòng nhập đúng định dạng (ví dụ: 192.168.0.144)",
      });
      return;
    }

    const existingIds = Object.keys(config.edge_cameras || {})
      .map((id) => parseInt(id, 10))
      .filter((id) => !isNaN(id));
    const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
    const newCameraId = maxId + 1;

    setConfig((prev) => ({
      ...prev,
      edge_cameras: {
        ...(prev.edge_cameras || {}),
        [newCameraId]: {
          name: newCamera.name.trim(),
          ip: newCamera.ip.trim(),
          camera_type: newCamera.camera_type || "ENTRY",
        },
      },
    }));

    setNewCamera({
      name: "",
      ip: "",
      camera_type: "ENTRY",
    });
    setShowAddCameraForm(false);
    setMessage({
      type: "success",
      text: `Đã thêm camera ${newCameraId}: ${newCamera.name.trim()}`,
    });
  };

  const handleRemoveCamera = async (camId) => {
    if (
      window.confirm(
        `Bạn có chắc muốn xóa camera ${camId}: ${
          config.edge_cameras?.[camId]?.name || ""
        }?`
      )
    ) {
      try {
        // Xóa camera khỏi database trước
        const response = await fetch(`${CENTRAL_URL}/api/cameras/${camId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error || `Failed to delete camera ${camId}`);
        }

        // Sau đó xóa khỏi config
        setConfig((prev) => {
          const newCameras = { ...(prev.edge_cameras || {}) };
          delete newCameras[camId];
          return {
            ...prev,
            edge_cameras: newCameras,
          };
        });
        setMessage({
          type: "success",
          text: `Đã xóa camera ${camId}`,
        });

        // Refresh cameras list để UI cập nhật ngay
        if (typeof onSaveSuccess === "function") {
          onSaveSuccess();
        }
      } catch (err) {
        console.error("[Settings] Error deleting camera:", err);
        setMessage({
          type: "error",
          text: err.message || `Không thể xóa camera ${camId}`,
        });
      }
    }
  };

  if (!show) return null;

  return (
    <div
      className="modal show d-block"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
    >
      <div
        className="modal-dialog modal-xl modal-dialog-scrollable"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content bg-dark text-white border-secondary">
          <div
            className="modal-header border-secondary"
            style={{
              background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
            }}
          >
            <h5 className="modal-title">
              <i className="bi bi-gear-fill me-2"></i>
              Cài đặt hệ thống
            </h5>
            <button
              type="button"
              className="btn-close btn-close-white"
              onClick={onClose}
            ></button>
          </div>
          <div className="modal-body">
            {/* Chỉ hiển thị loading khi không phải tab frontend_backend và đang loading */}
            {loading && activeTab !== "frontend_backend" && !backendType ? (
              <div className="text-center py-4">
                <div className="spinner-border text-primary"></div>
              </div>
            ) : config || activeTab === "frontend_backend" ? (
              // Hiển thị nội dung nếu có config HOẶC đang ở tab frontend_backend (luôn cho phép đổi backend URL)
              <div>
                {message && (
                  <div
                    className={`alert alert-${
                      message.type === "success"
                        ? "success"
                        : message.type === "warning"
                        ? "warning"
                        : "danger"
                    }`}
                  >
                    {message.text}
                  </div>
                )}

                {/* Tab Navigation */}
                <ul className="nav nav-tabs mb-3" role="tablist">
                  {/* Các tab khác chỉ hiển thị khi có config */}
                  {config && (
                    <>
                      {/* Legacy 'cameras' tab (Edge-based) disabled in favor of NVR management
                      <li className="nav-item" role="presentation">
                        <button
                          className={`nav-link ${
                            activeTab === "cameras" ? "active" : ""
                          }`}
                          onClick={() => setActiveTab("cameras")}
                          type="button"
                        >
                          <i className="bi bi-camera-video me-2"></i>
                          Cameras
                        </button>
                      </li>
                      */}

                      <li className="nav-item" role="presentation">
                        <button
                          className={`nav-link ${
                            activeTab === "staff" ? "active" : ""
                          }`}
                          onClick={() => setActiveTab("staff")}
                          type="button"
                        >
                          <i className="bi bi-people me-2"></i>
                          Danh sách người trực
                        </button>
                      </li>
                      <li className="nav-item" role="presentation">
                        <button
                          className={`nav-link ${
                            activeTab === "subscriptions" ? "active" : ""
                          }`}
                          onClick={() => setActiveTab("subscriptions")}
                          type="button"
                        >
                          <i className="bi bi-card-list me-2"></i>
                          Danh sách thuê bao
                        </button>
                      </li>
                      <li className="nav-item" role="presentation">
                        <button
                          className={`nav-link ${
                            activeTab === "barrier" ? "active" : ""
                          }`}
                          onClick={() => setActiveTab("barrier")}
                          type="button"
                        >
                          <i className="bi bi-door-closed me-2"></i>
                          Barrier
                        </button>
                      </li>
                      <li className="nav-item" role="presentation">
                        <button
                          className={`nav-link ${
                            activeTab === "card_reader" ? "active" : ""
                          }`}
                          onClick={() => setActiveTab("card_reader")}
                          type="button"
                        >
                          <i className="bi bi-credit-card me-2"></i>
                          Đọc thẻ từ
                        </button>
                      </li>
                      <li className="nav-item" role="presentation">
                        <button
                          className={`nav-link ${
                            activeTab === "report" ? "active" : ""
                          }`}
                          onClick={() => setActiveTab("report")}
                          type="button"
                        >
                          <i className="bi bi-file-earmark-text me-2"></i>
                          Gửi báo cáo
                        </button>
                      </li>
                      <li className="nav-item" role="presentation">
                        <button
                          className={`nav-link ${
                            activeTab === "central_server" ? "active" : ""
                          }`}
                          onClick={() => setActiveTab("central_server")}
                          type="button"
                        >
                          <i className="bi bi-server me-2"></i>
                          IP máy chủ central
                        </button>
                      </li>
                      <li className="nav-item" role="presentation">
                        <button
                          className={`nav-link ${
                            activeTab === "nvr_servers" ? "active" : ""
                          }`}
                          onClick={() => setActiveTab("nvr_servers")}
                          type="button"
                        >
                          <i className="bi bi-hdd-rack me-2"></i>
                          NVR Servers
                        </button>
                      </li>
                      <li className="nav-item" role="presentation">
                        <button
                          className={`nav-link ${
                            activeTab === "bank_account" ? "active" : ""
                          }`}
                          onClick={() => setActiveTab("bank_account")}
                          type="button"
                        >
                          <i className="bi bi-bank me-2"></i>
                          Tài khoản ngân hàng
                        </button>
                      </li>
                    </>
                  )}
                </ul>

                {/* Tab Content */}

                {/* Legacy Camera Content Disabled */}


                {activeTab === "staff" && (
                  <div>
                    <h6 className="border-bottom pb-2 mb-3">
                      <i className="bi bi-people me-2"></i>
                      Danh sách người trực
                    </h6>
                    <div className="mb-3">
                      <label className="form-label small">API Endpoint</label>
                      <div className="input-group">
                        <input
                          type="text"
                          className="form-control form-control-sm bg-dark text-white border-secondary"
                          value={config.staff?.api_url || ""}
                          onChange={(e) =>
                            updateConfig("staff", "api_url", e.target.value)
                          }
                          placeholder="https://paristechno.vn/api/v1/shift?_format=json"
                        />
                        <button
                          className="btn btn-primary"
                          onClick={async () => {
                            const apiUrl = config.staff?.api_url?.trim();
                            if (!apiUrl) {
                              setMessage({
                                type: "warning",
                                text: "Vui lòng nhập URL API",
                              });
                              return;
                            }

                            try {
                              setSaving(true);
                              const response = await fetch(
                                `${CENTRAL_URL}/api/staff/sync`,
                                {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({ api_url: apiUrl }),
                                }
                              );
                              const data = await response.json();
                              if (data.success) {
                                setMessage({
                                  type: "success",
                                  text: data.message || "Đồng bộ thành công!",
                                });
                                // Trigger StaffList refresh
                                setConfig((prev) => ({
                                  ...prev,
                                  staff: {
                                    ...prev.staff,
                                    _refresh: Date.now(),
                                  },
                                }));
                              } else {
                                setMessage({
                                  type: "error",
                                  text: data.error || "Đồng bộ thất bại",
                                });
                              }
                            } catch (err) {
                              console.error("Sync error:", err);
                              setMessage({
                                type: "error",
                                text: "Không thể kết nối đến server",
                              });
                            } finally {
                              setSaving(false);
                            }
                          }}
                          disabled={saving}
                        >
                          Lưu
                        </button>
                      </div>
                    </div>
                    <div className="mt-4">
                      <StaffList
                        key={config.staff?._refresh || 0}
                        apiUrl={config.staff?.api_url || ""}
                      />
                    </div>
                  </div>
                )}

                {activeTab === "subscriptions" && (
                  <div>
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <h6 className="border-bottom pb-2 mb-0">
                        <i className="bi bi-card-list me-2"></i>
                        Danh sách thuê bao
                      </h6>
                    </div>
                    <div className="mb-3">
                      <label className="form-label small">
                        Đồng bộ danh sách thuê bao từ Drupal
                      </label>
                      <div className="input-group">
                        <input
                          type="text"
                          className="form-control form-control-sm bg-dark text-white border-secondary"
                          value="https://paristechno.vn/api/v1/vehicles"
                          disabled
                          placeholder="URL API thuê bao"
                        />
                        <button
                          className="btn btn-primary"
                          onClick={async () => {
                            try {
                              setSaving(true);
                              const response = await fetch(
                                `${CENTRAL_URL}/api/subscriptions/sync`,
                                {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                }
                              );
                              const data = await response.json();
                              if (data.success) {
                                setMessage({
                                  type: "success",
                                  text: data.message || "Đồng bộ thành công!",
                                });
                                // Trigger SubscriptionList refresh
                                setConfig((prev) => ({
                                  ...prev,
                                  subscriptions: {
                                    ...prev.subscriptions,
                                    _refresh: Date.now(),
                                  },
                                }));
                              } else {
                                setMessage({
                                  type: "error",
                                  text: data.error || "Đồng bộ thất bại",
                                });
                              }
                            } catch (err) {
                              console.error("Sync error:", err);
                              setMessage({
                                type: "error",
                                text: "Không thể kết nối đến server",
                              });
                            } finally {
                              setSaving(false);
                            }
                          }}
                          disabled={saving}
                        >
                          Lưu
                        </button>
                      </div>
                    </div>
                    <div className="mt-4">
                      <SubscriptionList
                        key={config.subscriptions?._refresh || 0}
                        apiUrl={config.subscriptions?.api_url || ""}
                      />
                    </div>
                  </div>
                )}

                {activeTab === "barrier" && (
                  <div>
                    <h6 className="border-bottom pb-2 mb-3">
                      <i className="bi bi-door-closed me-2"></i>
                      Cài đặt Barrier
                    </h6>

                    <div className="alert alert-info mb-3">
                      <strong>Lưu ý:</strong> Đây là cài đặt{" "}
                      <strong>CÓ/KHÔNG</strong> sử dụng hệ thống barrier.
                      <br />
                      Sau khi bật, bạn sẽ có nút <strong>MỞ/ĐÓNG</strong>{" "}
                      barrier trên frontend.
                    </div>

                    <div className="mb-3">
                      <div className="form-check form-switch">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="barrierEnabled"
                          checked={config.barrier?.enabled || false}
                          onChange={(e) =>
                            updateConfig("barrier", "enabled", e.target.checked)
                          }
                        />
                        <label
                          className="form-check-label"
                          htmlFor="barrierEnabled"
                        >
                          <strong>CÓ sử dụng hệ thống Barrier</strong>
                        </label>
                      </div>
                      <small className="text-muted d-block mt-2">
                        <i className="bi bi-info-circle me-1"></i>
                        <strong>BẬT:</strong> Hệ thống có barrier → Nhập biển →
                        Mở barrier → Đợi đóng → Lưu DB
                        <br />
                        <strong>TẮT:</strong> Không có barrier → Nhập biển → Lưu
                        DB ngay
                      </small>
                    </div>
                    {config.barrier?.enabled && (
                      <div className="card border-primary">
                        <div className="card-body">
                          <h6 className="card-title text-primary mb-3">
                            <i className="bi bi-gear me-2"></i>
                            Cấu hình GPIO
                          </h6>
                          <div className="row g-3">
                            <div className="col-md-6">
                              <label className="form-label small">
                                GPIO Pin
                              </label>
                              <input
                                type="number"
                                className="form-control form-control-sm"
                                value={config.barrier?.gpio_pin || 18}
                                onChange={(e) =>
                                  updateConfig(
                                    "barrier",
                                    "gpio_pin",
                                    parseInt(e.target.value)
                                  )
                                }
                              />
                              <small className="text-muted">
                                GPIO pin để điều khiển relay barrier
                              </small>
                            </div>
                            <div className="col-md-6">
                              <label className="form-label small">
                                Tự động đóng sau (giây)
                              </label>
                              <input
                                type="number"
                                className="form-control form-control-sm"
                                value={config.barrier?.auto_close_time || 5.0}
                                step="0.5"
                                onChange={(e) =>
                                  updateConfig(
                                    "barrier",
                                    "auto_close_time",
                                    parseFloat(e.target.value)
                                  )
                                }
                              />
                              <small className="text-muted">
                                Để 0 nếu không muốn tự động đóng
                              </small>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "card_reader" && (
                  <div>
                    <h6 className="border-bottom pb-2 mb-3">
                      <i className="bi bi-credit-card me-2"></i>
                      Cấu hình Đọc thẻ từ
                    </h6>
                    <div className="alert alert-info">
                      <i className="bi bi-info-circle me-2"></i>
                      Cấu hình đọc thẻ từ sẽ được thêm vào sau
                    </div>
                  </div>
                )}

                {activeTab === "report" && (
                  <div>
                    <h6 className="border-bottom pb-2 mb-3">
                      <i className="bi bi-file-earmark-text me-2"></i>
                      Cấu hình Gửi báo cáo
                    </h6>
                    <div className="mb-3">
                      <label className="form-label small">
                        API Endpoint gửi báo cáo
                      </label>
                      <div className="input-group input-group-sm">
                        <input
                          type="text"
                          className="form-control form-control-sm"
                          value={config.report?.api_url || ""}
                          onChange={(e) =>
                            updateConfig("report", "api_url", e.target.value)
                          }
                          placeholder="https://paristechno.vn/api/v1/report?_format=json"
                        />
                        <button
                          className="btn btn-outline-primary"
                          onClick={async () => {
                            try {
                              const res = await fetch(`${CENTRAL_URL}/api/config`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ report: { api_url: config.report?.api_url || "" } }),
                              });
                              if (res.ok) {
                                window.dispatchEvent(new Event("configUpdated"));
                                alert("Đã lưu API Endpoint!");
                              } else {
                                alert("Lỗi khi lưu");
                              }
                            } catch (err) {
                              alert("Lỗi: " + err.message);
                            }
                          }}
                        >
                          <i className="bi bi-save me-1"></i>
                          Lưu
                        </button>
                      </div>
                      <small className="text-muted">
                        <i className="bi bi-info-circle me-1"></i>
                        URL để PATCH báo cáo (ví dụ: https://paristechno.vn/node/131?_format=json)
                      </small>
                    </div>

                    <hr className="my-3" />

                    <h6 className="mb-3">
                      <i className="bi bi-send me-2"></i>
                      Test gửi báo cáo
                    </h6>
                    
                    <div className="d-flex flex-wrap gap-2">
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={sendingReport}
                        onClick={async () => {
                          const apiUrl = config.report?.api_url;
                          if (!apiUrl) {
                            alert("Vui lòng nhập API Endpoint trước!");
                            return;
                          }

                          if (!window.confirm("Hệ thống sẽ tạo báo cáo mới trên Drupal với:\n• Lưu lượng xe\n• Ca trực\n• Parking Lock\n\nTiếp tục?")) return;

                          setSendingReport(true);

                          try {
                            const res = await fetch(`${CENTRAL_URL}/api/reports/send-daily`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                            });
                            const data = await res.json();
                            
                            if (res.ok && data.success) {
                              const s = data.summary || {};
                              alert(
                                `✅ Đã tạo báo cáo thành công!\n\n` +
                                `Node ID: ${data.node_id}\n` +
                                `Ngày: ${data.date}\n\n` +
                                `• Lưu lượng: Vào ${s.traffic?.total_in || 0}, Ra ${s.traffic?.total_out || 0}\n` +
                                `• Ca trực: ${s.shifts_count || 0} ca\n` +
                                `• Parking: ${(s.parking?.total_revenue || 0).toLocaleString()}đ`
                              );
                            } else {
                              alert("❌ Lỗi: " + (data.detail || data.message || "Không thể tạo báo cáo"));
                            }
                          } catch (e) {
                            alert("❌ Lỗi kết nối: " + e.message);
                          } finally {
                            setSendingReport(false);
                          }
                        }}
                      >
                        {sendingReport ? (
                          <>
                            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                            Đang tạo báo cáo...
                          </>
                        ) : (
                          <>
                            <i className="bi bi-cloud-upload me-2"></i>
                            Tạo báo cáo hôm nay
                          </>
                        )}
                      </button>
                    </div>
                    
                    <small className="d-block text-muted mt-2">
                      <i className="bi bi-info-circle me-1"></i>
                      Tạo node mới trên Drupal chứa báo cáo lưu lượng xe, ca trực và parking lock
                    </small>
                  </div>
                )}

                {activeTab === "central_server" && (
                  <div>
                    <h6 className="border-bottom pb-2 mb-3">
                      <i className="bi bi-server me-2"></i>
                      {backendType === "edge"
                        ? "Kết nối đến Central Server"
                        : "Cấu hình máy chủ Central hiện tại"}
                    </h6>

                    <div className="mb-3">
                      <label className="form-label small">
                        {backendType === "edge"
                          ? "IP/URL Central Server (để trống nếu standalone)"
                          : "IP máy chủ Central này"}
                        {backendType === "central" && (
                          <span className="badge bg-secondary ms-2">auto</span>
                        )}
                      </label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={config.central_server?.ip || ""}
                        onChange={(e) =>
                          updateConfig("central_server", "ip", e.target.value)
                        }
                        placeholder={
                          backendType === "edge"
                            ? "http://192.168.1.100:8000 (hoac de trong)"
                            : "auto hoặc 192.168.1.100"
                        }
                        disabled={backendType === "central"}
                        readOnly={backendType === "central"}
                      />
                      <small className="text-muted">
                        <i className="bi bi-info-circle me-1"></i>
                        {backendType === "edge"
                          ? "Nhập IP/URL của Central Server hoặc để trống để sử dụng Edge standalone"
                          : "IP này được tự động phát hiện khi khởi động Central Server"}
                      </small>
                    </div>
                  </div>
                )}

                {activeTab === "nvr_servers" && (
                  <div>
                    <NVRServerSettings />
                  </div>
                )}

                {activeTab === "bank_account" && (
                  <div>
                    <BankAccountSettings
                      config={config}
                      updateConfig={updateConfig}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="alert alert-warning">
                <i className="bi bi-exclamation-triangle me-2"></i>
                Không thể tải cấu hình từ backend.
                <br />
                <small>
                  Vui lòng chuyển sang tab "Kết nối Frontend → Backend" để đổi
                  backend URL.
                </small>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary btn-sm" onClick={onClose}>
              Đóng
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              disabled={saving || !config}
            >
              {saving ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2"></span>
                  Đang lưu...
                </>
              ) : (
                <>
                  <i className="bi bi-save me-2"></i>
                  Lưu cấu hình
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
