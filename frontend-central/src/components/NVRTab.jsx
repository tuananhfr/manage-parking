import { useState, useEffect, useCallback } from 'react';

const NVRTab = ({ showManageNVR, onCloseManageNVR }) => {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newServer, setNewServer] = useState({
    id: '',
    name: '',
    host: '',
    port: 5000,
    device_id: '',
    description: '',
    enabled: true,
  });
  const [showServerDetail, setShowServerDetail] = useState(false);
  const [selectedServer, setSelectedServer] = useState(null);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

  const loadServers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${BACKEND_URL}/api/nvr/servers`);
      if (!response.ok) throw new Error('Không thể tải danh sách NVR');
      const result = await response.json();
      const data = result.data || result;
      setServers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading NVR servers:', error);
      alert('Không thể tải danh sách NVR');
    } finally {
      setLoading(false);
    }
  }, [BACKEND_URL]);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const handleAddServer = async (e) => {
    e.preventDefault();
    if (!newServer.id || !newServer.name || !newServer.host || !newServer.port || !newServer.device_id) {
      alert('Vui lòng điền đầy đủ các trường bắt buộc');
      return;
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/nvr/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newServer),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Thêm NVR thất bại');
      }

      setNewServer({
        id: '',
        name: '',
        host: '',
        port: 5000,
        device_id: '',
        description: '',
        enabled: true,
      });
      onCloseManageNVR();
      loadServers();
    } catch (error) {
      alert(error.message);
    }
  };

  const handleDeleteServer = async (serverId) => {
    if (!confirm('Bạn có chắc chắn muốn xóa NVR này?')) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/nvr/servers/${serverId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Xóa NVR thất bại');
      loadServers();
    } catch (error) {
      alert(error.message);
    }
  };

  const handleToggleServer = async (server) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/nvr/servers/${server.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !server.enabled }),
      });

      if (!response.ok) throw new Error('Cập nhật NVR thất bại');
      loadServers();
    } catch (error) {
      alert(error.message);
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
    <div className="h-100" style={{ overflow: 'auto' }}>
      <div className="p-4">
        <div className="row">
          <div className="col-12">
            <h4 className="text-white mb-4">
              <i className="bi bi-camera-video me-2"></i>
              Máy chủ NVR (Unified App)
            </h4>

            {servers.length === 0 ? (
              <div className="card bg-dark border-secondary text-white">
                <div className="card-body text-center py-5">
                  <i className="bi bi-camera-video" style={{ fontSize: '3rem', opacity: 0.3 }}></i>
                  <p className="mt-3 text-secondary">Chưa có cấu hình máy chủ NVR.</p>
                  <p className="text-secondary">Nhấn "Thêm NVR" để thêm máy chủ unified_app.</p>
                </div>
              </div>
            ) : (
              <div className="row g-3">
                {servers.map((server) => (
                  <div key={server.id} className="col-12 col-md-6 col-lg-4">
                    <div
                      className="card bg-dark border-secondary text-white h-100"
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSelectedServer(server);
                        setShowServerDetail(true);
                      }}
                    >
                      <div className="card-header d-flex justify-content-between align-items-center">
                        <h6 className="mb-0">{server.name}</h6>
                        <div className="form-check form-switch" onClick={(e) => e.stopPropagation()}>
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={server.enabled}
                            onChange={() => handleToggleServer(server)}
                            title={server.enabled ? 'Vô hiệu hóa' : 'Kích hoạt'}
                          />
                        </div>
                      </div>
                      <div className="card-body">
                        <div className="mb-2">
                          <small className="text-secondary">Máy chủ:</small>
                          <div className="text-white">{server.host}:{server.port}</div>
                        </div>
                        <div className="mb-2">
                          <small className="text-secondary">ID Thiết bị:</small>
                          <div className="text-white font-monospace" style={{ fontSize: '0.85rem' }}>
                            {server.device_id}
                          </div>
                        </div>
                        {server.description && (
                          <div className="mb-2">
                            <small className="text-secondary">Mô tả:</small>
                            <div className="text-white text-truncate">{server.description}</div>
                          </div>
                        )}
                        <div className="mt-3">
                          <span
                            className={`badge ${server.enabled ? 'bg-success' : 'bg-secondary'}`}
                          >
                            {server.enabled ? 'Đã kích hoạt' : 'Đã vô hiệu hóa'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add NVR Server Modal */}
      {showManageNVR && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content bg-dark text-white border-secondary">
                <div className="modal-header border-secondary">
                  <h5 className="modal-title">
                    <i className="bi bi-plus-circle me-2"></i>Thêm NVR
                  </h5>
                  <button
                    type="button"
                    className="btn-close btn-close-white"
                    onClick={onCloseManageNVR}
                  ></button>
                </div>
                <form onSubmit={handleAddServer}>
                  <div className="modal-body">
                    <div className="mb-3">
                      <label className="form-label">
                        Server ID <span className="text-danger">*</span>
                      </label>
                      <input
                        type="text"
                        className="form-control bg-dark text-white border-secondary"
                        placeholder="nvr_1"
                        value={newServer.id}
                        onChange={(e) => setNewServer({ ...newServer, id: e.target.value })}
                        required
                      />
                      <small className="text-secondary">Định danh duy nhất (Unique identifier)</small>
                    </div>
                    <div className="mb-3">
                      <label className="form-label">
                        Tên <span className="text-danger">*</span>
                      </label>
                      <input
                        type="text"
                        className="form-control bg-dark text-white border-secondary"
                        placeholder="Khu A NVR"
                        value={newServer.name}
                        onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="row">
                      <div className="col-8 mb-3">
                        <label className="form-label">
                          Máy chủ <span className="text-danger">*</span>
                        </label>
                        <input
                          type="text"
                          className="form-control bg-dark text-white border-secondary"
                          placeholder="192.168.1.100"
                          value={newServer.host}
                          onChange={(e) => setNewServer({ ...newServer, host: e.target.value })}
                          required
                        />
                      </div>
                      <div className="col-4 mb-3">
                        <label className="form-label">
                          Cổng <span className="text-danger">*</span>
                        </label>
                        <input
                          type="number"
                          className="form-control bg-dark text-white border-secondary"
                          placeholder="5000"
                          min="1"
                          max="65535"
                          value={newServer.port}
                          onChange={(e) =>
                            setNewServer({ ...newServer, port: parseInt(e.target.value) || 5000 })
                          }
                          required
                        />
                      </div>
                    </div>
                    <div className="mb-3">
                      <label className="form-label">
                        ID Thiết bị <span className="text-danger">*</span>
                      </label>
                      <input
                        type="text"
                        className="form-control bg-dark text-white border-secondary"
                        placeholder="parking-edge-001"
                        value={newServer.device_id}
                        onChange={(e) => setNewServer({ ...newServer, device_id: e.target.value })}
                        required
                      />
                      <small className="text-secondary">Phải khớp với device_id trong config.yaml</small>
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Mô tả</label>
                      <textarea
                        className="form-control bg-dark text-white border-secondary"
                        rows="2"
                        placeholder="Mô tả tùy chọn..."
                        value={newServer.description}
                        onChange={(e) =>
                          setNewServer({ ...newServer, description: e.target.value })
                        }
                      />
                    </div>
                    <div className="form-check form-switch">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={newServer.enabled}
                        onChange={(e) =>
                          setNewServer({ ...newServer, enabled: e.target.checked })
                        }
                      />
                      <label className="form-check-label">Kích hoạt server</label>
                    </div>
                  </div>
                  <div className="modal-footer border-secondary">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={onCloseManageNVR}
                    >
                      Hủy
                    </button>
                    <button type="submit" className="btn btn-primary">
                      <i className="bi bi-plus-circle me-2"></i>Thêm Server
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" onClick={onCloseManageNVR}></div>
        </>
      )}

      {/* NVR Server Detail Modal */}
      {showServerDetail && selectedServer && (
        <>
          <div className="modal fade show d-block" tabIndex={-1}>
            <div className="modal-dialog modal-lg modal-dialog-centered">
              <div className="modal-content bg-dark text-white border-secondary">
                <div className="modal-header border-secondary">
                  <h5 className="modal-title">
                    <i className="bi bi-camera-video me-2"></i>
                    {selectedServer.name}
                  </h5>
                  <button
                    type="button"
                    className="btn-close btn-close-white"
                    onClick={() => setShowServerDetail(false)}
                  ></button>
                </div>
                <div className="modal-body">
                  <div className="row g-3">
                    <div className="col-12">
                      <div className="card bg-black border-secondary">
                        <div className="card-body">
                          <h6 className="text-secondary mb-3">Thông tin Server</h6>
                          <table className="table table-dark table-borderless mb-0">
                            <tbody>
                              <tr>
                                <td className="text-secondary" style={{ width: '30%' }}>ID:</td>
                                <td className="font-monospace">{selectedServer.id}</td>
                              </tr>
                              <tr>
                                <td className="text-secondary">Tên:</td>
                                <td>{selectedServer.name}</td>
                              </tr>
                              <tr>
                                <td className="text-secondary">Máy chủ:</td>
                                <td>{selectedServer.host}</td>
                              </tr>
                              <tr>
                                <td className="text-secondary">Cổng:</td>
                                <td>{selectedServer.port}</td>
                              </tr>
                              <tr>
                                <td className="text-secondary">ID Thiết bị:</td>
                                <td className="font-monospace">{selectedServer.device_id}</td>
                              </tr>
                              <tr>
                                <td className="text-secondary">URL:</td>
                                <td>
                                  <a
                                    href={`http://${selectedServer.host}:${selectedServer.port}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary"
                                  >
                                    http://{selectedServer.host}:{selectedServer.port}
                                    <i className="bi bi-box-arrow-up-right ms-2"></i>
                                  </a>
                                </td>
                              </tr>
                              {selectedServer.description && (
                                <tr>
                                  <td className="text-secondary">Mô tả:</td>
                                  <td>{selectedServer.description}</td>
                                </tr>
                              )}
                              <tr>
                                <td className="text-secondary">Trạng thái:</td>
                                <td>
                                  <span
                                    className={`badge ${
                                      selectedServer.enabled ? 'bg-success' : 'bg-secondary'
                                    }`}
                                  >
                                    {selectedServer.enabled ? 'Đã kích hoạt' : 'Đã vô hiệu hóa'}
                                  </span>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    <div className="col-12">
                      <div className="card bg-black border-secondary">
                        <div className="card-body">
                          <h6 className="text-secondary mb-3">Hành động</h6>
                          <div className="d-flex gap-2">
                            <button
                              className={`btn ${selectedServer.enabled ? 'btn-warning' : 'btn-success'}`}
                              onClick={() => {
                                handleToggleServer(selectedServer);
                                setShowServerDetail(false);
                              }}
                            >
                              <i className={`bi ${selectedServer.enabled ? 'bi-pause-circle' : 'bi-play-circle'} me-2`}></i>
                              {selectedServer.enabled ? 'Vô hiệu hóa' : 'Kích hoạt'} Server
                            </button>
                            <button
                              className="btn btn-danger"
                              onClick={() => {
                                handleDeleteServer(selectedServer.id);
                                setShowServerDetail(false);
                              }}
                            >
                              <i className="bi bi-trash me-2"></i>Xóa Server
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="modal-footer border-secondary">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowServerDetail(false)}
                  >
                    Đóng
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" onClick={() => setShowServerDetail(false)}></div>
        </>
      )}
    </div>
  );
};

export default NVRTab;
