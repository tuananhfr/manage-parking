const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

export const timelapseApi = {
  async createTimelapse({ source, intervalSeconds, file }) {
    const formData = new FormData();
    if (source) formData.append('source', source);
    if (file) formData.append('file', file);
    formData.append('intervalSeconds', intervalSeconds.toString());

    const response = await fetch(`${BACKEND_URL}/api/timelapse`, {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to create timelapse');
    }
    
    return response.json();
  },

  async listTimelapse() {
    const response = await fetch(`${BACKEND_URL}/api/timelapse`);
    if (!response.ok) throw new Error('Failed to list timelapse');
    const data = await response.json();
    return data.data || [];
  },

  async getConfig() {
    const response = await fetch(`${BACKEND_URL}/api/timelapse/config`);
    if (!response.ok) throw new Error('Failed to get config');
    const data = await response.json();
    return data.data;
  },

  async updateConfig(config) {
    const response = await fetch(`${BACKEND_URL}/api/timelapse/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!response.ok) throw new Error('Failed to update config');
    const data = await response.json();
    return data.data;
  },
};
