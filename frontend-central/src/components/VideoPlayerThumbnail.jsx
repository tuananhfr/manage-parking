import { useEffect, useState } from 'react';



const VideoPlayerThumbnail = ({ camera, onClick }) => {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

  const [currentSnapshotUrl, setCurrentSnapshotUrl] = useState(null);
  
  useEffect(() => {
    let intervalId = null;
    let isCleanedUp = false;
    let loadingInProgress = false;

    const loadSnapshot = () => {
      // Nếu đang load dở thì bỏ qua lượt này để tránh queue chồng chéo
      if (loadingInProgress) return;
      
      try {
        if (!camera.snapshot_url) {
          if (!isCleanedUp) setError('Snapshot URL not available');
          setLoading(false);
          return;
        }

        loadingInProgress = true;
        const snapshotUrl = `${camera.snapshot_url}&t=${Date.now()}`;
        
        // Tạo ảnh ngầm (Preload)
        const img = new Image();
        
        img.onload = () => {
          if (!isCleanedUp) {
            // Load thành công -> Cập nhật UI
            setCurrentSnapshotUrl(snapshotUrl);
            setLoading(false);
            setError('');
            loadingInProgress = false;
          }
        };

        img.onerror = () => {
          if (!isCleanedUp) {
            // Load thất bại -> Giữ nguyên ảnh cũ, không set Error để tránh nháy
            // Chỉ log hoặc set error nếu chưa có ảnh nào
            if (!currentSnapshotUrl) {
                // Nếu chưa có ảnh nào thì mới báo lỗi
                 setError('Failed to load snapshot');
                 setLoading(false);
            } else {
                 // Nếu đã có ảnh cũ, coi như lượt này skip, vẫn giữ ảnh cũ
                 // User sẽ thấy ảnh cũ đứng yên một chút thay vì màn hình lỗi
            }
            loadingInProgress = false;
          }
        };

        // Bắt đầu load
        img.src = snapshotUrl;

      } catch {
        loadingInProgress = false;
        if (!isCleanedUp) {
           if (!currentSnapshotUrl) {
              setError('Failed to load snapshot');
              setLoading(false);
           }
        }
      }
    };

    // Load ngay lập tức
    loadSnapshot();

    // Refresh mỗi 2 giây
    intervalId = setInterval(() => {
      if (!isCleanedUp) {
        loadSnapshot();
      }
    }, 2000); // Tăng lên 2s để giảm tải nếu mạng kém

    return () => {
      isCleanedUp = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [camera.snapshot_url, camera.id, currentSnapshotUrl]);

  return (
    <div
      className="card bg-dark border-secondary text-white h-100 camera-thumbnail d-flex flex-column"
      style={{
        cursor: onClick ? 'pointer' : 'default',
        minHeight: 0,
        maxHeight: '100%',
        width: '100%',
        overflow: 'hidden',
        transition: 'border-color 0.2s ease',
      }}
      onClick={onClick}
    >
      <div
        className="card-header p-1 flex-shrink-0"
        style={{ minHeight: '24px', maxHeight: '24px', padding: '2px 4px' }}
      >
        <h6
          className="card-title mb-0 text-truncate"
          style={{ fontSize: '0.7rem', lineHeight: '1.2' }}
          title={`${camera.name} ${camera.nvr_name ? `(${camera.nvr_name})` : ''}`}
        >
          {camera.name}
          {camera.nvr_name && (
            <span className="text-secondary ms-1" style={{ fontSize: '0.6rem', opacity: 0.8 }}>
              • {camera.nvr_name}
            </span>
          )}
        </h6>
      </div>

      <div
        className="card-body p-0 position-relative video-container flex-grow-1"
        style={{
          minHeight: 0,
          overflow: 'hidden',
          width: '100%',
          height: '100%',
          background: '#000',
          position: 'relative',
          flex: '1 1 auto',
        }}
      >
        {loading && (
          <div className="position-absolute top-50 start-50 translate-middle" style={{ zIndex: 3 }}>
            <div className="spinner-border spinner-border-sm text-primary" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="position-absolute top-50 start-50 translate-middle w-75" style={{ zIndex: 3 }}>
            <div className="alert alert-danger mb-0 p-1" role="alert" style={{ fontSize: '0.75rem' }}>
              <i className="bi bi-exclamation-triangle me-1"></i>
              {error}
            </div>
          </div>
        )}

        <img
          src={currentSnapshotUrl || null}
          alt={camera.name}
          className="position-absolute top-0 start-0 w-100 h-100"
          style={{
            objectFit: 'contain',
            width: '100%',
            height: '100%',
            minWidth: 0,
            minHeight: 0,
            display: currentSnapshotUrl ? 'block' : 'none' 
          }}
        />
      </div>
    </div>
  );
};

export default VideoPlayerThumbnail;
