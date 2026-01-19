declare global {
  export interface Device {
    id: string;
    serial_number: string;
    name: string | null;
    location: string | null;
    status: "ONLINE" | "OFFLINE" | "ERROR";
    ip_address: string | null;
    last_seen: string | null;
    registered_at: string;
    metadata: string | null;
    created_at: string;
    updated_at: string;
    locker_count?: number;
    online_count?: number;
  }

  export interface DeviceWithLockers extends Device {
    lockers: Locker[];
  }

  export interface Locker {
    lock_id: string;
    device_id: string;
    lock_number: number;
    name: string | null;
    status: "UP" | "DOWN";
    mode: "NORMAL" | "MAINTENANCE";
    occupied: number;
    lock_free_time: number | null;
    lock_warning_time: number | null;
    remaining_time: number | null;
    hourly_rate: number;
    up_protect: number | null;
    down_protect: number | null;
    last_action: string | null;
    last_action_time: string | null;
    created_at: string;
    updated_at: string;
    device_name?: string;
    device_location?: string;
    device_status?: string;
  }

  export interface LockerDetail extends Locker {
    recent_commands: CommandLog[];
    status_history: StatusLog[];
  }

  export interface CommandLog {
    id: number;
    lock_id: string;
    device_id: string | null;
    command_type: string;
    command_data: string | null;
    status: "SENT" | "ACK" | "NACK" | "TIMEOUT" | "ERROR";
    sent_at: string;
    ack_at: string | null;
    response_data: string | null;
    note: string | null;
  }

  export interface StatusLog {
    id: number;
    lock_id: string | null;
    device_id: string | null;
    old_status: string | null;
    new_status: string | null;
    old_mode: string | null;
    new_mode: string | null;
    old_occupied: number | null;
    new_occupied: number | null;
    trigger_type: string;
    changed_at: string;
    note: string | null;
  }

  export interface DashboardStats {
    total_devices: number;
    online_devices: number;
    offline_devices: number;
    total_lockers: number;
    available_lockers: number;
    occupied_lockers: number;
    error_lockers: number;
    today_commands: number;
    today_opens: number;
    today_closes: number;
    uptime_percentage: number;
  }

  export interface UsageChartData {
    time: string;
    available: number;
    occupied: number;
  }

  export interface PaymentOrder {
    id: number;
    device_id: string;
    lock_id: string;
    order_number: number;
    order_date: string;
    order_id: string;
    description: string;
    amount: number;
    status: "pending" | "paid";
    transaction_id: string | null;
    paid_at: string | null;
    created_at: string;
    updated_at: string;
    car_enter_time: string | null;
    car_exit_time: string | null;
    parking_duration: number | null;
    billing_duration: number | null;
    free_time_minutes: number | null;
    hourly_rate: number | null;
  }

  export interface PaymentHistoryResult {
    orders: PaymentOrder[];
    total: number;
    summary: {
      total_orders: number;
      paid_orders: number;
      pending_orders: number;
      total_revenue: number;
    };
    pagination: {
      limit: number;
      offset: number;
      has_more: boolean;
    };
  }

  export interface OverallStatistics {
    total_orders: number;
    paid_orders: number;
    pending_orders: number;
    total_revenue: number;
    total_lockers?: number;
    total_devices?: number;
    // For parking sessions statistics
    single_tickets?: number;
    monthly_tickets?: number;
  }

  export interface ParkingSession {
    id: number;
    device_id: string;
    lock_id: string;
    ticket_type: "single" | "monthly" | null;
    license_plate: string | null;
    car_enter_time: string;
    payment_time: string | null;
    car_exit_time: string | null;
    parking_duration: number | null;
    billing_duration: number | null;
    free_time_minutes: number | null;
    amount: number | null;
    payment_order_id: string | null;
    status: "in_progress" | "completed";
    created_at: string;
    updated_at: string;
  }

  export interface ParkingSessionsResult {
    sessions: ParkingSession[];
    total: number;
    pagination: {
      limit: number;
      offset: number;
      has_more: boolean;
    };
  }
}
export {};
