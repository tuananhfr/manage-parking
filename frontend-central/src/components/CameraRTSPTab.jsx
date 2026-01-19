import { useState, useEffect, useCallback } from "react";
import CameraGrid from "./CameraGrid";
import CameraModal from "./CameraModal";
import fetchWithAuth from "../utils/fetchWithAuth";

import { CENTRAL_URL } from "../config";

const CameraRTSPTab = ({ showAddModal, onCloseAddModal, user }) => {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [nvrs, setNvrs] = useState([]);  // List of NVR servers
  const [newCamera, setNewCamera] = useState({
    id: "",
    name: "",
    url: "",
    type: "rtsp",
    nvr_id: "", // Selected NVR
    enable_detection: true,
  });

  const BACKEND_URL = CENTRAL_URL;



  const loadNvrs = useCallback(async () => {
    try {
        const response = await fetchWithAuth(`${BACKEND_URL}/api/nvr/servers`);
        if (response.ok) {
            const resultData = await response.json();
            if (resultData.success && Array.isArray(resultData.data)) {
                setNvrs(resultData.data.filter(n => n.enabled));
                // Set default NVR if available
                if (resultData.data.length > 0) {
                    setNewCamera(prev => {
                        if (!prev.nvr_id) {
                            return { ...prev, nvr_id: resultData.data[0].id };
                        }
                        return prev;
                    });
                }
            }
        }
    } catch (error) {
        console.error("Error loading NVRs:", error);
    }
  }, [BACKEND_URL]);

  const loadCameras = useCallback(async () => {
    try {
    
      const response = await fetchWithAuth(`${BACKEND_URL}/api/rtsp-cameras`);
      if (!response.ok) throw new Error(`Không thể tải camera: ${response.status} ${response.statusText}`);
      
      const data = await response.json();
      
      const camerasList = Array.isArray(data) ? data : [];

      // Normalize orders: If order is missing, assign based on index to ensure visibility
      // CameraGrid defaults undefined order to 999, which pushes cameras to page 60+
      const camerasWithOrder = camerasList.map((cam, idx) => ({
        ...cam,
        order: (cam.order !== undefined && cam.order !== null) ? cam.order : idx
      }));

      // Sort cameras theo order
      const sortedCameras = [...camerasWithOrder].sort((a, b) => {
        const orderA = a.order;
        const orderB = b.order;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        // Nếu order giống nhau, sort theo id
        return (a.id || "").localeCompare(b.id || "");
      });

      setCameras(sortedCameras);

      // Update selectedCamera nếu đang mở modal
      if (selectedCamera) {
        const updatedCamera = sortedCameras.find(
          (c) => c.id === selectedCamera.id
        );
        if (updatedCamera) {
          setSelectedCamera(updatedCamera);
        }
      }
    } catch (error) {
      console.error("Error loading cameras:", error);
      alert("Không thể tải danh sách camera");
    } finally {
      setLoading(false);
    }
  }, [BACKEND_URL, selectedCamera]);

  useEffect(() => {
    loadCameras();
    loadNvrs(); // Load NVR list
  }, [loadCameras, loadNvrs]);

  const handleAddCamera = async (e) => {
    e.preventDefault();
    if (!newCamera.id || !newCamera.name || !newCamera.url || !newCamera.nvr_id) {
      alert("Vui lòng điền đầy đủ thông tin, bao gồm NVR");
      return;
    }

    try {
      const response = await fetchWithAuth(`${BACKEND_URL}/api/rtsp-cameras`, {
        method: "POST",
        body: JSON.stringify(newCamera),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Thêm camera thất bại");
      }

      // Optimistic update: thêm camera vào list ngay lập tức
      const addedCamera = await response.json();
      setCameras((prev) => [...prev, addedCamera]);

      // Reset form (keep current nvr_id or reset to first?)
      setNewCamera({ id: "", name: "", url: "", type: "rtsp", nvr_id: newCamera.nvr_id || "", enable_detection: true });
      onCloseAddModal();

      // Reload sau 500ms để đảm bảo sync với backend (không block UI)
      setTimeout(() => {
        loadCameras();
      }, 500);
    } catch (error) {
      alert(error.message);
      // Reload để đảm bảo sync nếu có lỗi
      loadCameras();
    }
  };

  const handleDeleteCamera = async (cameraId) => {
    if (!confirm("Bạn có chắc chắn muốn xóa camera này?")) return;

    try {
      // Optimistic update: xóa camera khỏi list ngay lập tức
      setCameras((prev) => prev.filter((c) => c.id !== cameraId));

      const response = await fetchWithAuth(
        `${BACKEND_URL}/api/rtsp-cameras/${cameraId}`,
        {
          method: "DELETE",
        }
      );

      if (!response.ok) {
        throw new Error("Xóa thất bại");
      }

      // Reload sau 500ms để đảm bảo sync với backend (không block UI)
      setTimeout(() => {
        loadCameras();
      }, 500);
    } catch (error) {
      alert(error.message);
      // Reload để đảm bảo sync nếu có lỗi
      loadCameras();
    }
  };

  const handleUpdateCamera = async (cameraId, updatedData) => {
    try {
      // Optimistic update: update camera trong list ngay lập tức
      setCameras((prev) =>
        prev.map((c) => (c.id === cameraId ? { ...c, ...updatedData } : c))
      );

      // Update selectedCamera ngay lập tức để modal hiển thị đúng
      setSelectedCamera((prev) => {
        if (prev && prev.id === cameraId) {
          return {
            ...prev,
            ...updatedData,
          };
        }
        return prev;
      });

      const response = await fetchWithAuth(
        `${BACKEND_URL}/api/rtsp-cameras/${cameraId}`,
        {
          method: "PUT",
          body: JSON.stringify(updatedData),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || "Cập nhật camera thất bại");
      }

      // Reload sau 500ms để đảm bảo sync với backend (không block UI)
      setTimeout(() => {
        loadCameras();
      }, 500);

      return true;
    } catch (error) {
      alert(error.message);
      // Reload để đảm bảo sync nếu có lỗi
      loadCameras();
      return false;
    }
  };

  const handleCameraClick = (camera) => {
    setSelectedCamera(camera);
    setShowCameraModal(true);
  };

  const handleReorderCameras = async (orderMap) => {
    try {
      // Log để debug
      // console.log("[Reorder] Order map:", orderMap);
      /* console.log(
        "[Reorder] Current cameras:",
        cameras.map((c) => ({ id: c.id, name: c.name }))
      ); */

      // Optimistic update: reorder cameras trong list ngay lập tức
      const updatedCameras = cameras.map((cam) => ({
        ...cam,
        order:
          orderMap[cam.id] !== undefined
            ? orderMap[cam.id]
            : cam.order !== undefined
            ? cam.order
            : 999,
      }));

      // Sort theo order mới
      const sortedCameras = updatedCameras.sort((a, b) => {
        const orderA = a.order !== undefined ? a.order : 999;
        const orderB = b.order !== undefined ? b.order : 999;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        // Nếu order giống nhau, sort theo id
        return (a.id || "").localeCompare(b.id || "");
      });

      setCameras(sortedCameras);

      // Gọi API để lưu thứ tự mới
      const response = await fetchWithAuth(`${BACKEND_URL}/api/rtsp-cameras/reorder`, {
        method: "PUT",
        body: JSON.stringify(orderMap),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: `HTTP ${response.status}` }));
        console.error("[Reorder] API error:", errorData);
        throw new Error(
          errorData.detail || `Sắp xếp camera thất bại: ${response.status}`
        );
      }

      await response.json();
      // console.log("[Reorder] Success:", result);

      // Reload sau 500ms để đảm bảo sync với backend
      setTimeout(() => {
        loadCameras();
      }, 500);
    } catch (error) {
      console.error("[Reorder] Error:", error);
      alert(error.message || "Không thể sắp xếp lại camera");
      // Reload để đảm bảo sync nếu có lỗi
      loadCameras();
    }
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center h-100">
        <div className="spinner-border text-primary"></div>
      </div>
    );
  }

  return (
    <div className="d-flex flex-column h-100" style={{ overflow: "hidden" }}>
      {/* Camera Grid - Full height, no header */}
      <div className="h-100" style={{ minHeight: 0, overflow: "hidden" }}>
        <CameraGrid
          cameras={cameras}
          onCameraClick={handleCameraClick}
          onReorder={handleReorderCameras}
        />
      </div>

      {/* Add Camera Modal */}
      {showAddModal && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content bg-dark text-white border-secondary">
                <div className="modal-header border-secondary">
                  <h5 className="modal-title">Thêm Camera Mới</h5>
                  <button
                    type="button"
                    className="btn-close btn-close-white"
                    onClick={onCloseAddModal}
                  ></button>
                </div>
                <form onSubmit={handleAddCamera}>
                  <div className="modal-body">
                    <div className="mb-3">
                        <label className="form-label">Chọn NVR *</label>
                        <select
                            className="form-select bg-dark text-white border-secondary"
                            value={newCamera.nvr_id}
                            onChange={(e) => setNewCamera({ ...newCamera, nvr_id: e.target.value })}
                            required
                        >
                            <option value="">-- Chọn NVR --</option>
                            {nvrs.map(nvr => (
                                <option key={nvr.id} value={nvr.id}>
                                    {nvr.name} ({nvr.host})
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Camera ID *</label>
                      <input
                        type="text"
                        className="form-control bg-dark text-white border-secondary"
                        placeholder="camera_1"
                        value={newCamera.id}
                        onChange={(e) =>
                          setNewCamera({ ...newCamera, id: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Tên *</label>
                      <input
                        type="text"
                        className="form-control bg-dark text-white border-secondary"
                        placeholder="Front Door"
                        value={newCamera.name}
                        onChange={(e) =>
                          setNewCamera({ ...newCamera, name: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">RTSP URL *</label>
                      <input
                        type="text"
                        className="form-control bg-dark text-white border-secondary"
                        placeholder="rtsp://..."
                        value={newCamera.url}
                        onChange={(e) =>
                          setNewCamera({ ...newCamera, url: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Loại</label>
                      <select
                        className="form-select bg-dark text-white border-secondary"
                        value={newCamera.type}
                        onChange={(e) =>
                          setNewCamera({ ...newCamera, type: e.target.value })
                        }
                      >
                        <option value="rtsp">RTSP</option>
                        <option value="public">Công khai</option>
                      </select>
                    </div>
                    <div className="mb-3">
                      <div className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="newCameraDetection"
                          checked={newCamera.enable_detection}
                          onChange={(e) =>
                            setNewCamera({ ...newCamera, enable_detection: e.target.checked })
                          }
                        />
                        <label className="form-check-label text-white" htmlFor="newCameraDetection">
                          Bật Nhận Diện AI
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="modal-footer border-secondary">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={onCloseAddModal}
                    >
                      Hủy
                    </button>
                    <button type="submit" className="btn btn-primary">
                      <i className="bi bi-plus-circle me-2"></i>Thêm
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
          <div
            className="modal-backdrop fade show"
            onClick={onCloseAddModal}
          ></div>
        </>
      )}

      {/* Camera Detail Modal */}
      {showCameraModal && selectedCamera && (
        <CameraModal
          key={selectedCamera.id}
          camera={selectedCamera}
          onClose={() => setShowCameraModal(false)}
          canEdit={user?.role === "manager"}
          onDelete={() => {
            handleDeleteCamera(selectedCamera.id);
            setShowCameraModal(false);
          }}
          onUpdate={(cameraId, updatedData) => {
            handleUpdateCamera(cameraId, updatedData);
          }}
        />
      )}
    </div>
  );
};

export default CameraRTSPTab;
