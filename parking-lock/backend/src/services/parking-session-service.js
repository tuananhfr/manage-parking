import { getDatabase } from "../database/db.js";
import logger from "../utils/logger.js";

/**
 * Create a new parking session
 * @param {object} sessionData - Session data
 * @param {string} sessionData.device_id - Device ID
 * @param {string} sessionData.lock_id - Lock ID
 * @param {string} sessionData.ticket_type - 'single' or 'monthly'
 * @param {string} sessionData.license_plate - License plate (required for monthly, optional for single)
 * @param {string} sessionData.car_enter_time - Car enter time (ISO string)
 * @param {number} sessionData.parking_duration - Parking duration in minutes
 * @param {number} sessionData.billing_duration - Billing duration in minutes
 * @param {number} sessionData.free_time_minutes - Free time in minutes
 * @param {number} sessionData.amount - Amount in VND (for single ticket)
 * @param {string} sessionData.payment_order_id - Payment order ID (for single ticket)
 * @param {string} sessionData.status - 'in_progress' or 'completed'
 * @returns {object} Created session object
 */
export function createParkingSession(sessionData) {
  const db = getDatabase();

  try {
    const {
      device_id,
      lock_id,
      ticket_type,
      license_plate = null,
      car_enter_time,
      car_exit_time = null,
      parking_duration = null,
      billing_duration = null,
      free_time_minutes = null,
      amount = null,
      payment_order_id = null,
      status = "in_progress",
    } = sessionData;

    // Validate required fields
    // ticket_type can be null when car enters, will be set when payment/unlock
    if (!device_id || !lock_id || !car_enter_time) {
      throw new Error("device_id, lock_id, and car_enter_time are required");
    }

    // Validate ticket_type (can be null when car enters)
    if (ticket_type && !["single", "monthly"].includes(ticket_type)) {
      throw new Error("ticket_type must be 'single', 'monthly', or null");
    }

    // For monthly tickets, license_plate is required when status is completed
    if (ticket_type === "monthly" && status === "completed" && !license_plate) {
      throw new Error(
        "license_plate is required for completed monthly tickets"
      );
    }

    // For single tickets, amount and payment_order_id should be provided when completed
    if (ticket_type === "single" && status === "completed") {
      if (!amount || !payment_order_id) {
        logger.warn(
          `Single ticket session completed but missing amount or payment_order_id`
        );
      }
    }

    const insert = db.prepare(`
      INSERT INTO parking_sessions (
        device_id, lock_id, ticket_type, license_plate,
        car_enter_time, payment_time, car_exit_time,
        parking_duration, billing_duration, free_time_minutes,
        amount, payment_order_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insert.run(
      device_id,
      lock_id,
      ticket_type,
      license_plate,
      car_enter_time,
      sessionData.payment_time || null,
      car_exit_time,
      parking_duration,
      billing_duration,
      free_time_minutes,
      amount,
      payment_order_id,
      status
    );

    const session = getParkingSessionById(result.lastInsertRowid);

    if (session) {
      logger.info(
        `Created parking session ${
          session.id
        } for lock ${lock_id} (ticket_type: ${
          ticket_type || "null"
        }, status: ${status})`
      );
    } else {
      logger.error(
        `Created parking session but failed to retrieve it for lock ${lock_id} (ticket_type: ${
          ticket_type || "null"
        }, status: ${status})`
      );
    }

    return session;
  } catch (error) {
    logger.error("Error creating parking session:", error);
    throw error;
  }
}

/**
 * Update parking session (usually to mark as completed and add exit time)
 * @param {number} sessionId - Session ID
 * @param {object} updates - Fields to update
 * @returns {object} Updated session object
 */
export function updateParkingSession(sessionId, updates) {
  const db = getDatabase();

  try {
    const allowedFields = [
      "ticket_type",
      "license_plate",
      "car_exit_time",
      "parking_duration",
      "billing_duration",
      "free_time_minutes",
      "amount",
      "payment_order_id",
      "status",
    ];
    const updateFields = [];
    const updateValues = [];

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = ?`);
        updateValues.push(value);
      }
    }

    if (updateFields.length === 0) {
      throw new Error("No valid fields to update");
    }

    // Always update updated_at
    updateFields.push("updated_at = CURRENT_TIMESTAMP");
    updateValues.push(sessionId);

    const update = db.prepare(`
      UPDATE parking_sessions
      SET ${updateFields.join(", ")}
      WHERE id = ?
    `);

    update.run(...updateValues);

    const session = getParkingSessionById(sessionId);
    logger.info(`Updated parking session ${sessionId}`);

    return session;
  } catch (error) {
    logger.error(`Error updating parking session ${sessionId}:`, error);
    throw error;
  }
}

/**
 * Get parking session by ID
 * @param {number} sessionId - Session ID
 * @returns {object|null} Session object or null
 */
export function getParkingSessionById(sessionId) {
  const db = getDatabase();

  try {
    const session = db
      .prepare(`SELECT * FROM parking_sessions WHERE id = ?`)
      .get(sessionId);

    return session || null;
  } catch (error) {
    logger.error(`Error getting parking session ${sessionId}:`, error);
    return null;
  }
}

/**
 * Get parking session by payment order ID (for single tickets)
 * @param {string} paymentOrderId - Payment order ID
 * @returns {object|null} Session object or null
 */
