import api from "./api";

export const settingsApi = {
  // Get global hourly rate
  async getGlobalHourlyRate(): Promise<{
    success: boolean;
    data: { rate: number };
  }> {
    const response = await api.get("/api/settings/global-hourly-rate");
    return response.data;
  },

  // Update global hourly rate and copy to all lockers
  async updateGlobalHourlyRate(rate: number): Promise<{
    success: boolean;
    message: string;
    data: { rate: number; lockers_updated: number };
  }> {
    const response = await api.post("/api/settings/global-hourly-rate", {
      rate,
    });
    return response.data;
  },

  // Get all settings
  async getAllSettings(): Promise<{
    success: boolean;
    data: Array<{
      id: number;
      setting_key: string;
      setting_value: string;
      description: string | null;
      created_at: string;
      updated_at: string;
    }>;
  }> {
    const response = await api.get("/api/settings");
    return response.data;
  },
};

export default settingsApi;
