import React, { useEffect, useMemo, useState, useCallback } from "react";
import TimelapseSettingsModal from "./TimelapseSettingsModal";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

const TimelapseTab = ({ showSettings, onCloseSettings }) => {
  // const isManager = user?.role === 'manager'; // Removed
  const [cameras, setCameras] = useState([]);
  const [loadingCameras, setLoadingCameras] = useState(true);
  const [selectedNvrId, setSelectedNvrId] = useState("");
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [timelapseList, setTimelapseList] = useState([]);
  const [loadingTimelapse, setLoadingTimelapse] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selectedVideo, setSelectedVideo] = useState(null); // { url, filename }

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalTimelapses, setTotalTimelapses] = useState(0);
  const PAGE_SIZE = 20; // Số timelapses mỗi lần load

  const [filterDate, setFilterDate] = useState(""); // YYYY-MM-DD
  const [filterStartTime, setFilterStartTime] = useState(""); // HH:MM
  const [filterEndTime, setFilterEndTime] = useState(""); // HH:MM

  const [timelapseConfig, setTimelapseConfig] = useState(null);
  // Removed Drupal config loading logic

  // Load cameras
  useEffect(() => {
    const loadCameras = async () => {
      try {
        setLoadingCameras(true);
        setError("");
        const resp = await fetch(`${BACKEND_URL}/api/rtsp-cameras`);
        if (!resp.ok)
          throw new Error(`Failed to fetch cameras: ${resp.status}`);
        const data = await resp.json();
        const list = Array.isArray(data) ? data : [];
        setCameras(list);
        if (list.length > 0) {
          const first = list[0];
          setSelectedNvrId(first.nvr_id || "");
          setSelectedCameraId(first.id || "");
        }
      } catch (e) {
        console.error("[TimelapseTab] Failed to load cameras", e);
        setError(e instanceof Error ? e.message : "Failed to load cameras");
      } finally {
        setLoadingCameras(false);
      }
    };
    loadCameras();
  }, []);

  const nvrOptions = useMemo(() => {
    const map = new Map();
    cameras.forEach((c) => {
      if (c.nvr_id) {
        map.set(c.nvr_id, c.nvr_name || c.nvr_id);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [cameras]);

  const cameraOptions = useMemo(() => {
    return cameras.filter((c) => !selectedNvrId || c.nvr_id === selectedNvrId);
  }, [cameras, selectedNvrId]);

  const loadTimelapseList = useCallback(async (page = 1, append = false) => {
    if (!selectedNvrId || !selectedCameraId) return;

    // Đảm bảo page là số nguyên (tránh trường hợp nhận object từ event)
    const pageNum =
      typeof page === "number"
        ? page
        : typeof page === "string"
        ? parseInt(page, 10)
        : 1;
    if (isNaN(pageNum) || pageNum < 1) {
      console.warn(`[TimelapseTab] Invalid page value: ${page}, using 1`);
      page = 1;
    } else {
      page = pageNum;
    }

    const isLoadingMore = append && page > 1;
    try {
      if (isLoadingMore) {
        setLoadingMore(true);
      } else {
        setLoadingTimelapse(true);
        setError("");
        if (!append) {
          setTimelapseList([]);
          setCurrentPage(1);
        }
      }

      // Build URL with filter params
      let url = `${BACKEND_URL}/api/timelapse/${selectedCameraId}?page=${page}&limit=${PAGE_SIZE}`;

      if (filterDate) {
        url += `&date=${encodeURIComponent(filterDate)}`;
      }
      if (filterStartTime) {
        url += `&start_time=${encodeURIComponent(filterStartTime)}`;
      }
      if (filterEndTime) {
        url += `&end_time=${encodeURIComponent(filterEndTime)}`;
      }

      const resp = await fetch(url);

      if (!resp.ok) {
        if (resp.status === 404) {
          setTimelapseList([]);
          setHasMore(false);
          setTotalTimelapses(0);
          return;
        }
        const errData = await resp.json().catch(() => null);
        throw new Error(
          errData?.detail || `Failed to fetch timelapse: ${resp.status}`
        );
      }

      const data = await resp.json();
      const list = Array.isArray(data.timelapses) ? data.timelapses : [];
      const pagination = data.pagination || {};

      if (append) {
        // Append new timelapses to existing list
        setTimelapseList((prev) => [...prev, ...list]);
      } else {
        // Replace timelapses
        setTimelapseList(list);
      }

      setCurrentPage(page);
      setHasMore(pagination.has_more || false);
      setTotalTimelapses(pagination.total || list.length);
    } catch (e) {
      console.error("[TimelapseTab] Failed to load timelapse", e);
      setError(e instanceof Error ? e.message : "Failed to load timelapse");
    } finally {
      setLoadingTimelapse(false);
      setLoadingMore(false);
    }
  }, [selectedNvrId, selectedCameraId, filterDate, filterStartTime, filterEndTime]);

  const loadMoreTimelapses = () => {
    if (!loadingMore && hasMore && !loadingTimelapse) {
      loadTimelapseList(currentPage + 1, true);
    }
  };

  useEffect(() => {
    if (selectedNvrId && selectedCameraId) {
      loadTimelapseList();
    }
  }, [
    selectedNvrId,
    selectedCameraId,
    filterDate,
    filterStartTime,
    filterEndTime,
    loadTimelapseList
  ]);

  // Backend now handles filtering, so we use timelapseList directly
  const filteredTimelapse = timelapseList;

  // Filter summary info
  const showingCount = filteredTimelapse.length;
  const totalCount = totalTimelapses;

  // Load config for modal
  const loadConfig = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/timelapse/config`);
      if (!response.ok) throw new Error("Failed to fetch config");
      const result = await response.json();
      setTimelapseConfig(result.data || result);
    } catch {
      // fail silently
    }
  };

  useEffect(() => {
    if (showSettings) {
      loadConfig();
    }
  }, [showSettings]);

  // Removed handleUploadToDrupal function

  return (
    <div
      className="h-100 w-100 d-flex flex-column bg-dark text-white"
      style={{ minHeight: 0, overflow: "hidden" }}
    >
      <div className="border-bottom border-secondary px-3 py-2 d-flex align-items-center justify-content-between">
        <div>
          <h5 className="mb-0">
            <i className="bi bi-clock-history me-2"></i>
            Timelapse
          </h5>
          <small className="text-secondary">
            Xem video tua nhanh (timelapse) được tạo tự động.
          </small>
        </div>
      </div>

      <div
        className="flex-grow-1 d-flex flex-column px-3 py-2"
        style={{ minHeight: 0 }}
      >
        {/* Filters */}
        <div className="d-flex flex-wrap gap-2 mb-2 align-items-end">
          <div>
            <label className="form-label mb-1">NVR</label>
            <select
              className="form-select form-select-sm bg-dark text-white border-secondary"
              value={selectedNvrId}
              onChange={(e) => setSelectedNvrId(e.target.value)}
              disabled={loadingCameras}
            >
              {nvrOptions.length === 0 && <option value="">Không có NVR</option>}
              {nvrOptions.map((nvr) => (
                <option key={nvr.id} value={nvr.id}>
                  {nvr.name} ({nvr.id})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label mb-1">Camera</label>
            <select
              className="form-select form-select-sm bg-dark text-white border-secondary"
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              disabled={loadingCameras || cameraOptions.length === 0}
            >
              {cameraOptions.length === 0 && (
                <option value="">Không có Camera</option>
              )}
              {cameraOptions.map((cam) => (
                <option key={cam.id} value={cam.id}>
                  {cam.name || cam.id} ({cam.id})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label mb-1">Ngày tạo</label>
            <input
              type="date"
              className="form-control form-control-sm bg-dark text-white border-secondary"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              disabled={loadingTimelapse}
            />
          </div>

          <div>
            <label className="form-label mb-1">Giờ bắt đầu</label>
            <input
              type="time"
              className="form-control form-control-sm bg-dark text-white border-secondary"
              value={filterStartTime}
              onChange={(e) => setFilterStartTime(e.target.value)}
              disabled={loadingTimelapse}
            />
          </div>

          <div>
            <label className="form-label mb-1">Giờ kết thúc</label>
            <input
              type="time"
              className="form-control form-control-sm bg-dark text-white border-secondary"
              value={filterEndTime}
              onChange={(e) => setFilterEndTime(e.target.value)}
              disabled={loadingTimelapse}
            />
          </div>

          <button
            className="btn btn-sm btn-outline-light ms-2"
            onClick={() => loadTimelapseList()}
            disabled={!selectedNvrId || !selectedCameraId || loadingTimelapse}
          >
            <i className="bi bi-arrow-repeat me-1"></i>
            Tải lại
          </button>

          {(filterDate || filterStartTime || filterEndTime) && (
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={() => {
                setFilterDate("");
                setFilterStartTime("");
                setFilterEndTime("");
              }}
            >
              <i className="bi bi-x-circle me-1"></i>
              Xóa lọc
            </button>
          )}
        </div>

        {/* Pagination summary */}
        {totalCount > 0 && (
          <div className="mb-2 small text-secondary">
            <i className="bi bi-file-earmark-play me-1"></i>
            Hiển thị {showingCount} / {totalCount} timelapse videos
            {hasMore && " (scroll xuống để tải thêm)"}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="alert alert-danger py-1 px-2 mb-2 small">
            <i className="bi bi-exclamation-triangle me-2"></i>
            {error}
          </div>
        )}

        {/* Table */}
        <div
          className="flex-grow-1 overflow-auto border border-secondary rounded"
          onScroll={(e) => {
            const target = e.target;
            // Load more khi scroll gần đến cuối (còn 100px)
            if (
              target.scrollHeight - target.scrollTop - target.clientHeight <
              100
            ) {
              loadMoreTimelapses();
            }
          }}
        >
          <table className="table table-dark table-hover table-sm mb-0 align-middle">
            <thead>
              <tr>
                <th style={{ width: "32px" }}>#</th>
                <th style={{ width: "120px" }}>Ảnh</th>
                <th>Bắt đầu</th>
                <th>Thời lượng</th>
                <th>Dung lượng</th>
                <th>Tên file</th>
                <th style={{ width: "100px" }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loadingCameras ? (
                <tr>
                  <td colSpan={7} className="text-center text-secondary">
                    Đang tải camera...
                  </td>
                </tr>
              ) : loadingTimelapse && timelapseList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-secondary">
                    <div className="spinner-border spinner-border-sm me-2"></div>
                    Đang tải danh sách...
                  </td>
                </tr>
              ) : filteredTimelapse.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-secondary">
                    {timelapseList.length === 0
                      ? "Chưa có timelapse video nào."
                      : "Không có video khớp với bộ lọc."}
                  </td>
                </tr>
              ) : (
                filteredTimelapse.map((item, idx) => {
                  const hasThumb = item.has_thumbnail;
                  const thumbUrl = hasThumb
                    ? `${BACKEND_URL}/api/timelapse/${
                        item.camera_id
                      }/thumbnail?path=${encodeURIComponent(
                        item.thumbnail_path
                      )}`
                    : null;

                  const videoUrl = `${BACKEND_URL}/api/timelapse/${
                    item.camera_id
                  }/video?path=${encodeURIComponent(item.path)}`;

                  // Use start_time from metadata if available, otherwise created_at
                  const timeDisplay = item.start_time
                    ? new Date(item.start_time).toLocaleString("vi-VN")
                    : item.created_at
                    ? new Date(item.created_at).toLocaleString("vi-VN")
                    : "N/A";

                  return (
                    <tr
                      key={`${item.filename}-${idx}`}
                      style={{ position: "relative" }}
                    >
                      <td>{idx + 1}</td>
                      <td style={{ padding: "4px" }}>
                        <img
                          src={thumbUrl}
                          alt="Thumbnail"
                          style={{
                            width: "100px",
                            height: "56px",
                            objectFit: "cover",
                            borderRadius: "4px",
                            border: "1px solid #495057",
                            backgroundColor: "#1a1a1a",
                            cursor: "pointer",
                          }}
                          onMouseEnter={(e) => {
                            // Show preview on hover
                            const target = e.currentTarget;
                            const existing = document.getElementById(
                              "active-timelapse-preview"
                            );
                            if (existing) existing.remove();

                            const rect = target.getBoundingClientRect();
                            const PREVIEW_WIDTH = 320;
                            const PREVIEW_HEIGHT = 240;
                            const GAP = 10;

                            let left = rect.right + GAP;
                            let top = rect.top;

                            if (
                              top + PREVIEW_HEIGHT >
                              window.innerHeight - 20
                            ) {
                              top = Math.max(10, rect.bottom - PREVIEW_HEIGHT);
                            }

                            const previewDiv = document.createElement("div");
                            previewDiv.id = "active-timelapse-preview";
                            previewDiv.style.cssText = `
                              position: fixed;
                              left: ${left}px;
                              top: ${top}px;
                              z-index: 9999;
                              width: ${PREVIEW_WIDTH}px;
                              height: ${PREVIEW_HEIGHT}px;
                              background: #000;
                              border: 2px solid #0d6efd;
                              border-radius: 4px;
                              box-shadow: 0 4px 12px rgba(0,0,0,0.5);
                              pointer-events: none;
                            `;

                            const video = document.createElement("video");
                            video.src = videoUrl;
                            video.muted = true;
                            video.autoplay = true;
                            video.loop = true;
                            video.playsInline = true;
                            video.style.cssText =
                              "width: 100%; height: 100%; object-fit: contain;";

                            video.onerror = () => {
                              previewDiv.innerHTML =
                                '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;">Không thể xem trước</div>';
                            };

                            previewDiv.appendChild(video);
                            document.body.appendChild(previewDiv);
                          }}
                          onMouseLeave={() => {
                            const preview = document.getElementById(
                              "active-timelapse-preview"
                            );
                            if (preview) {
                              preview.remove();
                            }
                          }}
                          onClick={() =>
                            setSelectedVideo({
                              url: videoUrl,
                              filename: item.filename,
                            })
                          }
                          onError={() => {
                            //e.target.style.display = "none";
                          }}
                        />
                        {!thumbUrl && (
                          <div
                            className="d-flex align-items-center justify-content-center bg-secondary rounded"
                            style={{
                              width: "100px",
                              height: "56px",
                              fontSize: "0.8rem",
                              color: "#ccc",
                            }}
                          >
                            Không ảnh
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ fontSize: "0.9rem" }}>{timeDisplay}</div>
                      </td>
                      <td>
                        {item.duration_seconds ? (
                          <div style={{ fontSize: "0.9rem" }}>
                            {item.duration_seconds}s
                          </div>
                        ) : (
                          <span className="text-secondary">-</span>
                        )}
                      </td>
                      <td>
                        <div style={{ fontSize: "0.9rem" }}>
                          {(item.size_bytes / 1024 / 1024).toFixed(2)} MB
                        </div>
                      </td>
                      <td>
                        <div
                          className="text-truncate"
                          style={{ maxWidth: "250px", fontSize: "0.9rem" }}
                          title={item.filename}
                        >
                          {item.filename}
                          
                          
                        </div>
                        
                      </td>
                      <td>
                        <button
                          className="btn btn-sm btn-outline-primary me-1"
                          onClick={() =>
                            setSelectedVideo({
                              url: videoUrl,
                              filename: item.filename,
                            })
                          }
                          title="Xem video"
                        >
                          <i className="bi bi-play-fill"></i>
                        </button>
                        <button
                          className="btn btn-sm btn-outline-success"
                          onClick={() => {
                            // Tạo link ẩn để trigger download
                            const link = document.createElement("a");
                            link.href = `${videoUrl}&download=true`;
                            link.setAttribute("download", item.filename); // Hint for filename
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          }}
                          title="Tải video"
                        >
                          <i className="bi bi-download"></i>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Loading more indicator */}
          {loadingMore && (
            <div className="text-center py-3 text-secondary">
              <div
                className="spinner-border spinner-border-sm me-2"
                role="status"
              >
                <span className="visually-hidden">Loading...</span>
              </div>
              Đang tải thêm...
            </div>
          )}

          {/* End of list indicator */}
          {!hasMore && timelapseList.length > 0 && !loadingTimelapse && (
            <div className="text-center py-2 text-secondary small">
              <i className="bi bi-check-circle me-1"></i>
              Đã hiển thị tất cả {totalCount} timelapse videos
            </div>
          )}
        </div>
      </div>

      {/* Video Modal */}
      {selectedVideo && (
        <div
          className="modal show d-block"
          style={{ backgroundColor: "rgba(0,0,0,0.8)", zIndex: 1050 }}
          onClick={() => setSelectedVideo(null)}
        >
          <div
            className="modal-dialog modal-lg modal-dialog-centered"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-content bg-dark text-white">
              <div className="modal-header border-secondary">
                <h5 className="modal-title">
                  <i className="bi bi-play-circle me-2"></i>
                  {selectedVideo.filename}
                </h5>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => setSelectedVideo(null)}
                ></button>
              </div>
              <div className="modal-body p-0">
                <video
                  controls
                  controlsList="nodownload"
                  onContextMenu={(e) => e.preventDefault()}
                  autoPlay
                  style={{ width: "100%", maxHeight: "70vh" }}
                  src={selectedVideo.url}
                >
                  Trình duyệt của bạn không hỗ trợ video tag.
                </video>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal (Inject via Props/Internal state) */}
      <TimelapseSettingsModal
        show={showSettings}
        onClose={onCloseSettings}
        timelapseConfig={timelapseConfig}
        onSave={(updatedConfig) => setTimelapseConfig(updatedConfig)}
      />
    </div>
  );
};

export default TimelapseTab;
