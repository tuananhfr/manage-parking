import { useEffect, useState } from "react";
import paymentApi from "../services/paymentApi";
import deviceApi from "../services/deviceApi";
import lockerApi from "../services/lockerApi";
import dayjs from "dayjs";

interface Filters {
  device_id: string;
  lock_id: string;
  status: string;
  ticket_type: string;
  start_date: string;
  end_date: string;
  search: string;
  limit: number;
  offset: number;
}

type ViewType = "orders" | "sessions";

export default function PaymentHistory() {
  const [viewType, setViewType] = useState<ViewType>("sessions"); // Default to sessions
  const [loading, setLoading] = useState(true);
  const [paymentHistory, setPaymentHistory] =
    useState<PaymentHistoryResult | null>(null);
  const [parkingSessions, setParkingSessions] =
    useState<ParkingSessionsResult | null>(null);
  const [statistics, setStatistics] = useState<OverallStatistics | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [lockers, setLockers] = useState<Locker[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false); // Control accordion state

  const [filters, setFilters] = useState<Filters>({
    device_id: "",
    lock_id: "",
    status: "",
    ticket_type: "",
    start_date: "",
    end_date: "",
    search: "",
    limit: 50,
    offset: 0,
  });

  // Load devices and lockers for filter
  useEffect(() => {
    const loadDevicesAndLockers = async () => {
      try {
        const [devicesRes, lockersRes] = await Promise.all([
          deviceApi.getDevices(),
          lockerApi.getLockers({ connected: true, limit: 1000 }),
        ]);

        if (devicesRes.success) {
          setDevices(devicesRes.data);
        }

        if (lockersRes.success) {
          setLockers(lockersRes.data);
        }
      } catch (error) {
        console.error("Failed to load devices/lockers:", error);
      }
    };

    loadDevicesAndLockers();
  }, []);

  // Load payment history or parking sessions based on view type
  useEffect(() => {
    if (viewType === "orders") {
      loadPaymentHistory();
    } else {
      loadParkingSessions();
    }
  }, [filters, viewType]);

  // Load overall statistics based on viewType
  useEffect(() => {
    loadStatistics();
  }, [
    viewType,
    filters.start_date,
    filters.end_date,
    filters.device_id,
    filters.lock_id,
    filters.ticket_type,
    filters.status,
  ]);

  const loadPaymentHistory = async () => {
    try {
      setLoading(true);
      const res = await paymentApi.getPaymentHistory({
        device_id: filters.device_id || undefined,
        lock_id: filters.lock_id || undefined,
        status: filters.status || undefined,
        start_date: filters.start_date || undefined,
        end_date: filters.end_date || undefined,
        search: filters.search || undefined,
        limit: filters.limit,
        offset: filters.offset,
      });

      if (res.success) {
        setPaymentHistory({
          orders: res.data || [],
          total: res.total || 0,
          summary: res.summary || {
            total_orders: 0,
            paid_orders: 0,
            pending_orders: 0,
            total_revenue: 0,
          },
          pagination: res.pagination || {
            limit: filters.limit,
            offset: filters.offset,
            has_more: false,
          },
        });
      }
    } catch (error) {
      console.error("Failed to load payment history:", error);
      setPaymentHistory({
        orders: [],
        total: 0,
        summary: {
          total_orders: 0,
          paid_orders: 0,
          pending_orders: 0,
          total_revenue: 0,
        },
        pagination: {
          limit: filters.limit,
          offset: filters.offset,
          has_more: false,
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const loadParkingSessions = async () => {
    try {
      setLoading(true);
      const res = await paymentApi.getParkingSessions({
        device_id: filters.device_id || undefined,
        lock_id: filters.lock_id || undefined,
        ticket_type:
          filters.ticket_type === "single" || filters.ticket_type === "monthly"
            ? (filters.ticket_type as "single" | "monthly")
            : undefined,
        status:
          filters.status === "in_progress" || filters.status === "completed"
            ? (filters.status as "in_progress" | "completed")
            : undefined,
        start_date: filters.start_date || undefined,
        end_date: filters.end_date || undefined,
        limit: filters.limit,
        offset: filters.offset,
      });

      if (res.success) {
        setParkingSessions({
          sessions: res.data || [],
          total: res.total || 0,
          pagination: res.pagination || {
            limit: filters.limit,
            offset: filters.offset,
            has_more: false,
          },
        });
      }
    } catch (error) {
      console.error("Failed to load parking sessions:", error);
      setParkingSessions({
        sessions: [],
        total: 0,
        pagination: {
          limit: filters.limit,
          offset: filters.offset,
          has_more: false,
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const loadStatistics = async () => {
    try {
      if (viewType === "orders") {
        // Load payment order statistics
        const res = await paymentApi.getOverallStatistics({
          start_date: filters.start_date || undefined,
          end_date: filters.end_date || undefined,
        });

        if (res.success) {
          setStatistics(res.data);
        }
      } else {
        // Load parking session statistics
        const res = await paymentApi.getParkingSessionStatistics({
          device_id: filters.device_id || undefined,
          lock_id: filters.lock_id || undefined,
          ticket_type:
            filters.ticket_type === "single" ||
            filters.ticket_type === "monthly"
              ? (filters.ticket_type as "single" | "monthly")
              : undefined,
          start_date: filters.start_date || undefined,
          end_date: filters.end_date || undefined,
        });

        if (res.success) {
          // Transform session statistics to match the display format
          setStatistics({
            total_orders: res.data.total_sessions || 0,
            paid_orders: res.data.completed_sessions || 0,
            pending_orders: res.data.in_progress_sessions || 0,
            total_revenue: res.data.total_revenue || 0,
            // Additional fields for sessions
            single_tickets: res.data.single_tickets || 0,
            monthly_tickets: res.data.monthly_tickets || 0,
          });
        }
      }
    } catch (error) {
      console.error("Failed to load statistics:", error);
    }
  };

  const handleFilterChange = (key: keyof Filters, value: string | number) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      // Reset offset when changing filters
      offset: key !== "offset" ? 0 : (value as number),
    }));
  };

  const handleClearFilters = () => {
    setFilters({
      device_id: "",
      lock_id: "",
      status: "",
      ticket_type: "",
      start_date: "",
      end_date: "",
      search: "",
      limit: 50,
      offset: 0,
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (viewType === "orders") {
      loadPaymentHistory();
    } else {
      loadParkingSessions();
    }
  };

  const handlePreviousPage = () => {
    const newOffset = Math.max(0, filters.offset - filters.limit);
    handleFilterChange("offset", newOffset);
  };

  const handleNextPage = () => {
    if (viewType === "orders") {
      if (paymentHistory?.pagination.has_more) {
        const newOffset = filters.offset + filters.limit;
        handleFilterChange("offset", newOffset);
      }
    } else {
      if (parkingSessions?.pagination.has_more) {
        const newOffset = filters.offset + filters.limit;
        handleFilterChange("offset", newOffset);
      }
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
    }).format(amount);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    return dayjs(dateString).format("DD/MM/YYYY HH:mm:ss");
  };

  if (loading && !paymentHistory) {
    return (
      <div className="loading-container">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid py-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h3>
          <i className="bi bi-clock-history me-2"></i>
          Lịch sử thanh toán
        </h3>
      </div>

      {/* Statistics Cards */}
      {statistics && (
        <div className="row g-2 mb-3">
          <div className={viewType === "sessions" ? "col-md-2" : "col-md-3"}>
            <div className="card border-primary">
              <div className="card-body p-2">
                <div className="d-flex align-items-center">
                  <div className="flex-shrink-0">
                    <i className="bi bi-receipt fs-3 text-primary"></i>
                  </div>
                  <div className="flex-grow-1 ms-2">
                    <small className="text-muted d-block">
                      {viewType === "sessions"
                        ? "Tổng lượt đỗ"
                        : "Tổng đơn hàng"}
                    </small>
                    <h5 className="mb-0">{statistics.total_orders}</h5>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={viewType === "sessions" ? "col-md-2" : "col-md-3"}>
            <div className="card border-success">
              <div className="card-body p-2">
                <div className="d-flex align-items-center">
                  <div className="flex-shrink-0">
                    <i className="bi bi-check-circle fs-3 text-success"></i>
                  </div>
                  <div className="flex-grow-1 ms-2">
                    <small className="text-muted d-block">
                      {viewType === "sessions" ? "Hoàn thành" : "Đã thanh toán"}
                    </small>
                    <h5 className="mb-0">{statistics.paid_orders}</h5>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={viewType === "sessions" ? "col-md-2" : "col-md-3"}>
            <div className="card border-warning">
              <div className="card-body p-2">
                <div className="d-flex align-items-center">
                  <div className="flex-shrink-0">
                    <i className="bi bi-hourglass-split fs-3 text-warning"></i>
                  </div>
                  <div className="flex-grow-1 ms-2">
                    <small className="text-muted d-block">
                      {viewType === "sessions" ? "Đang đỗ" : "Chờ thanh toán"}
                    </small>
                    <h5 className="mb-0">{statistics.pending_orders}</h5>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {viewType === "sessions" &&
            statistics.single_tickets !== undefined && (
              <>
                <div className="col-md-2">
                  <div className="card border-secondary">
                    <div className="card-body p-2">
                      <div className="d-flex align-items-center">
                        <div className="flex-shrink-0">
                          <i className="bi bi-ticket-perforated fs-3 text-secondary"></i>
                        </div>
                        <div className="flex-grow-1 ms-2">
                          <small className="text-muted d-block">Vé lẻ</small>
                          <h5 className="mb-0">{statistics.single_tickets}</h5>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="col-md-2">
                  <div className="card border-secondary">
                    <div className="card-body p-2">
                      <div className="d-flex align-items-center">
                        <div className="flex-shrink-0">
                          <i className="bi bi-calendar-month fs-3 text-secondary"></i>
                        </div>
                        <div className="flex-grow-1 ms-2">
                          <small className="text-muted d-block">Vé tháng</small>
                          <h5 className="mb-0">{statistics.monthly_tickets}</h5>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

          <div className={viewType === "sessions" ? "col-md-2" : "col-md-3"}>
            <div className="card border-info">
              <div className="card-body p-2">
                <div className="d-flex align-items-center">
                  <div className="flex-shrink-0">
                    <i className="bi bi-currency-exchange fs-3 text-info"></i>
                  </div>
                  <div className="flex-grow-1 ms-2">
                    <small className="text-muted d-block">Tổng doanh thu</small>
                    <h6 className="mb-0">
                      {formatCurrency(statistics.total_revenue || 0)}
                    </h6>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="accordion mb-3" id="filtersAccordion">
        <div className="accordion-item">
          <h2 className="accordion-header" id="filtersHeading">
            <button
              className={`accordion-button ${filtersOpen ? "" : "collapsed"}`}
              type="button"
              onClick={() => setFiltersOpen(!filtersOpen)}
              aria-expanded={filtersOpen}
              aria-controls="filtersCollapse"
            >
              <i className="bi bi-funnel me-2"></i>
              Bộ lọc
            </button>
          </h2>
          <div
            id="filtersCollapse"
            className={`accordion-collapse collapse ${
              filtersOpen ? "show" : ""
            }`}
            aria-labelledby="filtersHeading"
            data-bs-parent="#filtersAccordion"
          >
            <div className="accordion-body">
              <form onSubmit={handleSearch}>
                <div className="row g-3">
                  {/* Device Filter */}
                  <div className="col-md-3">
                    <label className="form-label">Thiết bị</label>
                    <select
                      className="form-select"
                      value={filters.device_id}
                      onChange={(e) => {
                        handleFilterChange("device_id", e.target.value);
                        handleFilterChange("lock_id", ""); // Reset locker when device changes
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                        }
                      }}
                    >
                      <option value="">Tất cả thiết bị</option>
                      {devices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.name || device.id}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Locker Filter */}
                  <div className="col-md-3">
                    <label className="form-label">Ô đỗ xe</label>
                    <select
                      className="form-select"
                      value={filters.lock_id}
                      onChange={(e) =>
                        handleFilterChange("lock_id", e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                        }
                      }}
                    >
                      <option value="">Tất cả ô đỗ</option>
                      {lockers
                        .filter((locker) =>
                          filters.device_id
                            ? locker.device_id === filters.device_id
                            : true
                        )
                        .map((locker) => (
                          <option key={locker.lock_id} value={locker.lock_id}>
                            {locker.name || locker.lock_id}
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Ticket Type Filter - Only for sessions */}
                  {viewType === "sessions" && (
                    <div className="col-md-2">
                      <label className="form-label">Loại vé</label>
                      <select
                        className="form-select"
                        value={filters.ticket_type}
                        onChange={(e) =>
                          handleFilterChange("ticket_type", e.target.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                          }
                        }}
                      >
                        <option value="">Tất cả</option>
                        <option value="single">Vé lẻ</option>
                        <option value="monthly">Vé tháng</option>
                      </select>
                    </div>
                  )}

                  {/* Status Filter */}
                  <div className="col-md-2">
                    <label className="form-label">Trạng thái</label>
                    <select
                      className="form-select"
                      value={filters.status}
                      onChange={(e) =>
                        handleFilterChange("status", e.target.value)
                      }
                    >
                      <option value="">Tất cả</option>
                      {viewType === "sessions" ? (
                        <>
                          <option value="completed">Hoàn thành</option>
                          <option value="in_progress">Đang đỗ</option>
                        </>
                      ) : (
                        <>
                          <option value="paid">Đã thanh toán</option>
                          <option value="pending">Chờ thanh toán</option>
                        </>
                      )}
                    </select>
                  </div>

                  {/* Start Date */}
                  <div className="col-md-2">
                    <label className="form-label">Từ ngày</label>
                    <input
                      type="date"
                      className="form-control"
                      value={filters.start_date}
                      onChange={(e) =>
                        handleFilterChange("start_date", e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                        }
                      }}
                    />
                  </div>

                  {/* End Date */}
                  <div className="col-md-2">
                    <label className="form-label">Đến ngày</label>
                    <input
                      type="date"
                      className="form-control"
                      value={filters.end_date}
                      onChange={(e) =>
                        handleFilterChange("end_date", e.target.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                        }
                      }}
                    />
                  </div>

                  {/* Search */}
                  <div className="col-md-6">
                    <label className="form-label">Tìm kiếm</label>
                    <div className="input-group">
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Mã đơn hàng, mã giao dịch, mô tả..."
                        value={filters.search}
                        onChange={(e) =>
                          handleFilterChange("search", e.target.value)
                        }
                      />
                      <button className="btn btn-primary" type="submit">
                        <i className="bi bi-search me-2"></i>
                        Tìm kiếm
                      </button>
                    </div>
                  </div>

                  {/* Limit */}
                  <div className="col-md-2">
                    <label className="form-label">Số bản ghi</label>
                    <select
                      className="form-select"
                      value={filters.limit}
                      onChange={(e) =>
                        handleFilterChange("limit", parseInt(e.target.value))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                        }
                      }}
                    >
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                      <option value={500}>500</option>
                    </select>
                  </div>

                  {/* Clear Filters */}
                  <div className="col-md-4 d-flex align-items-end">
                    <button
                      type="button"
                      className="btn btn-outline-secondary w-100"
                      onClick={handleClearFilters}
                    >
                      <i className="bi bi-x-circle me-2"></i>
                      Xóa bộ lọc
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Table - Payment Orders or Parking Sessions */}
      <div className="card">
        <div className="card-header bg-primary text-white">
          <div className="d-flex justify-content-between align-items-center">
            <span>
              <i className="bi bi-list-ul me-2"></i>
              {viewType === "sessions"
                ? "Danh sách lịch sử đỗ xe"
                : "Danh sách đơn hàng thanh toán"}
            </span>
            <span className="badge bg-light text-dark">
              Tổng:{" "}
              {viewType === "sessions"
                ? parkingSessions?.total || 0
                : paymentHistory?.total || 0}{" "}
              {viewType === "sessions" ? "phiên đỗ xe" : "giao dịch"}
            </span>
          </div>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead className="table-light">
                {viewType === "sessions" ? (
                  <tr>
                    <th style={{ width: "3%" }}>#</th>
                    <th style={{ width: "8%" }}>Loại vé</th>
                    <th style={{ width: "8%" }}>Biển số</th>
                    <th style={{ width: "8%" }}>Ô đỗ</th>
                    <th style={{ width: "10%" }}>Thiết bị</th>
                    <th style={{ width: "10%" }}>Thời gian vào</th>
                    <th style={{ width: "10%" }}>Thời gian thanh toán</th>
                    <th style={{ width: "10%" }}>Thời gian ra</th>
                    <th style={{ width: "8%" }}>Đỗ (phút)</th>
                    <th style={{ width: "10%" }}>Thời gian tính tiền</th>
                    <th style={{ width: "8%" }}>Số tiền</th>
                    <th style={{ width: "8%" }}>Trạng thái</th>
                    <th style={{ width: "10%" }}>Mã đơn</th>
                  </tr>
                ) : (
                  <tr>
                    <th style={{ width: "3%" }}>#</th>
                    <th style={{ width: "10%" }}>Mã đơn hàng</th>
                    <th style={{ width: "8%" }}>Ô đỗ</th>
                    <th style={{ width: "10%" }}>Thiết bị</th>
                    <th style={{ width: "10%" }}>Thời gian vào</th>
                    <th style={{ width: "8%" }}>Đỗ (phút)</th>
                    <th style={{ width: "8%" }}>Tính (phút)</th>
                    <th style={{ width: "8%" }}>Số tiền</th>
                    <th style={{ width: "8%" }}>Trạng thái</th>
                    <th style={{ width: "10%" }}>Mã GD</th>
                    <th style={{ width: "10%" }}>Thời gian ra</th>
                    <th style={{ width: "9%" }}>Ghi chú</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {viewType === "sessions" ? (
                  !parkingSessions ||
                  !parkingSessions.sessions ||
                  parkingSessions.sessions.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="text-center text-muted py-4">
                        Không có dữ liệu
                      </td>
                    </tr>
                  ) : (
                    parkingSessions.sessions.map((session, index) => {
                      const formatDuration = (minutes: number | null) => {
                        if (minutes === null || minutes === undefined)
                          return "-";
                        const hours = Math.floor(minutes / 60);
                        const mins = minutes % 60;
                        if (hours > 0) {
                          return `${hours}h ${mins}m`;
                        }
                        return `${mins}m`;
                      };

                      return (
                        <tr key={session.id}>
                          <td>{filters.offset + index + 1}</td>
                          <td>
                            <span
                              className={`badge ${
                                session.ticket_type === "monthly"
                                  ? "bg-info"
                                  : session.ticket_type === "single"
                                  ? "bg-secondary"
                                  : "bg-warning text-dark"
                              }`}
                            >
                              {session.ticket_type === "monthly"
                                ? "Vé tháng"
                                : session.ticket_type === "single"
                                ? "Vé lẻ"
                                : "Chưa xác định"}
                            </span>
                          </td>
                          <td>
                            {session.license_plate ? (
                              <code className="text-primary">
                                {session.license_plate}
                              </code>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td>
                            <span className="badge bg-secondary">
                              {session.lock_id}
                            </span>
                          </td>
                          <td>
                            <span className="badge bg-info">
                              {session.device_id}
                            </span>
                          </td>
                          <td>
                            <small className="text-success">
                              <i className="bi bi-arrow-down-circle me-1"></i>
                              {formatDate(session.car_enter_time)}
                            </small>
                          </td>
                          <td>
                            {session.payment_time ? (
                              <small className="text-warning">
                                <i className="bi bi-credit-card me-1"></i>
                                {formatDate(session.payment_time)}
                              </small>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td>
                            {session.car_exit_time ? (
                              <small className="text-danger">
                                <i className="bi bi-arrow-up-circle me-1"></i>
                                {formatDate(session.car_exit_time)}
                              </small>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td>
                            {session.parking_duration !== null &&
                            session.parking_duration !== undefined ? (
                              <span className="badge bg-primary">
                                {formatDuration(session.parking_duration)}
                              </span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td>
                            {session.billing_duration !== null &&
                            session.billing_duration !== undefined ? (
                              <span className="badge bg-warning text-dark">
                                {formatDuration(session.billing_duration)}
                              </span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td>
                            {session.amount !== null &&
                            session.amount !== undefined ? (
                              <strong
                                className={
                                  session.amount > 0
                                    ? "text-success"
                                    : "text-muted"
                                }
                              >
                                {formatCurrency(session.amount)}
                              </strong>
                            ) : (
                              <strong className="text-muted">0đ</strong>
                            )}
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                session.status === "completed"
                                  ? "bg-success"
                                  : "bg-warning"
                              }`}
                            >
                              {session.status === "completed" ? (
                                <>
                                  <i className="bi bi-check-circle me-1"></i>
                                  Hoàn thành
                                </>
                              ) : (
                                <>
                                  <i className="bi bi-clock me-1"></i>
                                  Đang đỗ
                                </>
                              )}
                            </span>
                          </td>
                          <td>
                            {session.payment_order_id ? (
                              <code className="text-muted font-monospace small">
                                {session.payment_order_id}
                              </code>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )
                ) : !paymentHistory ||
                  !paymentHistory.orders ||
                  paymentHistory.orders.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="text-center text-muted py-4">
                      Không có dữ liệu
                    </td>
                  </tr>
                ) : (
                  paymentHistory.orders.map((order, index) => {
                    const formatDuration = (minutes: number | null) => {
                      if (minutes === null || minutes === undefined) return "-";
                      const hours = Math.floor(minutes / 60);
                      const mins = minutes % 60;
                      if (hours > 0) {
                        return `${hours}h ${mins}m`;
                      }
                      return `${mins}m`;
                    };

                    return (
                      <tr key={order.id}>
                        <td>{filters.offset + index + 1}</td>
                        <td>
                          <code className="text-primary">{order.order_id}</code>
                        </td>
                        <td>
                          <span className="badge bg-secondary">
                            {order.lock_id}
                          </span>
                        </td>
                        <td>
                          <span className="badge bg-info">
                            {order.device_id}
                          </span>
                        </td>
                        <td>
                          {order.car_enter_time ? (
                            <div>
                              <small className="text-success">
                                <i className="bi bi-arrow-down-circle me-1"></i>
                                {formatDate(order.car_enter_time)}
                              </small>
                            </div>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          {order.parking_duration !== null &&
                          order.parking_duration !== undefined ? (
                            <span className="badge bg-primary">
                              {formatDuration(order.parking_duration)}
                            </span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          {order.billing_duration !== null &&
                          order.billing_duration !== undefined ? (
                            <span className="badge bg-warning text-dark">
                              {formatDuration(order.billing_duration)}
                            </span>
                          ) : order.free_time_minutes !== null &&
                            order.free_time_minutes !== undefined ? (
                            <span className="text-muted small">
                              Miễn phí ({order.free_time_minutes}m)
                            </span>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          <strong className="text-success">
                            {formatCurrency(order.amount)}
                          </strong>
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              order.status === "paid"
                                ? "bg-success"
                                : "bg-warning"
                            }`}
                          >
                            {order.status === "paid" ? (
                              <>
                                <i className="bi bi-check-circle me-1"></i>
                                Đã thanh toán
                              </>
                            ) : (
                              <>
                                <i className="bi bi-hourglass-split me-1"></i>
                                Chờ thanh toán
                              </>
                            )}
                          </span>
                        </td>
                        <td>
                          {order.transaction_id ? (
                            <small className="text-muted font-monospace">
                              {order.transaction_id}
                            </small>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          {order.car_exit_time ? (
                            <div>
                              <small className="text-danger">
                                <i className="bi bi-arrow-up-circle me-1"></i>
                                {formatDate(order.car_exit_time)}
                              </small>
                            </div>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                        <td>
                          {order.description ? (
                            <button
                              className="btn btn-sm btn-outline-primary"
                              title={order.description}
                              data-bs-toggle="tooltip"
                              data-bs-placement="top"
                            >
                              <i className="bi bi-info-circle"></i>
                            </button>
                          ) : (
                            <span className="text-muted">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {((viewType === "sessions" &&
          parkingSessions &&
          parkingSessions.total > 0) ||
          (viewType === "orders" &&
            paymentHistory &&
            paymentHistory.total > 0)) && (
          <div className="card-footer">
            <div className="d-flex justify-content-between align-items-center">
              <div className="text-muted">
                Hiển thị {filters.offset + 1} -{" "}
                {Math.min(
                  filters.offset + filters.limit,
                  viewType === "sessions"
                    ? parkingSessions?.total || 0
                    : paymentHistory?.total || 0
                )}{" "}
                trong tổng số{" "}
                {viewType === "sessions"
                  ? parkingSessions?.total || 0
                  : paymentHistory?.total || 0}{" "}
                {viewType === "sessions" ? "phiên đỗ xe" : "giao dịch"}
              </div>
              <div className="btn-group">
                <button
                  className="btn btn-outline-primary"
                  onClick={handlePreviousPage}
                  disabled={filters.offset === 0}
                >
                  <i className="bi bi-chevron-left"></i>
                  Trước
                </button>
                <button
                  className="btn btn-outline-primary"
                  onClick={handleNextPage}
                  disabled={
                    viewType === "sessions"
                      ? !parkingSessions?.pagination.has_more
                      : !paymentHistory?.pagination.has_more
                  }
                >
                  Sau
                  <i className="bi bi-chevron-right"></i>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Summary from current page - Only show for orders */}
      {viewType === "orders" && paymentHistory && paymentHistory.summary && (
        <div className="card mt-4">
          <div className="card-header bg-light">
            <i className="bi bi-calculator me-2"></i>
            Tổng kết (theo bộ lọc hiện tại)
          </div>
          <div className="card-body">
            <div className="row">
              <div className="col-md-3">
                <div className="text-center">
                  <h6 className="text-muted">Tổng đơn hàng</h6>
                  <h4>{paymentHistory.summary.total_orders}</h4>
                </div>
              </div>
              <div className="col-md-3">
                <div className="text-center">
                  <h6 className="text-muted">Đã thanh toán</h6>
                  <h4 className="text-success">
                    {paymentHistory.summary.paid_orders}
                  </h4>
                </div>
              </div>
              <div className="col-md-3">
                <div className="text-center">
                  <h6 className="text-muted">Chờ thanh toán</h6>
                  <h4 className="text-warning">
                    {paymentHistory.summary.pending_orders}
                  </h4>
                </div>
              </div>
              <div className="col-md-3">
                <div className="text-center">
                  <h6 className="text-muted">Tổng doanh thu</h6>
                  <h4 className="text-info">
                    {formatCurrency(paymentHistory.summary.total_revenue)}
                  </h4>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
