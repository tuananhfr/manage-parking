import React from 'react';

const RecordingFilters = ({
  nvrOptions,
  selectedNvrId,
  setSelectedNvrId,
  cameraOptions,
  selectedCameraId,
  setSelectedCameraId,
  filters,
  setFilters,
  loading,
  onReload,
  loadingCameras
}) => {
  return (
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
        <label className="form-label mb-1">Ngày</label>
        <input
          type="date"
          className="form-control form-control-sm bg-dark text-white border-secondary"
          value={filters.date}
          onChange={(e) => setFilters.setDate(e.target.value)}
          disabled={loading}
        />
      </div>

      <div>
        <label className="form-label mb-1">Giờ bắt đầu</label>
        <input
          type="time"
          className="form-control form-control-sm bg-dark text-white border-secondary"
          value={filters.startTime}
          onChange={(e) => setFilters.setStartTime(e.target.value)}
          disabled={loading}
        />
      </div>

      <div>
        <label className="form-label mb-1">Giờ kết thúc</label>
        <input
          type="time"
          className="form-control form-control-sm bg-dark text-white border-secondary"
          value={filters.endTime}
          onChange={(e) => setFilters.setEndTime(e.target.value)}
          disabled={loading}
        />
      </div>

      <button
        className="btn btn-sm btn-outline-light ms-2"
        onClick={onReload}
        disabled={!selectedNvrId || !selectedCameraId || loading}
      >
        <i className="bi bi-arrow-repeat me-1"></i>
        Tải lại
      </button>

      {(filters.date || filters.startTime || filters.endTime) && (
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={() => {
            setFilters.setDate("");
            setFilters.setStartTime("");
            setFilters.setEndTime("");
          }}
          title="Xóa bộ lọc"
        >
          <i className="bi bi-x-circle me-1"></i>
          Xóa lọc
        </button>
      )}

      {loading && (
        <span className="text-secondary ms-2 small">
          Đang tải danh sách...
        </span>
      )}
    </div>
  );
};

export default RecordingFilters;
