const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

export const parkingBackendApi = {
  async getBackends() {
    const response = await fetch(`${BACKEND_URL}/api/parking/backends`);
    if (!response.ok) throw new Error('Failed to fetch backends');
    const data = await response.json();
    return data.data || [];
  },

  async addBackend(backend) {
    const response = await fetch(`${BACKEND_URL}/api/parking/backends`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backend),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to add backend');
    }
    const data = await response.json();
    return data.data;
  },

  async removeBackend(backendId) {
    const response = await fetch(`${BACKEND_URL}/api/parking/backends/${backendId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to remove backend');
    return response.json();
  },

  async updateBackend(backendId, backend) {
    const response = await fetch(`${BACKEND_URL}/api/parking/backends/${backendId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backend),
    });
    if (!response.ok) throw new Error('Failed to update backend');
    const data = await response.json();
    return data.data;
  },

  // Logs
  async getLogs(params) {
    const searchParams = new URLSearchParams(params);
    const response = await fetch(`${BACKEND_URL}/api/parking-lock/logs?${searchParams}`);
    if (!response.ok) throw new Error('Failed to fetch logs');
    return response.json();
  },

  // Payments
  async getPaymentHistory(params) {
    const searchParams = new URLSearchParams(params);
    const response = await fetch(`${BACKEND_URL}/api/parking-lock/payments/history?${searchParams}`);
    if (!response.ok) throw new Error('Failed to fetch payment history');
    return response.json();
  },

  async getParkingSessions(params) {
    const searchParams = new URLSearchParams(params);
    const response = await fetch(`${BACKEND_URL}/api/parking-lock/payments/sessions?${searchParams}`);
    if (!response.ok) throw new Error('Failed to fetch sessions');
    return response.json();
  },

  async getPaymentStats(params) {
    const searchParams = new URLSearchParams(params);
    const response = await fetch(`${BACKEND_URL}/api/parking-lock/payments/stats?${searchParams}`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    return response.json();
  },

  // Settings
  // Settings
  async getGlobalConfig() {
    const response = await fetch(`${BACKEND_URL}/api/parking-lock/settings/global-config`);
    if (!response.ok) throw new Error('Failed to get config');
    return response.json();
  },

  async applyGlobalConfig(config) {
    const response = await fetch(`${BACKEND_URL}/api/parking-lock/settings/global-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!response.ok) throw new Error('Failed to apply config');
    return response.json();
  },
};
