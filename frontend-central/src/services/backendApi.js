const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

export const backendApi = {
  async getCameras() {
    const response = await fetch(`${BACKEND_URL}/api/cameras`);
    if (!response.ok) throw new Error('Failed to fetch cameras');
    return response.json();
  },

  async addCamera(camera) {
    const response = await fetch(`${BACKEND_URL}/api/cameras`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(camera),
    });
    if (!response.ok) throw new Error('Failed to add camera');
    return response.json();
  },

  async updateCamera(camera, oldId) {
    const response = await fetch(`${BACKEND_URL}/api/cameras/${oldId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...camera, newId: camera.id }),
    });
    if (!response.ok) throw new Error('Failed to update camera');
    const data = await response.json();
    return { ...camera, id: data.id };
  },

  async removeCamera(cameraId) {
    const response = await fetch(`${BACKEND_URL}/api/cameras/${cameraId}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to remove camera');
    return response.json();
  },
};
