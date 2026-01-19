import { useState, useEffect, useCallback } from "react";

const ParkingOverview = ({ showManageBackends, onCloseManageBackends }) => {
  const [backends, setBackends] = useState([]);
  const [devices, setDevices] = useState([]);
  const [lockers, setLockers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [lockersLoading, setLockersLoading] = useState(false);
  const [selectedLocker, setSelectedLocker] = useState(null);
  const [showLockerModal, setShowLockerModal] = useState(false);
  const [showBackendDetail, setShowBackendDetail] = useState(false);
  const [controllingLocker, setControllingLocker] = useState(null);
  const [configLocker, setConfigLocker] = useState(null);
  const [configData, setConfigData] = useState({
    upProtect: "",
    downProtect: "",
    freeTime: "",
    warningTime: "",
    hourlyRate: "",
  });
  // Filter and Search states
  const [searchTerm, setSearchTerm] = useState("");
  const [filterBackend, setFilterBackend] = useState("");
  const [filterDevice, setFilterDevice] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterOccupied, setFilterOccupied] = useState("");

  const [newBackend, setNewBackend] = useState({
    id: "",
    name: "",
    host: "",
    port: 8080,
    description: "",
    enabled: true,
  });

  const BACKEND_URL =
    import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

  // Load all data when component mounts
  useEffect(() => {
    loadBackends();
    loadDevices();
    loadLockers();
  }, [loadBackends, loadDevices, loadLockers]);

  // WebSocket logic removed as per design decision (HTTP-only)
  // Real-time updates should be handled via polling or manual refresh if needed
  useEffect(() => {
    // Optional: Implement periodic polling here if needed
    // For now, rely on manual refresh
  }, []);

  const loadBackends = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${BACKEND_URL}/api/parking/backends`);
      if (!response.ok) throw new Error("Failed to fetch backends");
      const result = await response.json();
      const data = result.data || result;
      setBackends(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Error loading backends:", error);
      alert("Không thể tải danh sách bãi đỗ xe");
    } finally {
      setLoading(false);
    }
  }, [BACKEND_URL]);

  const loadDevices = useCallback(async () => {
    try {
      setDevicesLoading(true);
      const response = await fetch(`${BACKEND_URL}/api/parking-lock/devices`);
      if (!response.ok) throw new Error("Không thể tải danh sách thiết bị");
      const result = await response.json();
      setDevices(result.data || []);
    } catch (error) {
      console.error("Error loading devices:", error);
      alert("Không thể tải danh sách thiết bị");
    } finally {
      setDevicesLoading(false);
    }
  }, [BACKEND_URL]);

  const loadLockers = useCallback(async () => {
    try {
      setLockersLoading(true);
      const response = await fetch(
        `${BACKEND_URL}/api/parking-lock/lockers?connected=true&limit=200`
      );
      if (!response.ok) throw new Error("Không thể tải danh sách tủ khóa");
      const result = await response.json();
      setLockers(result.data || []);
    } catch (error) {
      console.error("Error loading lockers:", error);
      alert("Không thể tải danh sách tủ khóa");
    } finally {
      setLockersLoading(false);
    }
  }, [BACKEND_URL]);

  const handleAddBackend = async (e) => {
    e.preventDefault();
    if (
      !newBackend.id ||
      !newBackend.name ||
      !newBackend.host ||
      !newBackend.port
    ) {
      alert("Vui lòng điền đầy đủ các trường bắt buộc");
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/parking/backends`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newBackend),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Thêm bãi đỗ xe thất bại");
      }

      setNewBackend({
        id: "",
        name: "",
        host: "",
        port: 8080,
        description: "",
        enabled: true,
      });
      onCloseManageBackends();
      loadBackends();
    } catch (error) {
      alert(error.message);
    }
  };

  const handleDeleteBackend = async (backendId) => {
    if (!confirm("Bạn có chắc chắn muốn xóa bãi đỗ xe này?")) return;

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/parking/backends/${backendId}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) throw new Error("Xóa bãi đỗ xe thất bại");
      loadBackends();
      loadDevices();
      loadLockers();
    } catch (error) {
      alert(error.message);
    }
  };

  const handleToggleBackend = async (backend) => {
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/parking/backends/${backend.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !backend.enabled }),
        }
      );

      if (!response.ok) throw new Error("Cập nhật bãi đỗ xe thất bại");
      loadBackends();
      loadDevices();
      loadLockers();
    } catch (error) {
      alert(error.message);
    }
  };

  const handleControlLocker = async (backendId, lockId, action) => {
    const actionText =
      {
        open: "mở",
        close: "đóng",
        stop: "dừng",
        normal: "đặt về chế độ bình thường",
      }[action] || action;
    if (!confirm(`Bạn có chắc chắn muốn ${actionText} tủ khóa ${lockId}?`)) {
      return;
    }

    setControllingLocker(lockId);
    try {
      const response = await fetch(
        `${BACKEND_URL}/api/parking-lock/backends/${backendId}/lockers/${lockId}/control`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, mode: "normal" }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Gửi lệnh thất bại");
      }

      alert(`Đã gửi lệnh ${actionText} tủ khóa ${lockId}`);
      loadLockers();
      if (
        showLockerModal &&
        selectedLocker &&
        selectedLocker.lock_id === lockId
      ) {
        setTimeout(async () => {
          const response = await fetch(
            `${BACKEND_URL}/api/parking-lock/lockers?connected=true&limit=200`
          );
          if (response.ok) {
            const result = await response.json();
            const updatedLocker = result.data?.find(
              (l) =>
                l.backend_id === selectedLocker.backend_id &&
                l.lock_id === lockId
            );
            if (updatedLocker) {
              setSelectedLocker(updatedLocker);
            }
          }
        }, 1000);
      }
      if (action === "close") {
        setTimeout(() => loadLockers(), 2000);
        setTimeout(() => loadLockers(), 4000);
      } else {
        setTimeout(() => loadLockers(), 1000);
      }
    } catch (error) {
      console.error(`Failed to ${action} locker:`, error);
      alert(`Không thể gửi lệnh: ${error.message}`);
    } finally {
      setControllingLocker(null);
    }
  };

  const handleSetAttribute = async (backendId, lockId) => {
    if (!configData.upProtect && !configData.downProtect) {
      alert("Vui lòng nhập ít nhất một giá trị bảo vệ (20-95)");
      return;
    }

    try {
      const data = {};
      if (configData.upProtect) {
        const value = parseInt(configData.upProtect);
        if (value < 20 || value > 95) {
          alert("Bảo vệ trên phải từ 20 đến 95");
          return;
        }
        data.up_protect = value;
      }
      if (configData.downProtect) {
        const value = parseInt(configData.downProtect);
        if (value < 20 || value > 95) {
          alert("Bảo vệ dưới phải từ 20 đến 95");
          return;
        }
        data.down_protect = value;
      }

      const response = await fetch(
        `${BACKEND_URL}/api/parking-lock/backends/${backendId}/lockers/${lockId}/set-attribute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );

      if (!response.ok) throw new Error("Thiết lập thuộc tính thất bại");
      alert("Đã thiết lập thuộc tính thành công");
      setConfigLocker(null);
      setConfigData({
        upProtect: "",
        downProtect: "",
        freeTime: "",
        warningTime: "",
      });
    } catch (error) {
      console.error("Failed to set attribute:", error);
      alert("Không thể thiết lập thuộc tính");
    }
  };

  const handleSetFreeTime = async (backendId, lockId) => {
    if (!configData.freeTime || parseInt(configData.freeTime) < 0) {
      alert("Vui lòng nhập thời gian hợp lệ (>= 0 phút)");
      return;
    }

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/parking-lock/backends/${backendId}/lockers/${lockId}/free-time`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ time: parseInt(configData.freeTime) }),
        }
      );

      if (!response.ok)
        throw new Error("Thiết lập thời gian miễn phí thất bại");
      alert("Đã thiết lập thời gian miễn phí thành công");
      setConfigData({ ...configData, freeTime: "" });
    } catch (error) {
      console.error("Failed to set free time:", error);
      alert("Không thể thiết lập thời gian miễn phí");
    }
  };

  const handleSetWarningTime = async (backendId, lockId) => {
    if (!configData.warningTime || parseInt(configData.warningTime) < 0) {
      alert("Vui lòng nhập thời gian hợp lệ (>= 0 giây)");
      return;
    }

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/parking-lock/backends/${backendId}/lockers/${lockId}/warning-time`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ time: parseInt(configData.warningTime) }),
        }
      );

      if (!response.ok)
        throw new Error("Thiết lập thời gian cảnh báo thất bại");
      alert("Đã thiết lập thời gian cảnh báo thành công");
      setConfigData({ ...configData, warningTime: "" });
    } catch (error) {
      console.error("Failed to set warning time:", error);
      alert("Không thể thiết lập thời gian cảnh báo");
    }
  };

  const handleSetHourlyRate = async (backendId, lockId) => {
    if (!configData.hourlyRate || parseInt(configData.hourlyRate) < 0) {
      alert("Vui lòng nhập giá tiền hợp lệ (>= 0)");
      return;
    }

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/parking-lock/backends/${backendId}/lockers/${lockId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hourly_rate: parseInt(configData.hourlyRate),
          }),
        }
      );

      if (!response.ok) throw new Error("Thiết lập giá tiền thất bại");
      alert("Đã thiết lập giá tiền thành công");
      setConfigData({ ...configData, hourlyRate: "" });

      // Reload lockers to refresh data
      setTimeout(() => loadLockers(), 500);
    } catch (error) {
      console.error("Failed to set hourly rate:", error);
      alert("Không thể thiết lập giá tiền");
    }
  };

  const formatTime = (dateString) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return `${hours}h ${mins}m`;
  };

  const formatPrice = (parkingFee) => {
    if (parkingFee === null || parkingFee === undefined) {
      return "-";
    }
    if (parkingFee === 0) {
      return "0 đ";
    }
    return `${parkingFee.toLocaleString("vi-VN")} đ`;
  };

  const filteredLockers = lockers.filter((locker) => {
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch =
        locker.lock_id?.toLowerCase().includes(searchLower) ||
        locker.device_id?.toLowerCase().includes(searchLower) ||
        locker.backend_name?.toLowerCase().includes(searchLower) ||
        locker.name?.toLowerCase().includes(searchLower);
      if (!matchesSearch) return false;
    }

    if (filterBackend && locker.backend_id !== filterBackend) {
      return false;
    }

    if (filterDevice && locker.device_id !== filterDevice) {
      return false;
    }

    if (filterStatus && locker.status !== filterStatus) {
      return false;
    }

    if (filterOccupied !== "") {
      const isOccupied = locker.occupied ? "yes" : "no";
      if (isOccupied !== filterOccupied) {
        return false;
      }
    }

    return true;
  });

  const uniqueBackends = Array.from(
    new Set(lockers.map((l) => l.backend_id))
  ).map((backendId) => {
    const backend = backends.find((b) => b.id === backendId);
    return {
      id: backendId,
      name: backend?.name || backendId,
    };
  });

  const uniqueDevices = Array.from(
    new Set(lockers.map((l) => l.device_id))
  ).map((deviceId) => {
    const device = devices.find((d) => d.id === deviceId);
    return {
      id: deviceId,
      name: device?.name || deviceId,
    };
  });

  const getLockerStatusColor = (locker) => {
    if (locker.occupied) return "danger";
    if (locker.status === "UP") return "success";
    return "warning";
  };

  const handleLockerClick = (locker) => {
    setSelectedLocker(locker);
    setShowLockerModal(true);
  };

  const clearFilters = () => {
    setSearchTerm("");
    setFilterBackend("");
    setFilterDevice("");
    setFilterStatus("");
    setFilterOccupied("");
  };

  const handleCarEnter = async (backendId, lockId, locker) => {
    if (locker.status !== "DOWN") {
      alert(
        `Không thể cho xe vào! Locker phải ở trạng thái DOWN (hiện tại: ${locker.status})`
      );
      return;
    }

    if (locker.occupied) {
      alert("Locker đã có xe! Vui lòng kiểm tra lại.");
      return;
    }

    if (
      !confirm(
        `Xác nhận cho xe vào locker ${lockId}?\nLocker sẽ tự động khóa sau khi hết thời gian miễn phí.`
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/parking-lock/backends/${backendId}/lockers/${lockId}/simulate-car-enter`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          error.detail || error.message || "Mô phỏng xe vào thất bại"
        );
      }

      alert("Xe đã vào thành công!");
      loadLockers();
    } catch (error) {
      console.error("Failed to simulate car enter:", error);
      alert(`Không thể cho xe vào: ${error.message}`);
    }
  };

  const handleCarExit = async (backendId, lockId, locker) => {
    if (!locker.occupied) {
      alert("Locker chưa có xe! Không thể cho xe ra.");
      return;
    }

    if (locker.status !== "DOWN") {
      alert(
        `Không thể cho xe ra! Locker phải ở trạng thái DOWN (hiện tại: ${locker.status})\nVui lòng thanh toán qua parking-pay trước.`
      );
      return;
    }

    if (!confirm(`Xác nhận cho xe ra khỏi locker ${lockId}?`)) {
      return;
    }

    try {
      const response = await fetch(
        `${BACKEND_URL}/api/parking-lock/backends/${backendId}/lockers/${lockId}/simulate-car-exit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          error.detail || error.message || "Mô phỏng xe ra thất bại"
        );
      }

      alert("Xe đã ra thành công!");
      loadLockers();
    } catch (error) {
      console.error("Failed to simulate car exit:", error);
      alert(`Không thể cho xe ra: ${error.message}`);
    }
  };

  return (
    <div className="h-100" style={{ overflow: "auto" }}>
      <div className="p-4">
        {/* Header */}
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h5 className="text-white mb-0">
            <i className="bi bi-lock me-2"></i>Bãi đỗ xe
          </h5>
          <div className="d-flex gap-2">
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={() => {
                loadBackends();
                loadDevices();
                loadLockers();
              }}
            >
              <i className="bi bi-arrow-clockwise me-2"></i>Làm mới tất cả
            </button>
          </div>
        </div>

        {/* Loading State */}
        {(loading || devicesLoading || lockersLoading) && (
          <div className="text-center py-4">
            <div className="spinner-border text-primary"></div>
            <p className="text-secondary mt-2">Đang tải...</p>
          </div>
        )}

        {/* Search and Filters */}
        {!loading && !devicesLoading && !lockersLoading && (
          <div
            className="accordion mb-4 shadow-sm"
            id="accordionFilterOverview"
          >
            <div className="accordion-item bg-dark border-secondary">
              <h2 className="accordion-header" id="headingFilterOverview">
                <button
                  className="accordion-button collapsed bg-secondary text-white"
                  type="button"
                  data-bs-toggle="collapse"
                  data-bs-target="#collapseFilterOverview"
                  aria-expanded="false"
                  aria-controls="collapseFilterOverview"
                >
                  <i className="bi bi-funnel me-2"></i>
                  Tìm kiếm và Lọc
                </button>
              </h2>
              <div
                id="collapseFilterOverview"
                className="accordion-collapse collapse"
                aria-labelledby="headingFilterOverview"
                data-bs-parent="#accordionFilterOverview"
              >
                <div className="accordion-body">
                  <div className="row g-3">
                    {/* Search */}
                    <div className="col-md-4">
                      <label className="form-label text-white">Tìm kiếm</label>
                      <div className="input-group">
                        <span className="input-group-text bg-dark text-white border-secondary">
                          <i className="bi bi-search"></i>
                        </span>
                        <input
                          type="text"
                          className="form-control bg-dark text-white border-secondary"
                          placeholder="Locker ID, Device ID, Backend..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Backend Filter */}
                    <div className="col-md-2">
                      <label className="form-label text-white">Bãi đỗ xe</label>
                      <select
                        className="form-select bg-dark text-white border-secondary"
                        value={filterBackend}
                        onChange={(e) => setFilterBackend(e.target.value)}
                      >
                        <option value="">Tất cả</option>
                        {uniqueBackends.map((backend) => (
                          <option key={backend.id} value={backend.id}>
                            {backend.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Device Filter */}
                    <div className="col-md-2">
                      <label className="form-label text-white">Thiết bị</label>
                      <select
                        className="form-select bg-dark text-white border-secondary"
                        value={filterDevice}
                        onChange={(e) => setFilterDevice(e.target.value)}
                      >
                        <option value="">Tất cả</option>
                        {uniqueDevices
                          .filter(
                            (d) =>
                              !filterBackend ||
                              lockers.some(
                                (l) =>
                                  l.device_id === d.id &&
                                  l.backend_id === filterBackend
                              )
                          )
                          .map((device) => (
                            <option key={device.id} value={device.id}>
                              {device.name}
                            </option>
                          ))}
                      </select>
                    </div>

                    {/* Status Filter */}
                    <div className="col-md-2">
                      <label className="form-label text-white">
                        Trạng thái
                      </label>
                      <select
                        className="form-select bg-dark text-white border-secondary"
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                      >
                        <option value="">Tất cả</option>
                        <option value="UP">UP</option>
                        <option value="DOWN">DOWN</option>
                        <option value="DownBotton">DownBotton</option>
                        <option value="MovingUp">MovingUp</option>
                        <option value="MovingDown">MovingDown</option>
                        <option value="Error">Error</option>
                      </select>
                    </div>

                    {/* Occupied Filter */}
                    <div className="col-md-2">
                      <label className="form-label text-white">Có xe?</label>
                      <select
                        className="form-select bg-dark text-white border-secondary"
                        value={filterOccupied}
                        onChange={(e) => setFilterOccupied(e.target.value)}
                      >
                        <option value="">Tất cả</option>
                        <option value="true">Có xe (Occupied)</option>
                        <option value="false">Trống (Empty)</option>
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
        )}
        {!loading && !devicesLoading && !lockersLoading && (
          <span className="text-secondary ms-3">
            Hiển thị: {filteredLockers.length} / {lockers.length} tủ khóa
          </span>
        )}

        {/* Table List */}
        {!loading && !devicesLoading && !lockersLoading && (
          <div className="card bg-dark border-secondary">
            <div className="card-body p-0">
              <div className="table-responsive">
                <table className="table table-dark table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Locker ID</th>
                      <th>Bãi đỗ xe</th>
                      <th>Thiết bị</th>
                      <th>Tên</th>
                      <th>Trạng thái</th>
                      <th>Chế độ</th>
                      <th>Đã sử dụng</th>
                      <th>Thời gian</th>
                      <th>Giá tiền</th>
                      <th>Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLockers.length === 0 ? (
                      <tr>
                        <td
                          colSpan="10"
                          className="text-center py-4 text-secondary"
                        >
                          <i className="bi bi-inbox me-2"></i>
                          Không tìm thấy tủ khóa nào
                        </td>
                      </tr>
                    ) : (
                      filteredLockers.map((locker) => {
                        const statusColor = getLockerStatusColor(locker);
                        return (
                          <tr
                            key={`${locker.backend_id}-${locker.lock_id}`}
                            style={{ cursor: "pointer" }}
                            onClick={() => handleLockerClick(locker)}
                          >
                            <td>
                              <strong>{locker.lock_id}</strong>
                            </td>
                            <td>
                              <span className="badge bg-info">
                                {locker.backend_name || locker.backend_id}
                              </span>
                            </td>
                            <td>{locker.device_id}</td>
                            <td>{locker.name || "-"}</td>
                            <td>
                              <span className={`badge bg-${statusColor}`}>
                                {locker.status}
                              </span>
                            </td>
                            <td>
                              <span className="badge bg-secondary">
                                {locker.mode}
                              </span>
                            </td>
                            <td>
                              {locker.occupied ? (
                                <span className="badge bg-danger">Có</span>
                              ) : (
                                <span className="badge bg-success">Không</span>
                              )}
                            </td>
                            <td>
                              {locker.last_action_time
                                ? formatTime(locker.last_action_time)
                                : "-"}
                            </td>
                            <td>
                              {locker.occupied
                                ? formatPrice(locker.parking_fee)
                                : "-"}
                            </td>
                            <td>
                              <div className="d-flex gap-1 flex-wrap">
                                {!locker.occupied ? (
                                  <button
                                    className="btn btn-sm btn-outline-success"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCarEnter(
                                        locker.backend_id,
                                        locker.lock_id,
                                        locker
                                      );
                                    }}
                                    disabled={locker.status !== "DOWN"}
                                    title={
                                      locker.status !== "DOWN"
                                        ? "Locker phải ở trạng thái DOWN để cho xe vào"
                                        : "Xe vào (Car Enter)"
                                    }
                                  >
                                    <i className="bi bi-car-front me-1"></i>
                                    Xe vào
                                  </button>
                                ) : (
                                  <button
                                    className="btn btn-sm btn-outline-danger"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCarExit(
                                        locker.backend_id,
                                        locker.lock_id,
                                        locker
                                      );
                                    }}
                                    disabled={locker.status !== "DOWN"}
                                    title={
                                      locker.status !== "DOWN"
                                        ? "Locker phải ở trạng thái DOWN để cho xe ra"
                                        : "Xe ra (Car Exit)"
                                    }
                                  >
                                    <i className="bi bi-car-front-fill me-1"></i>
                                    Xe ra
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading &&
          !devicesLoading &&
          !lockersLoading &&
          lockers.length === 0 && (
            <div className="card bg-dark border-secondary text-white">
              <div className="card-body text-center py-5">
                <i
                  className="bi bi-lock"
                  style={{ fontSize: "3rem", opacity: 0.3 }}
                ></i>
                <p className="mt-3 text-secondary">
                  Không tìm thấy tủ khóa nào. Thêm bãi đỗ xe để bắt đầu.
                </p>
              </div>
            </div>
          )}
      </div>

      {/* Add Backend Modal */}
      {showManageBackends && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content bg-dark text-white border-secondary">
                <div className="modal-header border-secondary">
                  <h5 className="modal-title">
                    <i className="bi bi-plus-circle me-2"></i>Thêm bãi đỗ xe
                  </h5>
                  <button
                    type="button"
                    className="btn-close btn-close-white"
                    onClick={onCloseManageBackends}
                  ></button>
                </div>
                <form onSubmit={handleAddBackend}>
                  <div className="modal-body">
                    <div className="mb-3">
                      <label className="form-label">
                        ID Bãi đỗ xe <span className="text-danger">*</span>
                      </label>
                      <input
                        type="text"
                        className="form-control bg-dark text-white border-secondary"
                        placeholder="backend_1"
                        value={newBackend.id}
                        onChange={(e) =>
                          setNewBackend({ ...newBackend, id: e.target.value })
                        }
                        required
                      />
                      <small className="text-secondary">
                        Định danh duy nhất cho bãi đỗ xe này
                      </small>
                    </div>
                    <div className="mb-3">
                      <label className="form-label">
                        Tên <span className="text-danger">*</span>
                      </label>
                      <input
                        type="text"
                        className="form-control bg-dark text-white border-secondary"
                        placeholder="Máy chủ bãi đỗ xe chính"
                        value={newBackend.name}
                        onChange={(e) =>
                          setNewBackend({ ...newBackend, name: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="row">
                      <div className="col-8 mb-3">
                        <label className="form-label">
                          Máy chủ <span className="text-danger">*</span>
                        </label>
                        <input
                          type="text"
                          className="form-control bg-dark text-white border-secondary"
                          placeholder="192.168.1.100"
                          value={newBackend.host}
                          onChange={(e) =>
                            setNewBackend({
                              ...newBackend,
                              host: e.target.value,
                            })
                          }
                          required
                        />
                      </div>
                      <div className="col-4 mb-3">
                        <label className="form-label">
                          Cổng <span className="text-danger">*</span>
                        </label>
                        <input
                          type="number"
                          className="form-control bg-dark text-white border-secondary"
                          placeholder="8080"
                          min="1"
                          max="65535"
                          value={newBackend.port}
                          onChange={(e) =>
                            setNewBackend({
                              ...newBackend,
                              port: parseInt(e.target.value) || 8080,
                            })
                          }
                          required
                        />
                      </div>
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Mô tả</label>
                      <textarea
                        className="form-control bg-dark text-white border-secondary"
                        rows="2"
                        placeholder="Mô tả tùy chọn..."
                        value={newBackend.description}
                        onChange={(e) =>
                          setNewBackend({
                            ...newBackend,
                            description: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="form-check form-switch">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={newBackend.enabled}
                        onChange={(e) =>
                          setNewBackend({
                            ...newBackend,
                            enabled: e.target.checked,
                          })
                        }
                      />
                      <label className="form-check-label">
                        Kích hoạt bãi đỗ xe
                      </label>
                    </div>
                  </div>
                  <div className="modal-footer border-secondary">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={onCloseManageBackends}
                    >
                      Hủy
                    </button>
                    <button type="submit" className="btn btn-primary">
                      <i className="bi bi-plus-circle me-2"></i>Thêm bãi đỗ xe
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
          <div
            className="modal-backdrop fade show"
            onClick={onCloseManageBackends}
          ></div>
        </>
      )}

      {/* Locker Detail Modal */}
      {showLockerModal && selectedLocker && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-lg modal-dialog-centered">
              <div className="modal-content bg-dark text-white border-secondary">
                <div className="modal-header border-secondary">
                  <h5 className="modal-title">
                    <i className="bi bi-lock me-2"></i>Tủ khóa{" "}
                    {selectedLocker.lock_id}
                  </h5>
                  <button
                    type="button"
                    className="btn-close btn-close-white"
                    onClick={() => {
                      setShowLockerModal(false);
                      setSelectedLocker(null);
                      setConfigLocker(null);
                    }}
                  ></button>
                </div>
                <div className="modal-body">
                  <div className="row g-3 mb-3">
                    <div className="col-6">
                      <strong>Bãi đỗ xe:</strong>{" "}
                      <span className="badge bg-info">
                        {selectedLocker.backend_name}
                      </span>
                    </div>
                    <div className="col-6">
                      <strong>Thiết bị:</strong> {selectedLocker.device_id}
                    </div>
                    <div className="col-6">
                      <strong>Tên:</strong> {selectedLocker.name || "-"}
                    </div>
                    <div className="col-6">
                      <strong>Trạng thái:</strong>{" "}
                      <span
                        className={`badge ${
                          selectedLocker.status === "UP"
                            ? "bg-success"
                            : "bg-warning"
                        }`}
                      >
                        {selectedLocker.status}
                      </span>
                    </div>
                    <div className="col-6">
                      <strong>Chế độ:</strong>{" "}
                      <span className="badge bg-info">
                        {selectedLocker.mode}
                      </span>
                    </div>
                    <div className="col-6">
                      <strong>Đã sử dụng:</strong>{" "}
                      {selectedLocker.occupied ? (
                        <span className="badge bg-danger">Có</span>
                      ) : (
                        <span className="badge bg-secondary">Không</span>
                      )}
                    </div>
                    {Boolean(selectedLocker.occupied) &&
                      selectedLocker.last_action_time && (
                        <>
                          <div className="col-6">
                            <strong>Thời gian:</strong>{" "}
                            <div className="fw-bold">
                              {formatTime(selectedLocker.last_action_time)}
                            </div>
                            {selectedLocker.payment_expire_time && (
                              <div className="text-muted small">
                                Còn lại:{" "}
                                {(() => {
                                  const expireTime = new Date(
                                    selectedLocker.payment_expire_time
                                  );
                                  const now = new Date();
                                  const remaining = Math.floor(
                                    (expireTime - now) / 60000
                                  );
                                  if (remaining <= 0) {
                                    return (
                                      <span className="text-danger">
                                        Hết hạn
                                      </span>
                                    );
                                  }
                                  const hours = Math.floor(remaining / 60);
                                  const mins = remaining % 60;
                                  return `${hours}h ${mins}m`;
                                })()}
                              </div>
                            )}
                          </div>
                          <div className="col-6">
                            <strong>Giá tiền:</strong>{" "}
                            <div className="fw-bold text-success">
                              {selectedLocker.occupied
                                ? formatPrice(selectedLocker.parking_fee)
                                : "-"}
                            </div>
                          </div>
                        </>
                      )}
                    {selectedLocker.last_action_time && (
                      <div className="col-12">
                        <strong>Hành động cuối:</strong>{" "}
                        {new Date(
                          selectedLocker.last_action_time
                        ).toLocaleString("vi-VN", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {selectedLocker.last_action && (
                          <div className="text-muted small">
                            {selectedLocker.last_action}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <hr className="border-secondary" />

                  {/* Control Buttons */}
                  <div className="mb-3">
                    <h6 className="mb-2">Điều khiển</h6>
                    <div className="btn-group w-100" role="group">
                      <button
                        className="btn btn-outline-success"
                        onClick={() =>
                          handleControlLocker(
                            selectedLocker.backend_id,
                            selectedLocker.lock_id,
                            "open"
                          )
                        }
                        disabled={controllingLocker === selectedLocker.lock_id}
                        title="Mở (nâng khóa)"
                      >
                        <i className="bi bi-unlock me-2"></i>Mở
                      </button>
                      <button
                        className="btn btn-outline-danger"
                        onClick={() =>
                          handleControlLocker(
                            selectedLocker.backend_id,
                            selectedLocker.lock_id,
                            "close"
                          )
                        }
                        disabled={controllingLocker === selectedLocker.lock_id}
                        title="Đóng (hạ khóa)"
                      >
                        <i className="bi bi-lock me-2"></i>Đóng
                      </button>
                      <button
                        className="btn btn-outline-warning"
                        onClick={() =>
                          handleControlLocker(
                            selectedLocker.backend_id,
                            selectedLocker.lock_id,
                            "stop"
                          )
                        }
                        disabled={controllingLocker === selectedLocker.lock_id}
                        title="Dừng ngay lập tức"
                      >
                        <i className="bi bi-stop-circle me-2"></i>Dừng
                      </button>
                      <button
                        className="btn btn-outline-info"
                        onClick={() =>
                          handleControlLocker(
                            selectedLocker.backend_id,
                            selectedLocker.lock_id,
                            "normal"
                          )
                        }
                        disabled={controllingLocker === selectedLocker.lock_id}
                        title="Bình thường (chế độ tự động)"
                      >
                        <i className="bi bi-arrow-repeat me-2"></i>Bình thường
                      </button>
                    </div>
                  </div>

                  {/* Configuration */}
                  <div>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <h6 className="mb-0">Cấu hình</h6>
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => {
                          if (configLocker === selectedLocker.lock_id) {
                            setConfigLocker(null);
                          } else {
                            setConfigLocker(selectedLocker.lock_id);
                            setConfigData({
                              upProtect: selectedLocker.up_protect || "",
                              downProtect: selectedLocker.down_protect || "",
                              freeTime: selectedLocker.lock_free_time || "",
                              warningTime:
                                selectedLocker.lock_warning_time || "",
                              hourlyRate: selectedLocker.hourly_rate || "",
                            });
                          }
                        }}
                      >
                        <i className="bi bi-gear me-2"></i>
                        {configLocker === selectedLocker.lock_id
                          ? "Ẩn"
                          : "Hiển thị"}
                      </button>
                    </div>

                    {configLocker === selectedLocker.lock_id && (
                      <div className="card bg-black border-secondary p-3">
                        <div className="row g-2">
                          <div className="col-6">
                            <input
                              type="number"
                              className="form-control form-control-sm"
                              placeholder="Bảo vệ trên (20-95)"
                              value={configData.upProtect}
                              onChange={(e) =>
                                setConfigData({
                                  ...configData,
                                  upProtect: e.target.value,
                                })
                              }
                              min="20"
                              max="95"
                            />
                          </div>
                          <div className="col-6">
                            <input
                              type="number"
                              className="form-control form-control-sm"
                              placeholder="Bảo vệ dưới (20-95)"
                              value={configData.downProtect}
                              onChange={(e) =>
                                setConfigData({
                                  ...configData,
                                  downProtect: e.target.value,
                                })
                              }
                              min="20"
                              max="95"
                            />
                          </div>
                          <div className="col-12">
                            <button
                              className="btn btn-sm btn-outline-primary w-100"
                              onClick={() =>
                                handleSetAttribute(
                                  selectedLocker.backend_id,
                                  selectedLocker.lock_id
                                )
                              }
                            >
                              Thiết lập bảo vệ
                            </button>
                          </div>
                          <div className="col-6">
                            <input
                              type="number"
                              className="form-control form-control-sm"
                              placeholder="Thời gian miễn phí (phút)"
                              value={configData.freeTime}
                              onChange={(e) =>
                                setConfigData({
                                  ...configData,
                                  freeTime: e.target.value,
                                })
                              }
                              min="0"
                            />
                          </div>
                          <div className="col-6">
                            <button
                              className="btn btn-sm btn-outline-primary w-100"
                              onClick={() =>
                                handleSetFreeTime(
                                  selectedLocker.backend_id,
                                  selectedLocker.lock_id
                                )
                              }
                            >
                              Thiết lập thời gian miễn phí
                            </button>
                          </div>
                          <div className="col-6">
                            <input
                              type="number"
                              className="form-control form-control-sm"
                              placeholder="Thời gian cảnh báo (giây)"
                              value={configData.warningTime}
                              onChange={(e) =>
                                setConfigData({
                                  ...configData,
                                  warningTime: e.target.value,
                                })
                              }
                              min="0"
                            />
                          </div>
                          <div className="col-6">
                            <button
                              className="btn btn-sm btn-outline-primary w-100"
                              onClick={() =>
                                handleSetWarningTime(
                                  selectedLocker.backend_id,
                                  selectedLocker.lock_id
                                )
                              }
                            >
                              Thiết lập cảnh báo
                            </button>
                          </div>
                          <div className="col-6">
                            <input
                              type="number"
                              className="form-control form-control-sm"
                              placeholder="Giá mỗi giờ (VNĐ)"
                              value={configData.hourlyRate}
                              onChange={(e) =>
                                setConfigData({
                                  ...configData,
                                  hourlyRate: e.target.value,
                                })
                              }
                              min="0"
                              step="1000"
                            />
                          </div>
                          <div className="col-6">
                            <button
                              className="btn btn-sm btn-outline-primary w-100"
                              onClick={() =>
                                handleSetHourlyRate(
                                  selectedLocker.backend_id,
                                  selectedLocker.lock_id
                                )
                              }
                            >
                              Thiết lập giá
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="modal-footer border-secondary">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowLockerModal(false);
                      setSelectedLocker(null);
                      setConfigLocker(null);
                    }}
                  >
                    Đóng
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div
            className="modal-backdrop fade show"
            onClick={() => {
              setShowLockerModal(false);
              setSelectedLocker(null);
              setConfigLocker(null);
            }}
          ></div>
        </>
      )}

      {/* Backend Detail Modal */}
      {showBackendDetail && selectedBackend && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-lg modal-dialog-centered">
              <div className="modal-content bg-dark text-white border-secondary">
                <div className="modal-header border-secondary">
                  <h5 className="modal-title">
                    <i className="bi bi-hdd-network me-2"></i>
                    {selectedBackend.name}
                  </h5>
                  <button
                    type="button"
                    className="btn-close btn-close-white"
                    onClick={() => setShowBackendDetail(false)}
                  ></button>
                </div>
                <div className="modal-body">
                  <div className="row g-3">
                    <div className="col-12">
                      <div className="card bg-black border-secondary">
                        <div className="card-body">
                          <h6 className="text-secondary mb-3">
                            Thông tin Bãi đỗ xe
                          </h6>
                          <table className="table table-dark table-borderless mb-0">
                            <tbody>
                              <tr>
                                <td
                                  className="text-secondary"
                                  style={{ width: "30%" }}
                                >
                                  ID:
                                </td>
                                <td className="font-monospace">
                                  {selectedBackend.id}
                                </td>
                              </tr>
                              <tr>
                                <td className="text-secondary">Tên:</td>
                                <td>{selectedBackend.name}</td>
                              </tr>
                              <tr>
                                <td className="text-secondary">Máy chủ:</td>
                                <td>{selectedBackend.host}</td>
                              </tr>
                              <tr>
                                <td className="text-secondary">Cổng:</td>
                                <td>{selectedBackend.port}</td>
                              </tr>
                              <tr>
                                <td className="text-secondary">URL:</td>
                                <td>
                                  <a
                                    href={`http://${selectedBackend.host}:${selectedBackend.port}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary"
                                  >
                                    http://{selectedBackend.host}:
                                    {selectedBackend.port}
                                    <i className="bi bi-box-arrow-up-right ms-2"></i>
                                  </a>
                                </td>
                              </tr>
                              {selectedBackend.description && (
                                <tr>
                                  <td className="text-secondary">Mô tả:</td>
                                  <td>{selectedBackend.description}</td>
                                </tr>
                              )}
                              <tr>
                                <td className="text-secondary">Trạng thái:</td>
                                <td>
                                  <span
                                    className={`badge ${
                                      selectedBackend.enabled
                                        ? "bg-success"
                                        : "bg-secondary"
                                    }`}
                                  >
                                    {selectedBackend.enabled
                                      ? "Đã kích hoạt"
                                      : "Đã vô hiệu hóa"}
                                  </span>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    <div className="col-12">
                      <div className="card bg-black border-secondary">
                        <div className="card-body">
                          <h6 className="text-secondary mb-3">Hành động</h6>
                          <div className="d-flex gap-2">
                            <button
                              className={`btn ${
                                selectedBackend.enabled
                                  ? "btn-warning"
                                  : "btn-success"
                              }`}
                              onClick={() => {
                                handleToggleBackend(selectedBackend);
                                setShowBackendDetail(false);
                              }}
                            >
                              <i
                                className={`bi ${
                                  selectedBackend.enabled
                                    ? "bi-pause-circle"
                                    : "bi-play-circle"
                                } me-2`}
                              ></i>
                              {selectedBackend.enabled
                                ? "Vô hiệu hóa"
                                : "Kích hoạt"}{" "}
                              Bãi đỗ xe
                            </button>
                            <button
                              className="btn btn-danger"
                              onClick={() => {
                                handleDeleteBackend(selectedBackend.id);
                                setShowBackendDetail(false);
                              }}
                            >
                              <i className="bi bi-trash me-2"></i>Xóa Bãi đỗ xe
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="modal-footer border-secondary">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowBackendDetail(false)}
                  >
                    Đóng
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div
            className="modal-backdrop fade show"
            onClick={() => setShowBackendDetail(false)}
          ></div>
        </>
      )}
    </div>
  );
};

export default ParkingOverview;
