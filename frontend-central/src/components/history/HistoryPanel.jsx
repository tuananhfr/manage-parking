import { useState, useEffect, useCallback } from "react";
import { formatTime } from "@/utils/formatTime";
import ParkingLotView from "./ParkingLotView";

/**
 * HistoryPanel - Component hiển thị lịch sử vào/ra và quản lý sửa/xóa
 */
const HistoryPanel = ({
  backendUrl,
  user,
  lockedStartTime = null,
  lockedEndTime = null,
  staticData = null,
  mode = null, // "shift_detail" | null
}) => {
  const [history, setHistory] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState(mode === "shift_detail" ? "in" : "all");
  const [searchText, setSearchText] = useState("");
  const [editingEntry, setEditingEntry] = useState(null);
  const [editPlateText, setEditPlateText] = useState("");
  const [changes, setChanges] = useState([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [debouncedSearchText, setDebouncedSearchText] = useState(searchText);

  // Debounce Search Text
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchText]);

  const fetchChanges = useCallback(async () => {
    try {
      setChangesLoading(true);
      let url = `${backendUrl}/api/parking/history/changes?limit=100&offset=0`;
      
      if (lockedStartTime) {
         url += `&from_date=${lockedStartTime}`;
      } else if (fromDate) {
         url += `&from_date=${fromDate}`;
      }

      if (lockedEndTime) {
         url += `&to_date=${lockedEndTime}`;
      } else if (toDate) {
         url += `&to_date=${toDate}`;
      }
      
      if (debouncedSearchText && debouncedSearchText.trim()) {
          url += `&search=${encodeURIComponent(debouncedSearchText.trim())}`;
      }

      const response = await fetch(url);
      const data = await response.json();
      if (data.success) {
        setChanges(data.changes || []);
      }
    } catch (err) {
      console.error("Error fetching changes:", err);
    } finally {
      setChangesLoading(false);
    }
  }, [backendUrl, lockedStartTime, lockedEndTime, fromDate, toDate, debouncedSearchText]);

  const fetchHistory = useCallback(async (isLoadMore = false) => {
    try {
      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setOffset(0);
        setHasMore(true);
      }

      // If staticData is provided (Shift Detail mode)
      if (staticData) {
        const allRecords = Array.isArray(staticData) ? staticData : (staticData.records || []);
        const staticChanges = !Array.isArray(staticData) ? (staticData.changes || []) : [];
        
        if (filter === "changes") {
            let changesFiltered = [...staticChanges];
            if (searchText.trim()) {
                 const lower = searchText.trim().toLowerCase();
                 changesFiltered = changesFiltered.filter(c => 
                    (c.old_plate_view && c.old_plate_view.toLowerCase().includes(lower)) ||
                    (c.new_plate_view && c.new_plate_view.toLowerCase().includes(lower)) ||
                    (c.old_plate_id && c.old_plate_id.toLowerCase().includes(lower)) ||
                    (c.new_plate_id && c.new_plate_id.toLowerCase().includes(lower))
                 );
            }
            setChanges(changesFiltered);
            setLoading(false);
            setLoadingMore(false);
            return;
        }

        let filtered = [...allRecords];

        // Filter by type
        if (filter === "in") {
           // Show all entries within shift time
           if (lockedStartTime && lockedEndTime) {
               const start = new Date(lockedStartTime).getTime();
               const end = new Date(lockedEndTime).getTime();
               filtered = filtered.filter(r => {
                   if (!r.entry_time) return false;
                   // Handle SQLite format "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS" for safe parsing
                   const timeStr = r.entry_time.replace(" ", "T");
                   const entry = new Date(timeStr).getTime();
                   return entry >= start && entry <= end;
               });
           }
        } else if (filter === "in_parking") {
          filtered = filtered.filter(r => r.status === "IN" && !r.exit_time);
        } else if (filter === "out") {
          filtered = filtered.filter(r => r.status === "OUT");
        } else if (filter === "revenue") {
          filtered = filtered.filter(r => r.status === "OUT");
        }

        // Filter by search text
        if (searchText.trim()) {
           const lower = searchText.trim().toLowerCase();
           filtered = filtered.filter(r => 
             (r.plate_id && r.plate_id.toLowerCase().includes(lower)) || 
             (r.plate_view && r.plate_view.toLowerCase().includes(lower))
           );
        }

        // Pagination simulation
        const limit = 50;
        const currentOffset = isLoadMore ? offset : 0;
        const sliced = filtered.slice(currentOffset, currentOffset + limit);

        if (isLoadMore) {
          setHistory((prev) => [...prev, ...sliced]);
          setOffset(currentOffset + sliced.length);
        } else {
          setHistory(sliced);
          setOffset(sliced.length);
        }
        setHasMore(currentOffset + sliced.length < filtered.length);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      // Normal API Fetch logic
      const currentOffset = isLoadMore ? offset : 0;
      const params = new URLSearchParams();
      params.append("limit", "50");
      params.append("offset", currentOffset.toString());

      if (filter === "today") {
        params.append("today_only", "true");
      } else if (filter === "in") {
        params.append("entries_only", "true");
      } else if (filter === "in_parking") {
        params.append("in_parking_only", "true");
      } else if (filter === "out") {
        params.append("status", "OUT");
      } else if (filter === "changes") {
        fetchChanges();
        return;
      } else if (filter === "revenue") {
        params.append("status", "OUT"); // Placeholder
      }

      if (searchText.trim()) {
        params.append("search", searchText.trim());
      }

      if (lockedStartTime) {
        params.append("start_time", lockedStartTime);
      } else if (fromDate) {
        params.append("from_date", fromDate);
      }

      if (lockedEndTime) {
        params.append("end_time", lockedEndTime);
      } else if (toDate) {
        params.append("to_date", toDate);
      }

      const response = await fetch(
        `${backendUrl}/api/parking/history?${params}`
      );
      const data = await response.json();

      if (data.success) {
        if (isLoadMore) {
          setHistory((prev) => [...prev, ...data.history]);
          setOffset(currentOffset + data.history.length);
        } else {
          setHistory(data.history);
          setOffset(data.history.length);
        }
        setHasMore(data.history.length === 50);
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!staticData) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [backendUrl, offset, filter, searchText, lockedStartTime, lockedEndTime, staticData, fromDate, toDate, fetchChanges]);



  const handleUpdateEntry = async (historyId) => {
    const normalizedPlate = editPlateText.trim().toUpperCase();
    if (!normalizedPlate || normalizedPlate.length < 5) {
      alert("Biển số phải có ít nhất 5 ký tự!");
      return;
    }

    try {
      const response = await fetch(
        `${backendUrl}/api/parking/history/${historyId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plate_id: normalizedPlate.replace(/[-.\s]/g, ""),
            plate_view: normalizedPlate,
            changed_by: user?.full_name || user?.username || "system",
          }),
        }
      );

      const data = await response.json();
      if (data.success) {
        setEditingEntry(null);
        setEditPlateText("");
        fetchHistory();
        if (filter === "changes") {
          fetchChanges();
        }
      } else {
        alert(`Lỗi: ${data.error || "Không thể cập nhật"}`);
      }
    } catch {
      alert("Lỗi kết nối đến server");
    }
  };

  const handleDeleteEntry = async (historyId) => {
    if (!window.confirm("Bạn có chắc muốn xóa entry này?")) {
      return;
    }

    try {
      const changedBy = user?.full_name || user?.username || "system";
      const response = await fetch(
        `${backendUrl}/api/parking/history/${historyId}?changed_by=${encodeURIComponent(changedBy)}`,
        {
          method: "DELETE",
        }
      );

      const data = await response.json();
      if (data.success) {
        fetchHistory();
        if (filter === "changes") {
          fetchChanges();
        }
      } else {
        alert(`Lỗi: ${data.error || "Không thể xóa"}`);
      }
    } catch {
      alert("Lỗi kết nối đến server");
    }
  };



  useEffect(() => {
    // Clear history immediately to avoid flickering logic
    setHistory([]);
    setLoading(true);

    if (filter === "changes") {
        if (!staticData) fetchChanges();
        else fetchHistory();
        return;
    }
    
    // Immediate fetch for tabs/dates/debounced-search
    fetchHistory();
  }, [filter, debouncedSearchText, fromDate, toDate, fetchHistory, staticData, fetchChanges]);

  //WebSocket for real-time updates
  useEffect(() => {
    if (staticData) return;
    
    const wsUrl = backendUrl.replace("http", "ws") + "/ws/history";
    let ws = null;
    let reconnectTimer = null;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          // console.log("[History] WebSocket connected");
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.type === "history_update") {
              fetchHistory();
            }
          } catch (err) {
            console.error("[History] WebSocket message error:", err);
          }
        };

        ws.onclose = () => {
          reconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = (err) => {
          console.error("[History] WebSocket error:", err);
        };
      } catch (err) {
        console.error("[History] WebSocket connection error:", err);
      }
    };

    connect();

    return () => {
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [backendUrl, staticData, fetchHistory]);

  return (
    <div className="card bg-dark text-white border-secondary shadow-sm h-100">
      {/* Filter */}
      <div className="px-2 pt-2">
        <div className="btn-group btn-group-sm w-100" role="group">
          {mode !== "shift_detail" && (
            <>
              <button
                className={`btn ${
                  filter === "all" ? "btn-light" : "btn-outline-light"
                }`}
                onClick={() => setFilter("all")}
              >
                Tất cả
              </button>
              <button
                className={`btn ${
                  filter === "today" ? "btn-light" : "btn-outline-light"
                }`}
                onClick={() => setFilter("today")}
              >
                Hôm nay
              </button>
            </>
          )} 
          
          <button
            className={`btn ${
              filter === "in" ? "btn-success" : "btn-outline-success"
            }`}
            onClick={() => setFilter("in")}
          >
            Xe vào
          </button>
          <button
            className={`btn ${
              filter === "out" ? "btn-danger" : "btn-outline-danger"
            }`}
            onClick={() => setFilter("out")}
          >
            Xe ra
          </button>
           <button
            className={`btn ${
              filter === "in_parking" ? "btn-info" : "btn-outline-info"
            }`}
            onClick={() => setFilter("in_parking")}
          >
            Trong bãi
          </button>
          
          {mode === "shift_detail" && (
            <button
                className={`btn ${
                filter === "revenue" ? "btn-primary" : "btn-outline-primary"
                }`}
                onClick={() => setFilter("revenue")}
            >
                Thu
            </button>
          )}

          <button
            className={`btn ${
              filter === "changes" ? "btn-warning" : "btn-outline-warning"
            }`}
            onClick={() => setFilter("changes")}
          >
            <i className="bi bi-clock-history me-1"></i>
            Đã thay đổi
          </button>
        </div>


        {/* Tìm kiếm biển số - Ẩn khi ở tab Bãi đỗ hoặc Đã thay đổi */}
        {/* Tab Bãi đỗ đã bị comment - chỉ check changes */}
          <div className="mt-2">
            {/* Date Range Filter - Hide for Today and In Parking */}
            {!lockedStartTime && !lockedEndTime && filter !== "today" && filter !== "in_parking" && (
              <div className="row g-2 mb-2">
                <div className="col-6">
                  <div className="input-group input-group-sm">
                    <span className="input-group-text bg-secondary border-secondary text-white-50">
                      Từ
                    </span>
                    <input
                      type="date"
                      className="form-control bg-dark text-white border-secondary"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="col-6">
                  <div className="input-group input-group-sm">
                    <span className="input-group-text bg-secondary border-secondary text-white-50">
                      Đến
                    </span>
                    <input
                      type="date"
                      className="form-control bg-dark text-white border-secondary"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-secondary border-secondary text-white">
                <i className="bi bi-search"></i>
              </span>
              <input
                type="text"
                className="form-control bg-dark text-white border-secondary"
                placeholder="Tìm kiếm biển số..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
              {searchText && (
                <button
                  className="btn btn-outline-light"
                  type="button"
                  onClick={() => setSearchText("")}
                >
                  <i className="bi bi-x"></i>
                </button>
              )}
            </div>
          </div>
      </div>

      {/* History List hoặc Changes List hoặc Parking Lot View */}
      <div className="flex-grow-1 overflow-auto p-2">
        {/* Tab Bãi đỗ - Ẩn trong frontend-central */}
        {filter === "changes" ? (
          //Tab "Da thay doi"
          changesLoading ? (
            <div className="text-center py-4">
              <div className="spinner-border spinner-border-sm text-primary"></div>
            </div>
          ) : changes.length === 0 ? (
            <div className="text-center text-white-50 py-4 small">
              <i className="bi bi-inbox"></i>
              <div>Chưa có thay đổi nào</div>
            </div>
          ) : (
            <div className="list-group list-group-flush">
              {changes.map((change) => (
                <div
                  key={change.id}
                  className="list-group-item bg-dark text-white border-secondary p-2"
                >
                  <div className="row g-1">
                    <div className="col flex-grow-1">
                      <div className="mb-2">
                        <span
                          className={`badge ${
                            change.change_type === "UPDATE"
                              ? "bg-warning"
                              : "bg-danger"
                          } me-2`}
                        >
                          {change.change_type === "UPDATE" ? "SỬA" : "XÓA"}
                        </span>
                        <span className="text-muted small">
                          {formatTime(new Date(change.changed_at))}
                        </span>
                        {change.changed_by && (
                          <span className="ms-2 badge bg-secondary text-light">
                            <i className="bi bi-person me-1"></i>
                            {change.changed_by}
                          </span>
                        )}
                      </div>

                      {change.change_type === "UPDATE" ? (
                        <div>
                          <div className="mb-1">
                            <span className="text-danger small">
                              <i className="bi bi-arrow-down me-1"></i>
                              Cũ: {change.old_plate_view || change.old_plate_id}
                            </span>
                          </div>
                          <div>
                            <span className="text-success small">
                              <i className="bi bi-arrow-up me-1"></i>
                              Mới:{" "}
                              {change.new_plate_view || change.new_plate_id}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <span className="text-danger small">
                            <i className="bi bi-trash me-1"></i>
                            Đã xóa:{" "}
                            {change.old_plate_view || change.old_plate_id}
                          </span>
                        </div>
                      )}

                      {change.old_data && (
                        <div
                          className="mt-2 text-muted"
                          style={{ fontSize: "0.7rem" }}
                        >
                          <details>
                            <summary className="cursor-pointer">
                              Xem chi tiết
                            </summary>
                            <div className="mt-1 p-2 bg-secondary bg-opacity-25 rounded">
                              <div>
                                <strong>Vào:</strong>{" "}
                                {change.old_data.entry_time
                                  ? formatTime(
                                      new Date(change.old_data.entry_time)
                                    )
                                  : "N/A"}
                              </div>
                              {change.old_data.exit_time && (
                                <div>
                                  <strong>Ra:</strong>{" "}
                                  {formatTime(
                                    new Date(change.old_data.exit_time)
                                  )}
                                </div>
                              )}
                              {change.old_data.fee > 0 && (
                                <div>
                                  <strong>Phí:</strong>{" "}
                                  {change.old_data.fee.toLocaleString("vi-VN")}đ
                                </div>
                              )}
                            </div>
                          </details>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : loading ? (
          <div className="text-center py-4">
            <div className="spinner-border spinner-border-sm text-primary"></div>
          </div>
        ) : history.length === 0 ? (
          <div className="text-center text-white-50 py-4 small">
            <i className="bi bi-inbox"></i>
            <div>
              {searchText ? "Không tìm thấy kết quả" : "Chưa có dữ liệu"}
            </div>
          </div>
        ) : (
          <>
            <div className="list-group list-group-flush">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="list-group-item bg-dark text-white border-secondary p-2"
                  style={{
                    backgroundColor: entry.is_anomaly
                      ? "#fff3cd"
                      : "transparent",
                  }}
                >
                  <div className="row g-1">
                    {/* Thông tin chính */}
                    <div className="col flex-grow-1">
                      {/* Biển số */}
                      <div className="mb-2">
                        <div
                          className="fw-bold text-info"
                          style={{ fontSize: "1rem" }}
                        >
                          {entry.is_anomaly === 1 && (
                            <i
                              className="bi bi-exclamation-triangle-fill text-warning me-1"
                              title="Tự động tạo từ camera trong bãi"
                            ></i>
                          )}
                          <i className="bi bi-123 me-1"></i>
                          {entry.plate_view || entry.plate_id}
                        </div>
                      </div>

                      {/* Giờ vào/ra */}
                      <div className="mb-1">
                        <div
                          className="text-white-50 mb-1"
                          style={{ fontSize: "0.7rem" }}
                        >
                          <i
                            className="bi bi-arrow-down-circle text-success me-1"
                            style={{ fontSize: "0.65rem" }}
                          ></i>
                          Vào:{" "}
                          {entry.entry_time
                            ? formatTime(new Date(entry.entry_time))
                            : "N/A"}
                          {entry.entry_camera_name && (
                            <span className="ms-1">
                              ({entry.entry_camera_name})
                            </span>
                          )}
                        </div>
                        {entry.exit_time ? (
                          <div
                            className="text-white-50"
                            style={{ fontSize: "0.7rem" }}
                          >
                            <i
                              className="bi bi-arrow-up-circle text-danger me-1"
                              style={{ fontSize: "0.65rem" }}
                            ></i>
                            Ra: {formatTime(new Date(entry.exit_time))}
                            {entry.exit_camera_name && (
                              <span className="ms-1">
                                ({entry.exit_camera_name})
                              </span>
                            )}
                          </div>
                        ) : entry.status === "IN" ? (
                          <div
                            className="text-white-50"
                            style={{ fontSize: "0.7rem" }}
                          >
                            <i
                              className="bi bi-clock text-info me-1"
                              style={{ fontSize: "0.65rem" }}
                            ></i>
                            Ra: Đang trong bãi
                          </div>
                        ) : null}
                      </div>

                      {/* Vị trí (nếu có) */}
                      {entry.last_location && (
                        <div className="mb-1">
                          <div
                            className="text-white-50"
                            style={{ fontSize: "0.7rem" }}
                          >
                            <i
                              className="bi bi-geo-alt-fill text-info me-1"
                              style={{ fontSize: "0.65rem" }}
                            ></i>
                            Vị trí: {entry.last_location}
                            {entry.last_location_time && (
                              <span className="ms-1">
                                (
                                {formatTime(new Date(entry.last_location_time))}
                                )
                              </span>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Loại khách */}
                      <div className="mb-1">
                        <span className="badge bg-info">
                          <i className="bi bi-person-fill me-1"></i>
                          {entry.customer_type === "subscription"
                            ? "Khách tháng"
                            : entry.customer_type === "guest"
                            ? "Khách lẻ"
                            : entry.vehicle_type || "Khách lẻ"}
                        </span>
                      </div>
                    </div>

                    {/* Cột phải: Giá vé, trạng thái và nút sửa/xóa */}
                    <div className="col-auto text-end">
                      <div className="d-flex gap-1 mb-2 justify-content-end">
                        <button
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => {
                            setEditingEntry(entry);
                            setEditPlateText(
                              entry.plate_view || entry.plate_id
                            );
                          }}
                          title="Sửa biển số"
                        >
                          <i className="bi bi-pencil-fill"></i>
                        </button>
                        <button
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => handleDeleteEntry(entry.id)}
                          title="Xóa"
                        >
                          <i className="bi bi-trash-fill"></i>
                        </button>
                      </div>

                      <span
                        className={`badge ${
                          entry.status === "IN" ? "bg-success" : "bg-secondary"
                        } mb-2`}
                        style={{ fontSize: "0.75rem" }}
                      >
                        {entry.status === "IN" ? "ĐANG TRONG BÃI" : "ĐÃ RA"}
                      </span>

                      {/* Thời gian (nếu có) */}
                      {entry.duration && (
                        <div className="text-muted small mt-1">
                          <i className="bi bi-clock me-1"></i>
                          {entry.duration}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Load More Button */}
            {hasMore && (
              <div className="text-center py-3">
                <button
                  className="btn btn-outline-primary btn-sm"
                  onClick={() => fetchHistory(true)}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2"></span>
                      Đang tải...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-arrow-down-circle me-2"></i>
                      Xem thêm
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal sửa biển số */}
      {editingEntry && (
        <div
          className="modal show d-block"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditingEntry(null);
            }
          }}
        >
          <div
            className="modal-dialog modal-dialog-centered"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content bg-dark text-white border-secondary">
              <div className="modal-header border-secondary" style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)' }}>
                <h6 className="modal-title mb-0">
                  <i className="bi bi-pencil-fill me-2"></i>
                  Sửa biển số xe
                </h6>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => setEditingEntry(null)}
                ></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label">
                    <i className="bi bi-123 me-1"></i>
                    Biển số xe mới
                  </label>
                  <input
                    type="text"
                    className="form-control form-control-lg text-center fw-bold text-uppercase"
                    value={editPlateText}
                    onChange={(e) =>
                      setEditPlateText(e.target.value.toUpperCase())
                    }
                    placeholder="VD: 30A12345"
                    style={{
                      fontSize: "1.2rem",
                      letterSpacing: "2px",
                    }}
                    autoFocus
                  />
                  <small className="text-muted">
                    Biển số cũ:{" "}
                    <strong>
                      {editingEntry.plate_view || editingEntry.plate_id}
                    </strong>
                  </small>
                </div>
              </div>
              <div className="modal-footer border-secondary">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingEntry(null)}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleUpdateEntry(editingEntry.id)}
                >
                  <i className="bi bi-check-circle-fill me-1"></i>
                  Lưu
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HistoryPanel;
