import { getDatabase } from "../database/db.js";
import logger from "../utils/logger.js";

/**
 * Generate ORDER_ID and create/update payment order
 * Format: DH{order_number}{ddMMyyyy}
 * Order number is per locker per day (resets daily)
 * Description format: "Chuyen tien SEVQR DH00104012026" (SEVQR prefix required by banks)
 *
 * NEW LOGIC: If a pending order exists for this lock, UPDATE it instead of creating a new one
 * This prevents duplicate/trash orders when user clicks "Vé lẻ" multiple times
 *
 * @param {string} deviceId - Device ID
 * @param {string} lockId - Lock ID (e.g., "PK001-01")
 * @param {number} amount - Payment amount in VND
 * @param {object} parkingDetails - Optional parking details { car_enter_time, parking_duration, billing_duration, free_time_minutes, hourly_rate }
 * @returns {object} Payment order object
 */
export function generateOrderId(deviceId, lockId, amount, parkingDetails = {}) {
  const db = getDatabase();

  try {
    // Get current date/time in Vietnam timezone (UTC+7)
    const now = new Date();
    const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

    const orderDate = vnTime.toISOString().split('T')[0]; // YYYY-MM-DD

    // Check if there's already a pending order for this lock
    const existingOrder = db.prepare(`
      SELECT * FROM payment_orders
      WHERE lock_id = ? AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(lockId);

    if (existingOrder) {
      // Update existing pending order with new amount and parking details
      db.prepare(`
        UPDATE payment_orders
        SET amount = ?,
            parking_duration = ?,
            billing_duration = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        amount,
        parkingDetails.parking_duration || null,
        parkingDetails.billing_duration || null,
        existingOrder.id
      );

      logger.info(`Updated existing pending order ${existingOrder.order_id} for lock ${lockId} with new amount ${amount}`);

      return {
        order_id: existingOrder.order_id,
        description: existingOrder.description,
        order_number: existingOrder.order_number,
        device_id: existingOrder.device_id,
        lock_id: existingOrder.lock_id,
        amount: amount, // Return updated amount
        order_date: existingOrder.order_date,
        status: 'pending',
        created_at: existingOrder.created_at,
        updated_at: vnTime.toISOString(),
        car_enter_time: existingOrder.car_enter_time,
        parking_duration: parkingDetails.parking_duration || existingOrder.parking_duration,
        billing_duration: parkingDetails.billing_duration || existingOrder.billing_duration,
        free_time_minutes: existingOrder.free_time_minutes,
        hourly_rate: existingOrder.hourly_rate
      };
    }

    // No pending order exists, create new one
    // Format: ddMMyyyy (using Vietnam time)
    const day = String(vnTime.getDate()).padStart(2, '0');
    const month = String(vnTime.getMonth() + 1).padStart(2, '0');
    const year = vnTime.getFullYear();
    const dateSuffix = `${day}${month}${year}`;

    // Get next order number for this locker today
    const result = db.prepare(`
      SELECT MAX(order_number) as max_order
      FROM payment_orders
      WHERE lock_id = ? AND order_date = ?
    `).get(lockId, orderDate);

    const maxOrder = result?.max_order || 0;
    const orderNumber = maxOrder + 1;

    // Generate ORDER_ID: DH{3-digit-counter}{ddMMyyyy}
    const orderId = `DH${String(orderNumber).padStart(3, '0')}${dateSuffix}`;

    // Generate description with SEVQR prefix for Sepay QR compatibility
    // Format: "Chuyen tien SEVQR DH00104012026" - banks require SEVQR prefix to recognize Sepay QR codes
    const description = `Chuyen tien SEVQR ${orderId}`;

    // Insert payment order with parking details
    const insert = db.prepare(`
      INSERT INTO payment_orders (
        device_id, lock_id, order_number, order_date,
        order_id, description, amount, status,
        car_enter_time, parking_duration, billing_duration,
        free_time_minutes, hourly_rate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `);

    insert.run(
      deviceId,
      lockId,
      orderNumber,
      orderDate,
      orderId,
      description,
      amount,
      parkingDetails.car_enter_time || null,
      parkingDetails.parking_duration || null,
      parkingDetails.billing_duration || null,
      parkingDetails.free_time_minutes || null,
      parkingDetails.hourly_rate || null
    );

    logger.info(`Generated new order ID: ${orderId} for lock ${lockId}`);

    return {
      order_id: orderId,
      description: description,
      order_number: orderNumber,
      device_id: deviceId,
      lock_id: lockId,
      amount: amount,
      order_date: orderDate,
      status: 'pending',
      created_at: vnTime.toISOString(),
      car_enter_time: parkingDetails.car_enter_time || null,
      parking_duration: parkingDetails.parking_duration || null,
      billing_duration: parkingDetails.billing_duration || null,
      free_time_minutes: parkingDetails.free_time_minutes || null,
      hourly_rate: parkingDetails.hourly_rate || null
    };

  } catch (error) {
    logger.error(`Error generating order ID: ${error.message}`);
    throw error;
  }
}

