import { useState, useEffect } from 'react';
import fetchWithAuth from '../../../utils/fetchWithAuth';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

const GlobalCleanupSettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [configs, setConfigs] = useState([]);
  const [formData, setFormData] = useState({
    recordings_retention_days: 30,
    timelapse_retention_days: 90,
    enabled: true,
    schedule: '03:00'
  });

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      setLoading(true);
      setError('');

      const response = await fetchWithAuth(`${BACKEND_URL}/api/nvr/servers/cleanup/config`);
      const data = await response.json();

      if (data.success && data.servers && data.servers.length > 0) {
        setConfigs(data.servers);

        // Use config from first reachable server as default
        const firstReachable = data.servers.find(s => s.reachable && s.config);
        if (firstReachable && firstReachable.config) {
          setFormData({
            recordings_retention_days: firstReachable.config.recordings_retention_days || 30,
            timelapse_retention_days: firstReachable.config.timelapse_retention_days || 90,
            enabled: firstReachable.config.enabled !== false,
            schedule: firstReachable.config.schedule || '03:00'
          });
        }
      }
    } catch (err) {
      console.error('Failed to load cleanup configs:', err);
      setError('Failed to load cleanup configurations');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      setSaving(true);
      setError('');
      setSuccess('');

      // Validate inputs
      if (formData.recordings_retention_days < 1 || formData.recordings_retention_days > 3650) {
        setError('Recordings retention days must be between 1 and 3650');
        return;
      }

      if (formData.timelapse_retention_days < 1 || formData.timelapse_retention_days > 3650) {
        setError('Timelapse retention days must be between 1 and 3650');
        return;
      }

      // Validate schedule format (HH:MM)
      const scheduleRegex = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
      if (!scheduleRegex.test(formData.schedule)) {
        setError('Schedule must be in HH:MM format (00:00 to 23:59)');
        return;
      }

      // Broadcast to all NVR servers
      const params = new URLSearchParams({
        recordings_retention_days: formData.recordings_retention_days,
        timelapse_retention_days: formData.timelapse_retention_days,
        enabled: formData.enabled,
        schedule: formData.schedule
      });

      const response = await fetchWithAuth(
        `${BACKEND_URL}/api/nvr/servers/cleanup/config?${params}`,
        { method: 'PUT' }
      );

      const data = await response.json();

      if (data.success) {
        setSuccess(
          `Cleanup config updated: ${data.updated} server(s) updated successfully` +
          (data.failed > 0 ? `, ${data.failed} failed` : '')
        );

        // Reload configs to show updated values
        setTimeout(() => {
          loadConfigs();
        }, 1000);
      } else {
        setError('Failed to update cleanup configuration');
      }
    } catch (err) {
      console.error('Failed to update cleanup config:', err);
      setError('Failed to update cleanup configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  if (loading) {
    return (
      <div className="text-center py-4">
        <div className="spinner-border spinner-border-sm text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <p className="text-muted mt-2 mb-0">Loading cleanup configurations...</p>
      </div>
    );
  }

  return (
    <div className="global-cleanup-settings">
      <div className="mb-3">
        <h6 className="mb-2">Auto-Delete Configuration (Global)</h6>
        <p className="text-muted small mb-3">
          Configure automatic cleanup of old recordings and timelapse videos across all NVR servers.
          Files older than the specified retention period will be automatically deleted daily at the scheduled time.
        </p>
      </div>

      {error && (
        <div className="alert alert-danger alert-dismissible fade show" role="alert">
          <i className="bi bi-exclamation-triangle-fill me-2"></i>
          {error}
          <button
            type="button"
            className="btn-close"
            onClick={() => setError('')}
            aria-label="Close"
          ></button>
        </div>
      )}

      {success && (
        <div className="alert alert-success alert-dismissible fade show" role="alert">
          <i className="bi bi-check-circle-fill me-2"></i>
          {success}
          <button
            type="button"
            className="btn-close"
            onClick={() => setSuccess('')}
            aria-label="Close"
          ></button>
        </div>
      )}

      {/* Show current config status from all servers */}
      {configs.length > 0 && (
        <div className="mb-3">
          <h6 className="mb-2" style={{ fontSize: '0.9rem' }}>Current NVR Servers Status:</h6>
          <div className="list-group list-group-flush" style={{ fontSize: '0.85rem' }}>
            {configs.map((server) => (
              <div
                key={server.nvr_id}
                className="list-group-item bg-dark border-secondary px-2 py-2"
              >
                <div className="d-flex justify-content-between align-items-start">
                  <div className="flex-grow-1">
                    <strong>{server.nvr_name}</strong>
                    {server.reachable ? (
                      <span className="badge bg-success ms-2" style={{ fontSize: '0.7rem' }}>
                        <i className="bi bi-check-circle me-1"></i>Online
                      </span>
                    ) : (
                      <span className="badge bg-danger ms-2" style={{ fontSize: '0.7rem' }}>
                        <i className="bi bi-x-circle me-1"></i>Offline
                      </span>
                    )}
                    {server.reachable && server.config && (
                      <div className="text-muted mt-1" style={{ fontSize: '0.75rem' }}>
                        Recordings: {server.config.recordings_retention_days}d |
                        Timelapse: {server.config.timelapse_retention_days}d |
                        Schedule: {server.config.schedule} |
                        {server.config.enabled ?
                          <span className="text-success">Enabled</span> :
                          <span className="text-danger">Disabled</span>
                        }
                      </div>
                    )}
                    {server.error && (
                      <div className="text-danger mt-1" style={{ fontSize: '0.7rem' }}>
                        Error: {server.error}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="row g-3">
          <div className="col-md-6">
            <label className="form-label">
              Recordings Retention (days)
              <span className="text-danger">*</span>
            </label>
            <input
              type="number"
              className="form-control form-control-sm"
              value={formData.recordings_retention_days}
              onChange={(e) => handleChange('recordings_retention_days', parseInt(e.target.value))}
              min="1"
              max="3650"
              required
              disabled={saving}
            />
            <small className="form-text text-muted">
              Delete recordings older than this many days (1-3650)
            </small>
          </div>

          <div className="col-md-6">
            <label className="form-label">
              Timelapse Retention (days)
              <span className="text-danger">*</span>
            </label>
            <input
              type="number"
              className="form-control form-control-sm"
              value={formData.timelapse_retention_days}
              onChange={(e) => handleChange('timelapse_retention_days', parseInt(e.target.value))}
              min="1"
              max="3650"
              required
              disabled={saving}
            />
            <small className="form-text text-muted">
              Delete timelapse videos older than this many days (1-3650)
            </small>
          </div>

          <div className="col-md-6">
            <label className="form-label">
              Cleanup Schedule (HH:MM)
              <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              className="form-control form-control-sm"
              value={formData.schedule}
              onChange={(e) => handleChange('schedule', e.target.value)}
              placeholder="03:00"
              pattern="([0-1][0-9]|2[0-3]):([0-5][0-9])"
              required
              disabled={saving}
            />
            <small className="form-text text-muted">
              Time to run cleanup daily (24-hour format, e.g., 03:00 for 3 AM)
            </small>
          </div>

          <div className="col-md-6">
            <label className="form-label">Auto-Cleanup Status</label>
            <div className="form-check form-switch">
              <input
                className="form-check-input"
                type="checkbox"
                checked={formData.enabled}
                onChange={(e) => handleChange('enabled', e.target.checked)}
                disabled={saving}
              />
              <label className="form-check-label">
                {formData.enabled ? 'Enabled' : 'Disabled'}
              </label>
            </div>
            <small className="form-text text-muted">
              Enable or disable automatic cleanup
            </small>
          </div>
        </div>

        <div className="mt-4 d-flex justify-content-between align-items-center">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={loadConfigs}
            disabled={saving || loading}
          >
            <i className="bi bi-arrow-clockwise me-1"></i>
            Refresh Status
          </button>

          <button
            type="submit"
            className="btn btn-sm btn-primary"
            disabled={saving}
          >
            {saving ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                Broadcasting...
              </>
            ) : (
              <>
                <i className="bi bi-broadcast me-1"></i>
                Apply to All NVR Servers
              </>
            )}
          </button>
        </div>
      </form>

      <div className="mt-3 p-2 bg-dark border border-secondary rounded" style={{ fontSize: '0.8rem' }}>
        <i className="bi bi-info-circle text-info me-2"></i>
        <strong>How it works:</strong>
        <ul className="mb-0 mt-1 ps-3">
          <li>Each NVR server runs its own cleanup scheduler based on this global configuration</li>
          <li>Cleanup runs automatically at the scheduled time every day</li>
          <li>Changes are broadcast to all NVR servers immediately</li>
          <li>Files older than the retention period are permanently deleted</li>
        </ul>
      </div>
    </div>
  );
};

export default GlobalCleanupSettings;
