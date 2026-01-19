import React from 'react';

const RecordingTable = ({
  recordings,
  loading,
  loadingCameras,
  loadingMore,
  hasMore,
  totalRecordings,
  onLoadMore,
  onPlay,
  onDownload,
  onHover,
  onLeave,
  backendUrl,
  selectedNvrId
}) => {
  return (
    <div
      className="flex-grow-1 overflow-auto border border-secondary rounded"
      onScroll={(e) => {
        const target = e.target;
        if (target.scrollHeight - target.scrollTop - target.clientHeight < 100) {
          onLoadMore();
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
          ) : loading && recordings.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-center text-secondary">
                <div className="spinner-border spinner-border-sm me-2" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
                Đang tải danh sách...
              </td>
            </tr>
          ) : recordings.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-center text-secondary">
                Không có bản ghi nào.
              </td>
            </tr>
          ) : (
            recordings.map((rec, idx) => {
              const sizeMB = rec.size_mb ? rec.size_mb.toFixed(1) : "-";
              const videoUrl = `${backendUrl}/api/rtsp-cameras/recordings/${
                rec.camera_id
              }/video?nvr_id=${encodeURIComponent(
                selectedNvrId
              )}&path=${encodeURIComponent(rec.path)}`;
              const thumbnailUrl = `${backendUrl}/api/rtsp-cameras/recordings/${
                rec.camera_id
              }/thumbnail?nvr_id=${encodeURIComponent(
                selectedNvrId
              )}&path=${encodeURIComponent(rec.path)}`;
              const previewUrl = `${backendUrl}/api/rtsp-cameras/recordings/${
                rec.camera_id
              }/preview?nvr_id=${encodeURIComponent(
                selectedNvrId
              )}&path=${encodeURIComponent(rec.path)}`;

              return (
                <tr
                  key={`${rec.camera_id}-${rec.filename}-${idx}`}
                  className="recording-row"
                  style={{ position: "relative" }}
                >
                  <td>{idx + 1}</td>
                  <td style={{ padding: "4px" }}>
                    <img
                      src={thumbnailUrl}
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
                        const rect = e.currentTarget.getBoundingClientRect();
                        onHover({ url: previewUrl, rect });
                      }}
                      onMouseLeave={onLeave}
                      onError={(e) => {
                        e.target.style.display = "none";
                        e.target.parentElement.innerHTML =
                          '<div style="width:100px;height:56px;display:flex;align-items:center;justify-content:center;color:#666;font-size:0.7rem;">Không ảnh</div>';
                      }}
                    />
                  </td>
                  <td>{rec.start || "-"}</td>
                  <td>{rec.duration ? `${Math.round(rec.duration)}s` : (rec.is_processing ? "Đang xử lý..." : "-")}</td>
                  <td>{sizeMB} MB</td>
                  <td>{rec.filename}</td>
                  <td>
                    <button
                      onClick={() => onPlay({ url: videoUrl, filename: rec.filename })}
                      className="btn btn-sm btn-outline-primary me-1"
                      title="Xem video"
                    >
                      <i className="bi bi-play-circle"></i>
                    </button>
                    <button
                      className="btn btn-sm btn-outline-success"
                      onClick={() => onDownload(videoUrl, rec.filename)}
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

      {loadingMore && (
        <div className="text-center py-3 text-secondary">
          <div className="spinner-border spinner-border-sm me-2" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          Đang tải thêm...
        </div>
      )}

      {!hasMore && recordings.length > 0 && !loading && (
        <div className="text-center py-2 text-secondary small">
          <i className="bi bi-check-circle me-1"></i>
          Đã hiển thị tất cả {totalRecordings} recordings
        </div>
      )}
    </div>
  );
};

export default RecordingTable;
