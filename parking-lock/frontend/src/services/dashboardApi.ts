import api from "./api";

export const dashboardApi = {
  // Get dashboard overview
  async getOverview(): Promise<{ success: boolean; data: DashboardStats }> {
    const response = await api.get("/api/dashboard/overview");
    return response.data;
  },

  // Get usage chart data
  async getUsageChart(filters?: {
    type?: "hourly" | "daily";
    from_date?: string;
    to_date?: string;
  }): Promise<{ success: boolean; data: UsageChartData[] }> {
    const response = await api.get("/api/dashboard/usage-chart", {
      params: filters,
    });
    return response.data;
  },
};

export default dashboardApi;
