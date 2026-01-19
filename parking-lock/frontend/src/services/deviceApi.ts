import api from "./api";

export const deviceApi = {
  // Get all devices
  async getDevices(filters?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ success: boolean; total: number; data: Device[] }> {
    const response = await api.get("/api/devices", { params: filters });
    return response.data;
  },

  // Get device by ID
  async getDeviceById(
    id: string
  ): Promise<{ success: boolean; data: DeviceWithLockers }> {
    const response = await api.get(`/api/devices/${id}`);
    return response.data;
  },

  // Update device
  async updateDevice(
    id: string,
    data: { name?: string; location?: string }
  ): Promise<{ success: boolean; message: string; data: Device }> {
    const response = await api.put(`/api/devices/${id}`, data);
    return response.data;
  },

  // Business control (Open/Close parking lot)
  async businessControl(
    id: string,
    data: { mode: "Open" | "Close" }
  ): Promise<{ success: boolean; message: string; data: any }> {
    const response = await api.post(
      `/api/devices/${id}/business-control`,
      data
    );
    return response.data;
  },

  // System maintenance (Reboot/ClearErr)
  async maintenance(
    id: string,
    data: {
      command: "Reboot" | "ClearErr";
      device_type?: string;
      serial_number?: string;
    }
  ): Promise<{ success: boolean; message: string; data: any }> {
    const response = await api.post(`/api/devices/${id}/maintenance`, data);
    return response.data;
  },

  // Refresh config on all online devices
  async refreshConfig(): Promise<{
    success: boolean;
    message: string;
    data: {
      success: boolean;
      devicesUpdated: number;
      total: number;
      results: Array<{
        deviceId: string;
        success: boolean;
        error?: string;
      }>;
    };
  }> {
    const response = await api.post("/api/devices/refresh-config");
    return response.data;
  },
};

export default deviceApi;
