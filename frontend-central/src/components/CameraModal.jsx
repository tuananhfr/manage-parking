import { useState, useRef } from 'react';
import VideoPlayer from './VideoPlayer';

const CameraModal = ({ camera, onClose, onDelete, onUpdate, canEdit = false }) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [editCamera, setEditCamera] = useState({
    name: camera?.name || '',
    url: camera?.url || '',
    enable_detection: camera?.enable_detection !== undefined ? camera.enable_detection : true,
  });
  const containerRef = useRef(null);

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.25, 5));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Handle mouse down for pan
  const handleMouseDown = (e) => {
    if (zoom > 1 && e.button === 0) { // Only left mouse button
      e.preventDefault();
      setIsDragging(true);
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        setDragStart({
          x: e.clientX - rect.left - pan.x,
          y: e.clientY - rect.top - pan.y
        });
      }
    }
  };

  // Handle mouse move for pan
  const handleMouseMove = (e) => {
    if (isDragging && zoom > 1) {
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const newX = e.clientX - rect.left - dragStart.x;
        const newY = e.clientY - rect.top - dragStart.y;
        
        // Calculate bounds to prevent panning outside video area
        // When zoomed, video is larger than container
        const maxPanX = (rect.width * (zoom - 1)) / 2;
        const maxPanY = (rect.height * (zoom - 1)) / 2;
        
        setPan({
          x: Math.max(-maxPanX, Math.min(maxPanX, newX)),
          y: Math.max(-maxPanY, Math.min(maxPanY, newY))
        });
      }
    }
  };

  // Handle mouse up for pan
  const handleMouseUp = () => {
    setIsDragging(false);
  };



  const handleFullscreen = () => {
    const element = document.querySelector('.camera-modal-video');
    if (element) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        element.requestFullscreen();
      }
    }
  };

  const handleSaveSettings = async () => {
    if (onUpdate && editCamera.name && editCamera.url) {
      try {
        const success = await onUpdate(camera.id, editCamera);
        // Đóng panel cài đặt sau khi lưu thành công (hoặc không có lỗi)
        if (success !== false) {
          setShowSettings(false);
          // Update local state để modal hiển thị ngay
          setEditCamera({
            name: editCamera.name,
            url: editCamera.url,
            enable_detection: editCamera.enable_detection,
          });
        }
      } catch (error) {
        // Nếu có lỗi, không đóng panel để user có thể sửa lại
        console.error('Error saving camera settings:', error);
      }
    }
  };



  return (
    <>
      <div className="modal fade show d-block" tabIndex={-1}>
        <div 
          className="modal-dialog modal-dialog-centered"
          style={{
            maxWidth: '80vw',
            width: '80vw',
            maxHeight: '80vh',
            height: '80vh',
            margin: 'auto'
          }}
        >
          <div className="modal-content bg-dark text-white h-100 d-flex flex-column">
            <div className="modal-header border-secondary">
              <h5 className="modal-title">{camera.name}</h5>
              <button type="button" className="btn-close btn-close-white" onClick={onClose}></button>
            </div>
            <div 
              ref={containerRef}
              className="modal-body p-0 position-relative camera-modal-video flex-grow-1" 
              style={{ 
                minHeight: 0, 
                overflow: 'hidden',
                cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <div 
                className="position-relative h-100 w-100" 
                style={{ 
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: 'center center',
                  transition: isDragging ? 'none' : 'transform 0.2s ease-out',
                  willChange: isDragging ? 'transform' : 'auto'
                }}
              >
                <VideoPlayer camera={camera} />
              </div>

              {/* Video Controls */}
              <div className="position-absolute bottom-0 start-0 w-100 p-3" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' }}>
                <div className="d-flex justify-content-between align-items-center">
                  {/* Zoom Controls */}
                  <div className="btn-group" role="group">
                    <button
                      className="btn btn-sm btn-dark"
                      onClick={handleZoomOut}
                      disabled={zoom <= 0.5}
                      title="Thu nhỏ"
                    >
                      <i className="bi bi-zoom-out"></i>
                    </button>
                    <button
                      className="btn btn-sm btn-dark"
                      onClick={handleResetZoom}
                      disabled={zoom === 1}
                      title="Đặt lại Zoom"
                    >
                      {Math.round(zoom * 100)}%
                    </button>
                    <button
                      className="btn btn-sm btn-dark"
                      onClick={handleZoomIn}
                      disabled={zoom >= 5}
                      title="Phóng to"
                    >
                      <i className="bi bi-zoom-in"></i>
                    </button>
                  </div>

                  {/* Right Controls */}
                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-sm btn-dark"
                      onClick={handleFullscreen}
                      title="Toàn màn hình"
                    >
                      <i className="bi bi-fullscreen"></i>
                    </button>
                    {canEdit && (
                      <button
                        className={`btn btn-sm ${showSettings ? "btn-primary" : "btn-dark"}`}
                        onClick={() => setShowSettings(!showSettings)}
                        title="Cài đặt"
                      >
                        <i className="bi bi-gear"></i>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Settings Panel */}
              {showSettings && (
                <div className="position-absolute top-0 end-0 m-3" style={{ maxWidth: '400px', zIndex: 10 }}>
                  <div className="card bg-dark border-secondary text-white">
                    <div className="card-header border-secondary d-flex justify-content-between align-items-center">
                      <h6 className="mb-0">
                        <i className="bi bi-gear me-2"></i>
                        Cài đặt Camera
                      </h6>
                      <button
                        type="button"
                        className="btn-close btn-close-white"
                        onClick={() => setShowSettings(false)}
                      ></button>
                    </div>
                    <div className="card-body">
                      <div className="mb-3">
                        <label className="form-label small">Tên camera</label>
                        <input
                          type="text"
                          className="form-control form-control-sm bg-black text-white border-secondary"
                          value={editCamera.name}
                          onChange={(e) => setEditCamera({ ...editCamera, name: e.target.value })}
                          placeholder="Nhập tên camera"
                        />
                      </div>
                      <div className="mb-3">
                        <label className="form-label small">URL</label>
                        <input
                          type="text"
                          className="form-control form-control-sm bg-black text-white border-secondary"
                          value={editCamera.url}
                          onChange={(e) => setEditCamera({ ...editCamera, url: e.target.value })}
                          placeholder="rtsp://..."
                        />
                      </div>
                      <div className="mb-3">
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id="enableDetectionCheck"
                            checked={editCamera.enable_detection}
                            onChange={(e) => setEditCamera({ ...editCamera, enable_detection: e.target.checked })}
                          />
                          <label className="form-check-label small" htmlFor="enableDetectionCheck">
                            Bật Nhận diện AI
                            <small className="d-block text-muted">Tắt để chỉ stream video (tiết kiệm CPU)</small>
                          </label>
                        </div>
                      </div>
                      <div className="d-flex gap-2">
                        {onUpdate && (
                          <button
                            className="btn btn-sm btn-primary flex-fill"
                            onClick={handleSaveSettings}
                            disabled={!editCamera.name || !editCamera.url}
                          >
                            <i className="bi bi-save me-1"></i>
                            Lưu
                          </button>
                        )}
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            if (window.confirm('Bạn có chắc chắn muốn xóa camera này?')) {
                              onDelete();
                            }
                          }}
                          title="Xóa camera"
                        >
                          <i className="bi bi-trash"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show"></div>
    </>
  );
};

export default CameraModal;
