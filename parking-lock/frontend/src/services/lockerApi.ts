import api from "./api";

export const lockerApi = {
  // Get all lockers
  async getLockers(filters?: {
    device_id?: string;
    status?: string;
    mode?: string;
    occupied?: boolean;
    connected?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ success: boolean; total: number; data: Locker[] }> {
    const response = await api.get("/api/lockers", { params: filters });
    return response.data;
  },

  // Get locker by ID
  async getLockerById(
    lockId: string
  ): Promise<{ success: boolean; data: LockerDetail }> {
    const response = await api.get(`/api/lockers/${lockId}`);
    return response.data;
  },

  // Control locker
  async controlLocker(
    lockId: string,
    data: {
      action: "open" | "close" | "stop" | "normal" | "check";
      mode?: "normal" | "payment";
      time?: number;
      note?: string;
    }
  ): Promise<{ success: boolean; message: string; data: any }> {
    const response = await api.post(`/api/lockers/${lockId}/control`, data);
    return response.data;
  },

  // Update locker
  async updateLocker(
    lockId: string,
    data: { name?: string; occupied?: boolean; hourly_rate?: number }
  ): Promise<{ success: boolean; message: string; data: Locker }> {
    const response = await api.put(`/api/lockers/${lockId}`, data);
    return response.data;
  },

  // Set lock attribute (protection thresholds)
  async setLockAttribute(
    lockId: string,
    data: {
      up_protect?: number;
      down_protect?: number;
      ids?: string;
      device_id?: string; // Required when lock_id is "All"
    }
  ): Promise<{ success: boolean; message: string; data: any }> {
    const response = await api.post(
      `/api/lockers/${lockId}/set-attribute`,
      data
    );
    return response.data;
  },

  // Set free time (minutes before auto-lock)
  async setFreeTime(
    lockId: string,
    data: { time: number }
  ): Promise<{ success: boolean; message: string; data: any }> {
    const response = await api.post(`/api/lockers/${lockId}/free-time`, data);
    return response.data;
  },

  // Set warning time (seconds before action)
  async setWarningTime(
    lockId: string,
    data: { time: number }
  ): Promise<{ success: boolean; message: string; data: any }> {
    const response = await api.post(
      `/api/lockers/${lockId}/warning-time`,
      data
    );
    return response.data;
  },

  // Simulate car enter
  async simulateCarEnter(
    lockId: string
  ): Promise<{ success: boolean; message: string; data: any }> {
    const response = await api.post(
      `/api/lockers/${lockId}/simulate-car-enter`
    );
    return response.data;
  },

  // Process payment
  async processPayment(
    lockId: string
  ): Promise<{ success: boolean; message: string; data: any }> {
    const response = await api.post(`/api/lockers/${lockId}/process-payment`);
    return response.data;
  },

  // Simulate car exit
  async simulateCarExit(
    lockId: string
  ): Promise<{ success: boolean; message: string; data: any }> {
    const response = await api.post(`/api/lockers/${lockId}/simulate-car-exit`);
    return response.data;
  },
};

export default lockerApi;
