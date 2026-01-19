import api from "./api";

/**
 * Payment API service
 */
const paymentApi = {
  /**
   * Get payment history with filters
   */
  getPaymentHistory: async (filters?: {
    lock_id?: string;
    device_id?: string;
    status?: string;
    start_date?: string;
    end_date?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) => {
    const params: any = { limit: 50, offset: 0 };

    if (filters?.lock_id) params.lock_id = filters.lock_id;
    if (filters?.device_id) params.device_id = filters.device_id;
    if (filters?.status) params.status = filters.status;
    if (filters?.start_date) params.start_date = filters.start_date;
    if (filters?.end_date) params.end_date = filters.end_date;
    if (filters?.search) params.search = filters.search;
    if (filters?.limit) params.limit = filters.limit;
    if (filters?.offset) params.offset = filters.offset;

    const res = await api.get("/api/payments/history", { params });
    return res.data;
  },

  /**
   * Get overall payment statistics
   */
  getOverallStatistics: async (filters?: {
    start_date?: string;
    end_date?: string;
  }) => {
    const params: any = {};

    if (filters?.start_date) params.start_date = filters.start_date;
    if (filters?.end_date) params.end_date = filters.end_date;

    const res = await api.get("/api/payments/statistics/overall", { params });
    return res.data;
  },

  /**
   * Get payment order by ID
   */
  getPaymentOrder: async (orderId: string) => {
    const res = await api.get(`/api/payments/order/${orderId}`);
    return res.data;
  },

  /**
   * Get parking sessions (vé lẻ và vé tháng)
   */
  getParkingSessions: async (filters?: {
    device_id?: string;
    lock_id?: string;
    ticket_type?: "single" | "monthly";
    license_plate?: string;
    status?: "in_progress" | "completed";
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  }) => {
    const params: any = { limit: 50, offset: 0 };

    if (filters?.device_id) params.device_id = filters.device_id;
    if (filters?.lock_id) params.lock_id = filters.lock_id;
    if (filters?.ticket_type) params.ticket_type = filters.ticket_type;
    if (filters?.license_plate) params.license_plate = filters.license_plate;
    if (filters?.status) params.status = filters.status;
    if (filters?.start_date) params.start_date = filters.start_date;
    if (filters?.end_date) params.end_date = filters.end_date;
    if (filters?.limit) params.limit = filters.limit;
    if (filters?.offset) params.offset = filters.offset;

    const res = await api.get("/api/payments/sessions", { params });
    return res.data;
  },

  /**
   * Get parking session statistics
   */
  getParkingSessionStatistics: async (filters?: {
    device_id?: string;
    lock_id?: string;
    ticket_type?: "single" | "monthly";
    start_date?: string;
    end_date?: string;
  }) => {
    const params: any = {};

    if (filters?.device_id) params.device_id = filters.device_id;
    if (filters?.lock_id) params.lock_id = filters.lock_id;
    if (filters?.ticket_type) params.ticket_type = filters.ticket_type;
    if (filters?.start_date) params.start_date = filters.start_date;
    if (filters?.end_date) params.end_date = filters.end_date;

    const res = await api.get("/api/payments/sessions/statistics", { params });
    return res.data;
  },
};

export default paymentApi;
