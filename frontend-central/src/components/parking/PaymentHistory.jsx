import { useState, useEffect, useCallback } from "react";
import { parkingBackendApi } from "../../services/parkingBackendApi";
import dayjs from "dayjs";

export default function PaymentHistory() {
  const [viewType, setViewType] = useState("sessions"); // "sessions" | "orders"
  const [loading, setLoading] = useState(true);
  
  // Data
  const [historyData, setHistoryData] = useState([]);
  const [stats, setStats] = useState(null);
  const [backends, setBackends] = useState([]);
  
  // Filters
  const [filters, setFilters] = useState({
    backend_id: "",
    device_id: "",
    lock_id: "",
    status: "",
    ticket_type: "",
    start_date: "",
    end_date: "",
    limit: 50,
  });

  useEffect(() => {
    loadBackends();
    loadStats();
  }, []);

  useEffect(() => {
    loadData();
  }, [viewType, filters, loadData]);

  const loadBackends = async () => {
    try {
        const data = await parkingBackendApi.getBackends();
        setBackends(data);
    } catch (error) {
        console.error("Failed to load backends", error);
    }
  }

  const loadStats = async () => {
      try {
          const res = await parkingBackendApi.getPaymentStats({});
          setStats(res.data);
      } catch (error) {
          console.error("Failed to load stats", error);
      }
  }

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const params = { limit: filters.limit };
      if (filters.backend_id) params.backend_id = filters.backend_id;
      if (filters.device_id) params.device_id = filters.device_id;
      if (filters.lock_id) params.lock_id = filters.lock_id;
      if (filters.status) params.status = filters.status;
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;
      
      if (viewType === "sessions") {
          if (filters.ticket_type) params.ticket_type = filters.ticket_type;
          const res = await parkingBackendApi.getParkingSessions(params);
          setHistoryData(res.data);
      } else {
          const res = await parkingBackendApi.getPaymentHistory(params);
          setHistoryData(res.data);
      }
    } catch (error) {
      console.error("Failed to load payment history:", error);
    } finally {
      setLoading(false);
    }
  }, [filters, viewType]);

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div>
      {/* Stats Cards */}
      {/* Stats Cards */}
      {stats && (
        <div className="row g-3 mb-4">
          <div className="col-md-3">
            <div className="card text-white bg-primary h-100 border-secondary">
              <div className="card-body">
                <h6 className="card-title text-uppercase opacity-75 small">Tổng Doanh Thu</h6>
                <h3 className="card-text fw-bold">
                  {stats.total_revenue?.toLocaleString('vi-VN')} đ
                </h3>
              </div>
            </div>
          </div>
          <div className="col-md-3">
            <div className="card text-white bg-dark h-100 border-secondary border-start border-4 border-success">
              <div className="card-body">
                <h6 className="card-title text-uppercase opacity-75 small">Lượt xe hoàn thành</h6>
                 <h3 className="card-text fw-bold text-success">
                  {stats.completed_sessions}
                </h3>
              </div>
            </div>
          </div>
           <div className="col-md-3">
            <div className="card text-white bg-dark h-100 border-secondary border-start border-4 border-warning">
              <div className="card-body">
                <h6 className="card-title text-uppercase opacity-75 small">Xe đang đỗ</h6>
                 <h3 className="card-text fw-bold text-warning">
                  {stats.in_progress_sessions}
                </h3>
              </div>
            </div>
          </div>
          <div className="col-md-3">
             <div className="card text-white bg-dark h-100 border-secondary border-start border-4 border-info">
              <div className="card-body">
                <h6 className="card-title text-uppercase opacity-75 small">Vé tháng / Vé lượt</h6>
                 <h5 className="card-text">
                  {stats.monthly_tickets} / {stats.single_tickets}
                </h5>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4>
          <i className="bi bi-wallet2 me-2"></i>
          Lịch sử Thanh toán
        </h4>
        <div className="btn-group">
            <button 
                className={`btn btn-sm ${viewType === 'sessions' ? 'btn-primary' : 'btn-outline-primary'}`}
                onClick={() => setViewType('sessions')}
            >
                Phiên đỗ xe
            </button>
            <button 
                className={`btn btn-sm ${viewType === 'orders' ? 'btn-primary' : 'btn-outline-primary'}`}
                onClick={() => setViewType('orders')}
            >
                Đơn hàng
            </button>
        </div>
      </div>

      {/* Filters */}
      <div className="accordion mb-4 shadow-sm" id="accordionFilterPayment">
        <div className="accordion-item bg-dark border-secondary">
          <h2 className="accordion-header" id="headingFilterPayment">
            <button
              className="accordion-button collapsed bg-secondary text-white"
              type="button"
              data-bs-toggle="collapse"
              data-bs-target="#collapseFilterPayment"
              aria-expanded="false"
              aria-controls="collapseFilterPayment"
            >
              <i className="bi bi-funnel me-2"></i>
              Bộ lọc
            </button>
          </h2>
          <div
            id="collapseFilterPayment"
            className="accordion-collapse collapse"
            aria-labelledby="headingFilterPayment"
            data-bs-parent="#accordionFilterPayment"
          >
            <div className="accordion-body">
              <div className="row g-2">
                <div className="col-md-2">
                  <select
                    className="form-select form-select-sm bg-dark text-white border-secondary"
                    value={filters.backend_id}
                    onChange={(e) =>
                      handleFilterChange("backend_id", e.target.value)
                    }
                  >
                    <option value="">Tất cả Bãi</option>
                    {backends.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-2">
                  <input
                    className="form-control form-control-sm bg-dark text-white border-secondary"
                    placeholder="Device ID"
                    value={filters.device_id}
                    onChange={(e) =>
                      handleFilterChange("device_id", e.target.value)
                    }
                  />
                </div>
                {viewType === "sessions" && (
                  <div className="col-md-2">
                    <select
                      className="form-select form-select-sm bg-dark text-white border-secondary"
                      value={filters.ticket_type}
                      onChange={(e) =>
                        handleFilterChange("ticket_type", e.target.value)
                      }
                    >
                      <option value="">Loại vé</option>
                      <option value="monthly">Vé tháng</option>
                      <option value="single">Vé lượt</option>
                    </select>
                  </div>
                )}
                <div className="col-md-2">
                  <select
                    className="form-select form-select-sm bg-dark text-white border-secondary"
                    value={filters.status}
                    onChange={(e) =>
                      handleFilterChange("status", e.target.value)
                    }
                  >
                    <option value="">Trạng thái</option>
                    <option value="PAID">Đã thanh toán (Paid)</option>
                    <option value="PENDING">Chờ (Pending)</option>
                    <option value="COMPLETED">Hoàn thành (Completed)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card shadow-sm bg-dark border-secondary">
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-dark table-hover mb-0 align-middle">
                <thead>
                    <tr>
                        <th>Bãi xe</th>
                        <th>Khóa / Xe</th>
                        {viewType === 'sessions' ? (
                            <>
                                <th>Thời gian vào</th>
                                <th>Thời gian ra</th>
                                <th>Thời lượng</th>
                                <th>Loại vé</th>
                                <th>Phí</th>
                            </>
                        ) : (
                            <>
                                <th>Mã đơn</th>
                                <th>Số tiền</th>
                                <th>Thời gian tạo</th>
                                <th>Trạng thái</th>
                            </>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                         <tr><td colSpan={8} className="text-center py-4 text-secondary">Loading...</td></tr>
                    ) : historyData.length === 0 ? (
                        <tr><td colSpan={8} className="text-center py-4 text-secondary">Không có dữ liệu</td></tr>
                    ) : (
                        historyData.map((item, idx) => (
                            <tr key={idx}>
                                <td><span className="badge bg-secondary">{item.backend_name}</span></td>
                                <td>
                                    <div><small className="text-secondary">Lock:</small> <b>{item.lock_id}</b></div>
                                    <div className="small text-secondary">{item.license_plate || item.plate_number || "Không biển số"}</div>
                                </td>
                                {viewType === 'sessions' ? (
                                    <>
                                        <td>{item.car_enter_time ? dayjs(item.car_enter_time).format("DD/MM HH:mm") : "-"}</td>
                                        <td>{item.car_exit_time ? dayjs(item.car_exit_time).format("DD/MM HH:mm") : "-"}</td>
                                        <td>
                                            {item.parking_duration !== undefined && item.parking_duration !== null 
                                                ? `${item.parking_duration}p` 
                                                : (item.billing_duration !== undefined && item.billing_duration !== null 
                                                    ? `${item.billing_duration}p` 
                                                    : "-")}
                                        </td>
                                        <td>
                                            <span className={`badge ${item.ticket_type === 'monthly' ? 'bg-info' : 'bg-primary'}`}>
                                                {item.ticket_type === 'monthly' ? 'Tháng' : 'Lượt'}
                                            </span>
                                        </td>
                                        <td className="fw-bold">{item.amount?.toLocaleString()} đ</td>
                                    </>
                                ) : (
                                    <>
                                         <td><small className="text-secondary">#{item.order_id}</small></td>
                                         <td className="fw-bold text-success">+{item.amount?.toLocaleString()} đ</td>
                                         <td>{dayjs(item.created_at).format("DD/MM HH:mm")}</td>
                                         <td>
                                            <span className={`badge ${item.status === 'PAID' ? 'bg-success' : 'bg-warning'}`}>
                                                {item.status}
                                            </span>
                                         </td>
                                    </>
                                )}
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
