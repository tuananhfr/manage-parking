import { useState, useEffect } from 'react';
import fetchWithAuth from '../../../utils/fetchWithAuth';
import GlobalCleanupSettings from './GlobalCleanupSettings';
import TimelapseSettingsModal from '../../TimelapseSettingsModal';

const NVRServerSettings = () => {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showTimelapseSettings, setShowTimelapseSettings] = useState(false);
  const [editingServer, setEditingServer] = useState(null);
  const [newServer, setNewServer] = useState({
    id: '',
    name: '',
    host: '',
    port: 5000,
    device_id: '',
    description: '',
  });
  const [message, setMessage] = useState(null);

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      setLoading(true);
      const response = await fetchWithAuth(`${BACKEND_URL}/api/nvr/servers`);
      if (!response.ok) throw new Error('Failed to fetch NVR servers');
      const result = await response.json();
      const data = result.data || result;
      setServers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading NVR servers:', error);
      setMessage({ type: 'error', text: 'Không thể tải danh sách NVR servers' });
    } finally {
      setLoading(false);
    }
  };

  const handleAddServer = async () => {
    if (!newServer.id || !newServer.name || !newServer.host || !newServer.port || !newServer.device_id) {
      setMessage({ type: 'error', text: 'Vui lòng điền đầy đủ thông tin bắt buộc' });
      return;
    }

    try {
      const response = await fetchWithAuth(`${BACKEND_URL}/api/nvr/servers`, {
        method: 'POST',
        body: JSON.stringify(newServer),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to add NVR server');
      }

      setNewServer({
        id: '',
        name: '',
        host: '',
        port: 5000,
        device_id: '',
        description: '',
      });
      setShowAddForm(false);
      setMessage({ type: 'success', text: 'Đã thêm NVR server thành công' });
      loadServers();
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const handleDeleteServer = async (serverId) => {
    if (!confirm('Bạn có chắc muốn xóa NVR server này?')) return;

    try {
      const response = await fetchWithAuth(`${BACKEND_URL}/api/nvr/servers/${serverId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete NVR server');
      setMessage({ type: 'success', text: 'Đã xóa NVR server' });
      loadServers();
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const handleToggleServer = async (server) => {
    try {
      const response = await fetchWithAuth(`${BACKEND_URL}/api/nvr/servers/${server.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !server.enabled }),
      });

      if (!response.ok) throw new Error('Failed to update NVR server');
      loadServers();
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const handleEditServer = (server) => {
    setEditingServer({...server});
    setShowAddForm(false);
  };

  const handleUpdateServer = async () => {
    if (!editingServer.name || !editingServer.host || !editingServer.port || !editingServer.device_id) {
      setMessage({ type: 'error', text: 'Vui lòng điền đầy đủ thông tin bắt buộc' });
      return;
    }

    try {
      const response = await fetchWithAuth(`${BACKEND_URL}/api/nvr/servers/${editingServer.id}`, {
        method: 'PUT',
        body: JSON.stringify(editingServer),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to update NVR server');
      }

      setEditingServer(null);
      setMessage({ type: 'success', text: 'Đã cập nhật NVR server thành công' });
      loadServers();
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  const handleCancelEdit = () => {
    setEditingServer(null);
  };

  if (loading) {
    return (
      <div className="text-center py-4">
        <div className="spinner-border text-primary"></div>
      </div>
    );
  }

  return (
    <div>
      <h6 className="border-bottom pb-2 mb-3">
        <i className="bi bi-hdd-rack me-2"></i>
        NVR Servers (Unified App)
      </h6>

      {message && (
        <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'} alert-dismissible`}>
          {message.text}
          <button
            type="button"
            className="btn-close"
            onClick={() => setMessage(null)}
          ></button>
        </div>
      )}

      <div className="d-flex justify-content-between align-items-center mb-3">
        <p className="text-muted mb-0">
          <i className="bi bi-info-circle me-1"></i>
          Quản lý các NVR servers (camera trong bãi đỗ xe)
        </p>
        <div className="d-flex gap-2">
          <button
            className="btn btn-sm btn-outline-info"
            onClick={() => setShowTimelapseSettings(true)}
          >
            <i className="bi bi-clock-history me-1"></i>
            Cài đặt Timelapse
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <i className="bi bi-plus-circle me-1"></i>
            Thêm NVR Server
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="card mb-3 bg-dark border-primary">
          <div className="card-body">
            <h6 className="card-title text-primary">
              <i className="bi bi-plus-circle me-2"></i>
              Thêm NVR Server mới
            </h6>
            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label small">
                  Server ID <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="nvr_1"
                  value={newServer.id}
                  onChange={(e) => setNewServer({ ...newServer, id: e.target.value })}
                />
                <small className="text-muted">ID duy nhất cho server</small>
              </div>
              <div className="col-md-6">
                <label className="form-label small">
                  Tên <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="Khu A NVR"
                  value={newServer.name}
                  onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                />
              </div>
              <div className="col-md-5">
                <label className="form-label small">
                  Host <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="192.168.1.100"
                  value={newServer.host}
                  onChange={(e) => setNewServer({ ...newServer, host: e.target.value })}
                />
              </div>
              <div className="col-md-2">
                <label className="form-label small">
                  Port <span className="text-danger">*</span>
                </label>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  min="1"
                  max="65535"
                  value={newServer.port}
                  onChange={(e) => setNewServer({ ...newServer, port: parseInt(e.target.value) || 5000 })}
                />
              </div>
              <div className="col-md-5">
                <label className="form-label small">
                  Device ID <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="parking-edge-001"
                  value={newServer.device_id}
                  onChange={(e) => setNewServer({ ...newServer, device_id: e.target.value })}
                />
                <small className="text-muted">Phải khớp với device_id trong config.yaml của unified_app</small>
              </div>
              <div className="col-md-12">
                <label className="form-label small">Mô tả</label>
                <textarea
                  className="form-control form-control-sm"
                  rows="2"
                  placeholder="Mô tả server..."
                  value={newServer.description}
                  onChange={(e) => setNewServer({ ...newServer, description: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-2 d-flex gap-2">
              <button className="btn btn-sm btn-success" onClick={handleAddServer}>
                <i className="bi bi-check-circle me-1"></i>
                Thêm
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  setShowAddForm(false);
                  setNewServer({
                    id: '',
                    name: '',
                    host: '',
                    port: 5000,
                    device_id: '',
                    description: '',
                  });
                }}
              >
                <i className="bi bi-x-circle me-1"></i>
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Form */}
      {editingServer && (
        <div className="card mb-3 bg-dark border-warning">
          <div className="card-body">
            <h6 className="card-title text-warning">
              <i className="bi bi-pencil-square me-2"></i>
              Chỉnh sửa NVR Server: {editingServer.id}
            </h6>
            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label small">
                  Tên <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={editingServer.name}
                  onChange={(e) => setEditingServer({ ...editingServer, name: e.target.value })}
                />
              </div>
              <div className="col-md-5">
                <label className="form-label small">
                  Host <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={editingServer.host}
                  onChange={(e) => setEditingServer({ ...editingServer, host: e.target.value })}
                />
              </div>
              <div className="col-md-2">
                <label className="form-label small">
                  Port <span className="text-danger">*</span>
                </label>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={editingServer.port}
                  onChange={(e) => setEditingServer({ ...editingServer, port: parseInt(e.target.value) || 5000 })}
                />
              </div>
              <div className="col-md-5">
                <label className="form-label small">
                  Device ID <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={editingServer.device_id}
                  onChange={(e) => setEditingServer({ ...editingServer, device_id: e.target.value })}
                />
              </div>
              <div className="col-md-12">
                <label className="form-label small">Mô tả</label>
                <textarea
                  className="form-control form-control-sm"
                  rows="2"
                  value={editingServer.description || ''}
                  onChange={(e) => setEditingServer({ ...editingServer, description: e.target.value })}
                />
              </div>
            </div>
            <div className="mt-2 d-flex gap-2">
              <button className="btn btn-sm btn-success" onClick={handleUpdateServer}>
                <i className="bi bi-check-circle me-1"></i>
                Cập nhật
              </button>
              <button className="btn btn-sm btn-secondary" onClick={handleCancelEdit}>
                <i className="bi bi-x-circle me-1"></i>
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {servers.length === 0 ? (
        <div className="alert alert-info">
          <i className="bi bi-info-circle me-2"></i>
          Chưa có NVR server nào. Click "Thêm NVR Server" để thêm.
        </div>
      ) : (
        servers.map((server) => (
          <div key={server.id} className={`card mb-2 bg-dark ${editingServer?.id === server.id ? 'border-warning' : 'border-secondary'}`}>
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-start">
                <div className="flex-grow-1">
                  <h6 className="card-title mb-1 text-white">
                    <span className="badge bg-secondary me-2">{server.id}</span>
                    {server.name}
                  </h6>
                  <div className="small text-white-50">
                    <div>
                      <i className="bi bi-hdd-network me-1"></i>
                      Host: <code className="text-info">{server.host}:{server.port}</code>
                    </div>
                    <div>
                      <i className="bi bi-cpu me-1"></i>
                      Device ID: <code className="text-info">{server.device_id}</code>
                    </div>
                    {server.description && (
                      <div>
                        <i className="bi bi-info-circle me-1"></i>
                        {server.description}
                      </div>
                    )}
                    <div className="mt-1">
                      <i className="bi bi-link-45deg me-1"></i>
                      <a
                        href={`http://${server.host}:${server.port}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-decoration-none text-info"
                      >
                        http://{server.host}:{server.port}
                        <i className="bi bi-box-arrow-up-right ms-1"></i>
                      </a>
                    </div>
                  </div>
                </div>
                <div className="d-flex gap-2">
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => handleEditServer(server)}
                    title="Chỉnh sửa"
                  >
                    <i className="bi bi-pencil"></i>
                  </button>
                  <button
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => handleDeleteServer(server.id)}
                    title="Xóa server"
                  >
                    <i className="bi bi-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))
      )}

      {/* Auto-Delete Settings Section */}
      <div className="mt-4 pt-3 border-top border-secondary">
        <GlobalCleanupSettings />
      </div>

      <TimelapseSettingsModal
        show={showTimelapseSettings}
        onClose={() => setShowTimelapseSettings(false)}
      />
    </div>
  );
};

export default NVRServerSettings;
