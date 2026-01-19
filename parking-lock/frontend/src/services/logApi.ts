import api from "./api";

export const logApi = {
  // Get command logs
  async getCommandLogs(filters?: {
    lock_id?: string;
    device_id?: string;
    command_type?: string;
    status?: string;
    from_date?: string;
    to_date?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ success: boolean; total: number; data: CommandLog[] }> {
    const response = await api.get("/api/logs/commands", { params: filters });
    return response.data;
  },

  // Get status logs
  async getStatusLogs(filters?: {
    lock_id?: string;
    device_id?: string;
    trigger_type?: string;
    from_date?: string;
    to_date?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ success: boolean; total: number; data: StatusLog[] }> {
    const response = await api.get("/api/logs/status", { params: filters });
    return response.data;
  },
};

export default logApi;