/**
 * Get payment order by ORDER_ID
 *
 * @param {string} orderId - Order ID (e.g., "BILL00104012026")
 * @returns {object|null} Payment order object or null
 */
export function getPaymentOrderById(orderId) {
  const db = getDatabase();

  try {
    const order = db.prepare(`
      SELECT * FROM payment_orders WHERE order_id = ?
    `).get(orderId);

    return order || null;
  } catch (error) {
    logger.error(`Error getting payment order: ${error.message}`);
    throw error;
  }
}

/**
 * Get payment order by transaction ID
 *
 * @param {string} transactionId - Transaction ID from payment gateway
 * @returns {object|null} Payment order object or null
 */
export function getPaymentOrderByTransactionId(transactionId) {
  const db = getDatabase();

  try {
    const order = db.prepare(`
      SELECT * FROM payment_orders
      WHERE transaction_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(transactionId);

    return order || null;
  } catch (error) {
    logger.error(`Error getting payment order by transaction ID: ${error.message}`);
    return null; // Don't throw, just return null
  }
}

/**
 * Update payment order status
 *
 * @param {string} orderId - Order ID
 * @param {string} status - New status ('pending' | 'paid' | 'cancelled')
 * @param {string} paidAt - Payment timestamp (ISO string)
 * @param {string} transactionId - Transaction ID from payment gateway (optional)
 * @param {string} carExitTime - Car exit time (ISO string, optional) - set when payment is confirmed
 * @returns {boolean} Success status
 */
export function updatePaymentOrderStatus(orderId, status, paidAt = null, transactionId = null, carExitTime = null) {
  const db = getDatabase();

  try {
    const stmt = db.prepare(`
      UPDATE payment_orders
      SET status = ?, paid_at = ?, transaction_id = ?, car_exit_time = ?, updated_at = CURRENT_TIMESTAMP
      WHERE order_id = ?
    `);

    const result = stmt.run(status, paidAt, transactionId, carExitTime, orderId);

    if (result.changes > 0) {
      logger.info(`Updated payment order ${orderId} status to ${status}${transactionId ? ` (Transaction: ${transactionId})` : ''}`);
      return true;
    }

    logger.warn(`Payment order ${orderId} not found`);
    return false;
  } catch (error) {
    logger.error(`Error updating payment order status: ${error.message}`);
    throw error;
  }
}

/**
 * Get payment orders with filters
 *
 * @param {object} filters - Filter options
 * @param {number} filters.limit - Limit results (default: 100)
 * @param {number} filters.offset - Offset results (default: 0)
 * @param {string} filters.lock_id - Filter by lock ID
 * @param {string} filters.device_id - Filter by device ID
 * @param {string} filters.status - Filter by status
 * @param {string} filters.order_date - Filter by order date (YYYY-MM-DD)
 * @returns {array} Array of payment orders
 */
export function getPaymentOrders(filters = {}) {
  const db = getDatabase();

  try {
    let sql = "SELECT * FROM payment_orders WHERE 1=1";
    const params = [];

    if (filters.lock_id) {
      sql += " AND lock_id = ?";
      params.push(filters.lock_id);
    }

    if (filters.device_id) {
      sql += " AND device_id = ?";
      params.push(filters.device_id);
    }

    if (filters.status) {
      sql += " AND status = ?";
      params.push(filters.status);
    }

    if (filters.order_date) {
      sql += " AND order_date = ?";
      params.push(filters.order_date);
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(filters.limit || 100);
    params.push(filters.offset || 0);

    const orders = db.prepare(sql).all(...params);
    return orders;
  } catch (error) {
    logger.error(`Error getting payment orders: ${error.message}`);
    throw error;
  }
}

/**
 * Get payment statistics for a lock
 *
 * @param {string} lockId - Lock ID
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {object} Payment statistics
 */
export function getPaymentStatistics(lockId, startDate = null, endDate = null) {
  const db = getDatabase();

  try {
    let sql = `
      SELECT
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_orders,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) as total_revenue
      FROM payment_orders
      WHERE lock_id = ?
    `;
    const params = [lockId];

    if (startDate) {
      sql += " AND order_date >= ?";
      params.push(startDate);
    }

    if (endDate) {
      sql += " AND order_date <= ?";
      params.push(endDate);
    }

    const stats = db.prepare(sql).get(...params);
    return stats || { total_orders: 0, paid_orders: 0, pending_orders: 0, total_revenue: 0 };
  } catch (error) {
    logger.error(`Error getting payment statistics: ${error.message}`);
    throw error;
  }
}

/**
 * Get payment history with advanced filters and search
 *
 * @param {object} filters - Filter options
 * @param {number} filters.limit - Limit results
 * @param {number} filters.offset - Offset results
 * @param {string} filters.lock_id - Filter by lock ID
 * @param {string} filters.device_id - Filter by device ID
 * @param {string} filters.status - Filter by status (paid, pending)
 * @param {string} filters.start_date - Start date (YYYY-MM-DD)
 * @param {string} filters.end_date - End date (YYYY-MM-DD)
 * @param {string} filters.search - Search by order_id, description, or transaction_id
 * @returns {object} { orders: array, total: number, summary: object }
 */
export function getPaymentHistory(filters = {}) {
  const db = getDatabase();

  try {
    let sql = "SELECT * FROM payment_orders WHERE 1=1";
    const params = [];

    // Filter by lock_id
    if (filters.lock_id) {
      sql += " AND lock_id = ?";
      params.push(filters.lock_id);
    }

    // Filter by device_id
    if (filters.device_id) {
      sql += " AND device_id = ?";
      params.push(filters.device_id);
    }

    // Filter by status
    if (filters.status) {
      sql += " AND status = ?";
      params.push(filters.status);
    }

    // Filter by date range
    if (filters.start_date) {
      sql += " AND order_date >= ?";
      params.push(filters.start_date);
    }

    if (filters.end_date) {
      sql += " AND order_date <= ?";
      params.push(filters.end_date);
    }

    // Search by order_id, description, or transaction_id
    if (filters.search) {
      sql += " AND (order_id LIKE ? OR description LIKE ? OR transaction_id LIKE ?)";
      const searchPattern = `%${filters.search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    // Get total count before pagination
    const countSql = sql.replace("SELECT *", "SELECT COUNT(*) as total");
    const countResult = db.prepare(countSql).get(...params);
    const total = countResult?.total || 0;

    // Add sorting and pagination
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(filters.limit || 100);
    params.push(filters.offset || 0);

    const orders = db.prepare(sql).all(...params);

    // Calculate summary statistics
    let summarySql = `
      SELECT
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_orders,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) as total_revenue,
        SUM(amount) as total_amount
      FROM payment_orders
      WHERE 1=1
    `;
    const summaryParams = [];

    // Apply same filters to summary (without pagination)
    if (filters.lock_id) {
      summarySql += " AND lock_id = ?";
      summaryParams.push(filters.lock_id);
    }

    if (filters.device_id) {
      summarySql += " AND device_id = ?";
      summaryParams.push(filters.device_id);
    }

    if (filters.status) {
      summarySql += " AND status = ?";
      summaryParams.push(filters.status);
    }

    if (filters.start_date) {
      summarySql += " AND order_date >= ?";
      summaryParams.push(filters.start_date);
    }

    if (filters.end_date) {
      summarySql += " AND order_date <= ?";
      summaryParams.push(filters.end_date);
    }

    if (filters.search) {
      summarySql += " AND (order_id LIKE ? OR description LIKE ? OR transaction_id LIKE ?)";
      const searchPattern = `%${filters.search}%`;
      summaryParams.push(searchPattern, searchPattern, searchPattern);
    }

    const summary = db.prepare(summarySql).get(...summaryParams) || {
      total_orders: 0,
      paid_orders: 0,
      pending_orders: 0,
      total_revenue: 0,
      total_amount: 0
    };

    return {
      orders,
      total,
      summary
    };
  } catch (error) {
    logger.error(`Error getting payment history: ${error.message}`);
    throw error;
  }
}

/**
 * Get overall payment statistics (all lockers)
 *
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {object} Overall statistics
 */
export function getOverallStatistics(startDate = null, endDate = null) {
  const db = getDatabase();

  try {
    let sql = `
      SELECT
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_orders,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) as total_revenue,
        SUM(amount) as total_amount,
        COUNT(DISTINCT lock_id) as total_lockers,
        COUNT(DISTINCT device_id) as total_devices
      FROM payment_orders
      WHERE 1=1
    `;
    const params = [];

    if (startDate) {
      sql += " AND order_date >= ?";
      params.push(startDate);
    }

    if (endDate) {
      sql += " AND order_date <= ?";
      params.push(endDate);
    }

    const stats = db.prepare(sql).get(...params);
    return stats || {
      total_orders: 0,
      paid_orders: 0,
      pending_orders: 0,
      total_revenue: 0,
      total_amount: 0,
      total_lockers: 0,
      total_devices: 0
    };
  } catch (error) {
    logger.error(`Error getting overall statistics: ${error.message}`);
    throw error;
  }
}

export default {
  generateOrderId,
  getPaymentOrderById,
  getPaymentOrderByTransactionId,
  updatePaymentOrderStatus,
  getPaymentOrders,
  getPaymentStatistics,
  getPaymentHistory,
  getOverallStatistics
};
