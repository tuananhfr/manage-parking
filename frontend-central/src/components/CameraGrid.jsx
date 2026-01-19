import { useState, useMemo } from 'react';
import VideoPlayerThumbnail from './VideoPlayerThumbnail';

const CAMERAS_PER_PAGE = 16; // 4x4 grid

const CameraGrid = ({ cameras, onCameraClick, onReorder }) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [draggedCamera, setDraggedCamera] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Sort cameras theo order trước khi hiển thị
  const sortedCameras = useMemo(() => {
    return [...cameras].sort((a, b) => {
      const orderA = a.order !== undefined ? a.order : 999;
      const orderB = b.order !== undefined ? b.order : 999;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return (a.id || '').localeCompare(b.id || '');
    });
  }, [cameras]);

  // Tạo grid array với empty slots
  const gridArray = useMemo(() => {
    const maxOrder = sortedCameras.length > 0
      ? Math.max(...sortedCameras.map(c => c.order !== undefined ? c.order : 0))
      : -1;
    const gridSize = Math.max(CAMERAS_PER_PAGE, maxOrder + 1);

    const arr = Array(gridSize).fill(null);
    sortedCameras.forEach(camera => {
      const order = camera.order !== undefined ? camera.order : 999;
      if (order >= 0 && order < gridSize) {
        arr[order] = camera;
      }
    });
    return arr;
  }, [sortedCameras]);

  if (cameras.length === 0) {
    return (
      <div className="alert alert-info text-center m-5" role="alert">
        <i className="bi bi-camera-video-off fs-1 d-block mb-3"></i>
        <h4>Chưa có camera nào</h4>
        <p className="mb-0">Nhấn nút "Thêm" để bắt đầu xem video</p>
      </div>
    );
  }

  const gridSize = gridArray.length;

  const totalPages = Math.ceil(gridSize / CAMERAS_PER_PAGE);
  const startIndex = (currentPage - 1) * CAMERAS_PER_PAGE;
  const endIndex = startIndex + CAMERAS_PER_PAGE;
  const currentGridSlots = gridArray.slice(startIndex, endIndex);
  
  // Đảm bảo luôn có đủ 16 slots cho mỗi trang
  while (currentGridSlots.length < CAMERAS_PER_PAGE) {
    currentGridSlots.push(null);
  }

  const handleDragStart = (e, camera, index) => {
    const globalIndex = startIndex + index;
    setDraggedCamera({ camera, index: globalIndex, page: currentPage });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget.outerHTML);
    // Set opacity on the dragged element
    e.currentTarget.style.opacity = '0.5';
  };

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1';
    setDraggedCamera(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(startIndex + index);
  };

  const handleDrop = (e, dropIndex, isEmptySlot = false) => {
    e.preventDefault();
    // Chỉ cho phép drop trong cùng một trang
    if (draggedCamera && 
        draggedCamera.page === currentPage && 
        draggedCamera.index !== dropIndex && 
        onReorder) {
      // Sort cameras theo order để tìm đúng camera
      const sortedCamerasForDrop = [...cameras].sort((a, b) => {
        const orderA = a.order !== undefined ? a.order : 999;
        const orderB = b.order !== undefined ? b.order : 999;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return (a.id || '').localeCompare(b.id || '');
      });
      
      // Tìm camera được kéo
      const draggedCameraObj = sortedCamerasForDrop.find(c => c.id === draggedCamera.camera.id);
      if (!draggedCameraObj) {
        console.error('[Drop] Camera not found:', draggedCamera.camera.id);
        return;
      }
      
      const newOrder = sortedCamerasForDrop.filter(c => c.id !== draggedCameraObj.id);
      
      // Tính toán vị trí insert đúng
      let insertIndex;
      if (isEmptySlot) {
        // Drop vào empty slot: dropIndex là vị trí trong grid (bao gồm empty slots)
        // Ta muốn camera xuất hiện ở vị trí dropIndex trong grid
        // Vì dropIndex là vị trí trong grid, ta cần insert vào cuối array để camera xuất hiện ở vị trí đó
        // (vì empty slots không có trong cameras array)
        insertIndex = newOrder.length;
      } else {
        // Drop vào camera: dropIndex là vị trí trong cameras array
        // Sau khi remove camera, cần điều chỉnh:
        const draggedIndex = sortedCameras.findIndex(c => c.id === draggedCameraObj.id);
        insertIndex = draggedIndex < dropIndex ? dropIndex - 1 : dropIndex;
        insertIndex = Math.min(insertIndex, newOrder.length);
        insertIndex = Math.max(0, insertIndex);
      }
      
      // console.log('[Drop] draggedCamera.index:', draggedCamera.index, 'dropIndex:', dropIndex, 'isEmptySlot:', isEmptySlot, 'insertIndex:', insertIndex, 'newOrder.length before insert:', newOrder.length);
      
      newOrder.splice(insertIndex, 0, draggedCameraObj);
      
      // console.log('[Drop] newOrder after insert:', newOrder.map((c, i) => `${i}:${c?.id || 'undefined'}`).join(', '));
      
      // Create order map: camera_id -> order
      const orderMap = {};
      if (isEmptySlot) {
        // Khi drop vào empty slot, ta muốn camera xuất hiện ở đúng vị trí dropIndex trong grid
        // dropIndex là vị trí trong grid (bao gồm empty slots)
        // Ta set order của camera đó = dropIndex để nó xuất hiện ở đúng vị trí đó
        // Các camera khác giữ nguyên order hiện tại
        newOrder.forEach((cam) => {
          if (!cam) return; // Skip undefined
          if (cam.id === draggedCameraObj.id) {
            // Camera được drop: order = dropIndex (vị trí trong grid)
            orderMap[cam.id] = dropIndex;
          } else {
            // Các camera khác: giữ nguyên order hiện tại
            orderMap[cam.id] = cam.order !== undefined ? cam.order : 999;
          }
        });
      } else {
        // Drop vào camera: order = index trong array
        newOrder.forEach((cam, idx) => {
          if (!cam) return; // Skip undefined
          orderMap[cam.id] = idx;
        });
      }
      
      // console.log('[Drop] Final orderMap:', orderMap);
      
      onReorder(orderMap);
    }
    setDraggedCamera(null);
    setDragOverIndex(null);
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  return (
    <div className="camera-grid-container">
      {/* 4x4 Grid */}
      <div className="camera-grid">
        {currentGridSlots.map((slot, index) => {
          if (slot === null) {
            // Empty slot
            const globalIndex = startIndex + index;
            const isDragOverEmpty = dragOverIndex === globalIndex && 
                                    draggedCamera?.page === currentPage &&
                                    draggedCamera?.index !== globalIndex;
            
            return (
              <div
                key={`empty-${globalIndex}`}
                className={`d-flex h-100 w-100 overflow-hidden ${isDragOverEmpty ? 'drag-over' : ''}`}
                style={{ 
                  minHeight: 0, 
                  minWidth: 0,
                  cursor: draggedCamera && draggedCamera.page === currentPage ? 'move' : 'default'
                }}
                onDragOver={(e) => {
                  if (draggedCamera && draggedCamera.page === currentPage) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverIndex(globalIndex);
                  }
                }}
                onDrop={(e) => {
                  // console.log('[Empty Slot Drop] index:', index, 'emptySlotIndex (grid):', globalIndex);
                  handleDrop(e, globalIndex, true);
                }}
                onDragLeave={handleDragLeave}
              >
                <div className="card bg-dark border-secondary w-100 h-100 d-flex flex-column overflow-hidden">
                  <div
                    className="card-header p-1 flex-shrink-0"
                    style={{
                      minHeight: '24px',
                      maxHeight: '24px',
                      padding: '2px 4px',
                    }}
                  >
                    <h6
                      className="card-title mb-0 text-truncate text-secondary"
                      style={{ fontSize: '0.7rem', lineHeight: '1.2' }}
                    >
                      Trống
                    </h6>
                  </div>
                  <div className="card-body p-0 position-relative flex-grow-1 d-flex align-items-center justify-content-center overflow-hidden bg-black">
                    <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
                      {isDragOverEmpty ? 'Thả vào đây' : 'Trống'}
                    </span>
                  </div>
                </div>
              </div>
            );
          }
          
          // Camera slot
          const camera = slot;
          const globalIndex = startIndex + index;
          const isDragging = draggedCamera?.index === globalIndex;
          const isDragOver = dragOverIndex === globalIndex && 
                             draggedCamera?.index !== globalIndex &&
                             draggedCamera?.page === currentPage;
          
          return (
            <div
              key={camera.id}
              className={`d-flex h-100 w-100 overflow-hidden ${isDragOver ? 'drag-over' : ''}`}
              style={{ 
                minHeight: 0, 
                minWidth: 0,
                opacity: isDragging ? 0.5 : 1,
                cursor: onReorder ? 'move' : 'pointer'
              }}
              draggable={!!onReorder}
              onDragStart={(e) => handleDragStart(e, camera, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => {
                if (draggedCamera?.page === currentPage) {
                  handleDragOver(e, globalIndex);
                }
              }}
              onDrop={(e) => handleDrop(e, globalIndex)}
              onDragLeave={handleDragLeave}
            >
              <VideoPlayerThumbnail
                camera={camera}
                onClick={() => onCameraClick(camera)}
              />
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          className="position-absolute bottom-0 start-50 translate-middle-x bg-dark rounded p-1 mb-1"
          style={{ zIndex: 10, background: 'rgba(0, 0, 0, 0.8)' }}
        >
          <div className="d-flex justify-content-center align-items-center gap-2">
            <span className="text-white" style={{ fontSize: '0.75rem' }}>
              Trang:
            </span>
            <input
              type="number"
              min="1"
              max={totalPages}
              value={currentPage}
              onChange={(e) => {
                const value = parseInt(e.target.value);
                if (!isNaN(value) && value >= 1 && value <= totalPages) {
                  setCurrentPage(value);
                }
              }}
              onBlur={(e) => {
                const value = parseInt(e.target.value);
                if (isNaN(value) || value < 1) {
                  setCurrentPage(1);
                } else if (value > totalPages) {
                  setCurrentPage(totalPages);
                }
              }}
              className="form-control form-control-sm"
              style={{ 
                width: '60px', 
                fontSize: '0.75rem',
                textAlign: 'center',
                backgroundColor: '#212529',
                color: 'white',
                border: '1px solid #6c757d'
              }}
            />
            <span className="text-white" style={{ fontSize: '0.75rem' }}>
              / {totalPages}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default CameraGrid;