export function getParkingSessionByPaymentOrderId(paymentOrderId) {
  const db = getDatabase();

  try {
    const session = db
      .prepare(`SELECT * FROM parking_sessions WHERE payment_order_id = ?`)
      .get(paymentOrderId);

    return session || null;
  } catch (error) {
    logger.error(
      `Error getting parking session by payment_order_id ${paymentOrderId}:`,
      error
    );
    return null;
  }
}

/**
 * Get parking sessions with filters
 * @param {object} filters - Filter options
 * @param {string} filters.device_id - Filter by device ID
 * @param {string} filters.lock_id - Filter by lock ID
 * @param {string} filters.ticket_type - Filter by ticket type ('single' or 'monthly')
 * @param {string} filters.license_plate - Filter by license plate
 * @param {string} filters.status - Filter by status ('in_progress' or 'completed')
 * @param {string} filters.start_date - Filter by start date (YYYY-MM-DD)
 * @param {string} filters.end_date - Filter by end date (YYYY-MM-DD)
 * @param {number} filters.limit - Limit results
 * @param {number} filters.offset - Offset for pagination
 * @returns {object} { sessions: [], total: number }
 */
export function getParkingSessions(filters = {}) {
  const db = getDatabase();

  try {
    const {
      device_id,
      lock_id,
      ticket_type,
      license_plate,
      status,
      start_date,
      end_date,
      limit = 100,
      offset = 0,
    } = filters;

    let whereConditions = [];
    let queryParams = [];

    if (device_id) {
      whereConditions.push("device_id = ?");
      queryParams.push(device_id);
    }

    if (lock_id) {
      whereConditions.push("lock_id = ?");
      queryParams.push(lock_id);
    }

    if (ticket_type) {
      whereConditions.push("ticket_type = ?");
      queryParams.push(ticket_type);
    }

    if (license_plate) {
      whereConditions.push("license_plate = ?");
      queryParams.push(license_plate);
    }

    if (status) {
      whereConditions.push("status = ?");
      queryParams.push(status);
    }

    if (start_date) {
      whereConditions.push("DATE(car_enter_time) >= ?");
      queryParams.push(start_date);
    }

    if (end_date) {
      whereConditions.push("DATE(car_enter_time) <= ?");
      queryParams.push(end_date);
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // Get total count
    const countResult = db
      .prepare(`SELECT COUNT(*) as total FROM parking_sessions ${whereClause}`)
      .get(...queryParams);
    const total = countResult?.total || 0;

    // Get sessions
    queryParams.push(limit, offset);
    const sessions = db
      .prepare(
        `SELECT * FROM parking_sessions ${whereClause} ORDER BY car_enter_time DESC LIMIT ? OFFSET ?`
      )
      .all(...queryParams);

    return {
      sessions: sessions || [],
      total,
    };
  } catch (error) {
    logger.error("Error getting parking sessions:", error);
    return {
      sessions: [],
      total: 0,
    };
  }
}

/**
 * Get statistics for parking sessions
 * @param {object} filters - Filter options (same as getParkingSessions)
 * @returns {object} Statistics object
 */
export function getParkingSessionStatistics(filters = {}) {
  const db = getDatabase();

  try {
    const { device_id, lock_id, ticket_type, start_date, end_date } = filters;

    let whereConditions = [];
    let queryParams = [];

    if (device_id) {
      whereConditions.push("device_id = ?");
      queryParams.push(device_id);
    }

    if (lock_id) {
      whereConditions.push("lock_id = ?");
      queryParams.push(lock_id);
    }

    if (ticket_type) {
      whereConditions.push("ticket_type = ?");
      queryParams.push(ticket_type);
    }

    if (start_date) {
      whereConditions.push("DATE(car_enter_time) >= ?");
      queryParams.push(start_date);
    }

    if (end_date) {
      whereConditions.push("DATE(car_enter_time) <= ?");
      queryParams.push(end_date);
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    const stats = db
      .prepare(
        `
        SELECT 
          COUNT(*) as total_sessions,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_sessions,
          SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_sessions,
          SUM(CASE WHEN ticket_type = 'single' THEN 1 ELSE 0 END) as single_tickets,
          SUM(CASE WHEN ticket_type = 'monthly' THEN 1 ELSE 0 END) as monthly_tickets,
          SUM(CASE WHEN ticket_type = 'single' AND amount > 0 THEN amount ELSE 0 END) as total_revenue,
          AVG(CASE WHEN parking_duration IS NOT NULL THEN parking_duration ELSE NULL END) as avg_parking_duration
        FROM parking_sessions
        ${whereClause}
      `
      )
      .get(...queryParams);

    return (
      stats || {
        total_sessions: 0,
        completed_sessions: 0,
        in_progress_sessions: 0,
        single_tickets: 0,
        monthly_tickets: 0,
        total_revenue: 0,
        avg_parking_duration: 0,
      }
    );
  } catch (error) {
    logger.error("Error getting parking session statistics:", error);
    return {
      total_sessions: 0,
      completed_sessions: 0,
      in_progress_sessions: 0,
      single_tickets: 0,
      monthly_tickets: 0,
      total_revenue: 0,
      avg_parking_duration: 0,
    };
  }
}
