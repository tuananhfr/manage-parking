import { getDatabase, initDatabase } from "./db.js";
import logger from "../utils/logger.js";

/**
 * Create all tables
 */
function createTables() {
  const db = getDatabase();

  logger.info("Creating tables...");

  // 1. devices table
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      serial_number TEXT UNIQUE NOT NULL,
      name TEXT,
      location TEXT,
      status TEXT DEFAULT 'OFFLINE',
      ip_address TEXT,
      last_seen DATETIME,
      registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen);
  `);

  logger.info("✓ Created devices table");

  // 2. lockers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS lockers (
      lock_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      lock_number INTEGER NOT NULL,
      name TEXT,
      status TEXT DEFAULT 'UP',
      mode TEXT DEFAULT 'NORMAL',
      occupied INTEGER DEFAULT 0,
      connected INTEGER DEFAULT 0,
      lock_free_time INTEGER,
      lock_warning_time INTEGER,
      last_action TEXT,
      last_action_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    )
  `);

  // Add connected column if it doesn't exist (migration for existing databases)
  try {
    db.exec(`ALTER TABLE lockers ADD COLUMN connected INTEGER DEFAULT 0`);
    logger.info("✓ Added connected column to lockers table");
  } catch (error) {
    // Column already exists, ignore error
    if (!error.message.includes("duplicate column name")) {
      logger.warn(
        "Error adding connected column (may already exist):",
        error.message
      );
    }
  }

  // Add lock_free_time column if it doesn't exist (migration for existing databases)
  try {
    db.exec(`ALTER TABLE lockers ADD COLUMN lock_free_time INTEGER`);
    logger.info("✓ Added lock_free_time column to lockers table");
  } catch (error) {
    if (!error.message.includes("duplicate column name")) {
      logger.warn(
        "Error adding lock_free_time column (may already exist):",
        error.message
      );
    }
  }

  // Add lock_warning_time column if it doesn't exist (migration for existing databases)
  try {
    db.exec(`ALTER TABLE lockers ADD COLUMN lock_warning_time INTEGER`);
    logger.info("✓ Added lock_warning_time column to lockers table");
  } catch (error) {
    if (!error.message.includes("duplicate column name")) {
      logger.warn(
        "Error adding lock_warning_time column (may already exist):",
        error.message
      );
    }
  }

  // Add hourly_rate column if it doesn't exist (migration for existing databases)
  try {
    db.exec(`ALTER TABLE lockers ADD COLUMN hourly_rate INTEGER DEFAULT 0`);
    logger.info("✓ Added hourly_rate column to lockers table");
  } catch (error) {
    if (!error.message.includes("duplicate column name")) {
      logger.warn(
        "Error adding hourly_rate column (may already exist):",
        error.message
      );
    }
  }

  // Add up_protect and down_protect columns if they don't exist (migration for existing databases)
  try {
    db.exec(`ALTER TABLE lockers ADD COLUMN up_protect INTEGER`);
    logger.info("✓ Added up_protect column to lockers table");
  } catch (error) {
    if (!error.message.includes("duplicate column name")) {
      logger.warn(
        "Error adding up_protect column (may already exist):",
        error.message
      );
    }
  }

  try {
    db.exec(`ALTER TABLE lockers ADD COLUMN down_protect INTEGER`);
    logger.info("✓ Added down_protect column to lockers table");
  } catch (error) {
    if (!error.message.includes("duplicate column name")) {
      logger.warn(
        "Error adding down_protect column (may already exist):",
        error.message
      );
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lockers_device ON lockers(device_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lockers_status ON lockers(status);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_lockers_mode ON lockers(mode);
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_lockers_device_number ON lockers(device_id, lock_number);
  `);

  logger.info("✓ Created lockers table");

  // 3. command_logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS command_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lock_id TEXT,
      device_id TEXT,
      command_type TEXT NOT NULL,
      command_data TEXT,
      status TEXT DEFAULT 'SENT',
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ack_at DATETIME,
      response_data TEXT,
      note TEXT,
      FOREIGN KEY (lock_id) REFERENCES lockers(lock_id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_command_logs_lock ON command_logs(lock_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_command_logs_device ON command_logs(device_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_command_logs_status ON command_logs(status);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_command_logs_sent_at ON command_logs(sent_at);
  `);

  logger.info("✓ Created command_logs table");

  // Migration: Allow lock_id to be NULL for device-level commands
  try {
    // SQLite doesn't support ALTER COLUMN directly, so we need to recreate the table
    const hasOldConstraint = db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='command_logs'`
      )
      .get();

    if (
      hasOldConstraint &&
      hasOldConstraint.sql.includes("lock_id TEXT NOT NULL")
    ) {
      logger.info("Migrating command_logs table to allow NULL lock_id...");

      // Create new table with correct schema
      db.exec(`
        CREATE TABLE IF NOT EXISTS command_logs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          lock_id TEXT,
          device_id TEXT,
          command_type TEXT NOT NULL,
          command_data TEXT,
          status TEXT DEFAULT 'SENT',
          sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          ack_at DATETIME,
          response_data TEXT,
          note TEXT,
          FOREIGN KEY (lock_id) REFERENCES lockers(lock_id) ON DELETE CASCADE,
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        )
      `);

      // Copy data from old table
      db.exec(`
        INSERT INTO command_logs_new (id, lock_id, device_id, command_type, command_data, status, sent_at, ack_at, response_data, note)
        SELECT id, lock_id, device_id, command_type, command_data, status, sent_at, ack_at, response_data, note
        FROM command_logs
      `);

      // Drop old table
      db.exec(`DROP TABLE command_logs`);

      // Rename new table
      db.exec(`ALTER TABLE command_logs_new RENAME TO command_logs`);

      // Recreate indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_command_logs_lock ON command_logs(lock_id)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_command_logs_device ON command_logs(device_id)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_command_logs_status ON command_logs(status)
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_command_logs_sent_at ON command_logs(sent_at)
      `);

      logger.info("✓ Migrated command_logs table successfully");
    }
  } catch (error) {
    logger.warn("Migration note (may be already applied):", error.message);
  }

  // 4. status_logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS status_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lock_id TEXT,
      device_id TEXT,
      old_status TEXT,
      new_status TEXT,
      old_mode TEXT,
      new_mode TEXT,
      old_occupied INTEGER,
      new_occupied INTEGER,
      trigger_type TEXT,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      note TEXT,
      FOREIGN KEY (lock_id) REFERENCES lockers(lock_id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_status_logs_lock ON status_logs(lock_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_status_logs_device ON status_logs(device_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_status_logs_changed_at ON status_logs(changed_at);
  `);

  logger.info("✓ Created status_logs table");

  // 5. settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      type TEXT DEFAULT 'string',
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  logger.info("✓ Created settings table");

  // 6. payment_orders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      lock_id TEXT NOT NULL,
      order_number INTEGER NOT NULL,
      order_date TEXT NOT NULL,
      order_id TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      transaction_id TEXT,
      paid_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lock_id) REFERENCES lockers(lock_id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_payment_orders_lock_id ON payment_orders(lock_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_payment_orders_device_id ON payment_orders(device_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_payment_orders_order_date ON payment_orders(order_date);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_order_id ON payment_orders(order_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_payment_orders_transaction_id ON payment_orders(transaction_id);
  `);

  logger.info("✓ Created payment_orders table");

  // 5. parking_sessions table - Lưu lịch sử đỗ xe (vé lẻ và vé tháng)
  db.exec(`
    CREATE TABLE IF NOT EXISTS parking_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      lock_id TEXT NOT NULL,
      ticket_type TEXT CHECK(ticket_type IN ('single', 'monthly')),
      license_plate TEXT,
      car_enter_time DATETIME NOT NULL,
      payment_time DATETIME,
      car_exit_time DATETIME,
      parking_duration INTEGER,
      billing_duration INTEGER,
      free_time_minutes INTEGER,
      amount INTEGER,
      payment_order_id TEXT,
      status TEXT DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payment_order_id) REFERENCES payment_orders(order_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_parking_sessions_lock_id ON parking_sessions(lock_id);
  `);

  // Migration: Allow ticket_type to be NULL (for sessions created when car enters)
  try {
    // Check if table exists and has NOT NULL constraint on ticket_type
    const tableInfo = db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='parking_sessions'`
      )
      .get();

    if (tableInfo && tableInfo.sql.includes("ticket_type TEXT NOT NULL")) {
      logger.info(
        "Migrating parking_sessions table to allow NULL ticket_type..."
      );

      // Create new table with correct schema (ticket_type can be NULL)
      db.exec(`
        CREATE TABLE IF NOT EXISTS parking_sessions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT NOT NULL,
          lock_id TEXT NOT NULL,
          ticket_type TEXT CHECK(ticket_type IN ('single', 'monthly')),
          license_plate TEXT,
          car_enter_time DATETIME NOT NULL,
          car_exit_time DATETIME,
          parking_duration INTEGER,
          billing_duration INTEGER,
          free_time_minutes INTEGER,
          amount INTEGER,
          payment_order_id TEXT,
          status TEXT DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (payment_order_id) REFERENCES payment_orders(order_id)
        )
      `);

      // Copy data from old table
      db.exec(`
        INSERT INTO parking_sessions_new (
          id, device_id, lock_id, ticket_type, license_plate,
          car_enter_time, payment_time, car_exit_time,
          parking_duration, billing_duration, free_time_minutes,
          amount, payment_order_id, status,
          created_at, updated_at
        )
        SELECT 
          id, device_id, lock_id, ticket_type, license_plate,
          car_enter_time, NULL as payment_time, car_exit_time,
          parking_duration, billing_duration, free_time_minutes,
          amount, payment_order_id, status,
          created_at, updated_at
        FROM parking_sessions
      `);

      // Drop old table
      db.exec(`DROP TABLE parking_sessions`);

      // Rename new table
      db.exec(`ALTER TABLE parking_sessions_new RENAME TO parking_sessions`);

      // Recreate indexes
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_parking_sessions_lock_id ON parking_sessions(lock_id);
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_parking_sessions_device_id ON parking_sessions(device_id);
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_parking_sessions_ticket_type ON parking_sessions(ticket_type);
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_parking_sessions_status ON parking_sessions(status);
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_parking_sessions_license_plate ON parking_sessions(license_plate);
      `);
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_parking_sessions_car_enter_time ON parking_sessions(car_enter_time);
      `);

      logger.info(
        "✓ Migrated parking_sessions table to allow NULL ticket_type"
      );
    }
  } catch (error) {
    // Migration failed, but table might already be correct
    if (!error.message.includes("duplicate column name")) {
      logger.warn(
        "Error migrating parking_sessions table (may already be correct):",
        error.message
      );
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_parking_sessions_device_id ON parking_sessions(device_id);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_parking_sessions_ticket_type ON parking_sessions(ticket_type);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_parking_sessions_status ON parking_sessions(status);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_parking_sessions_license_plate ON parking_sessions(license_plate);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_parking_sessions_car_enter_time ON parking_sessions(car_enter_time);
  `);

  logger.info("✓ Created parking_sessions table");

  // Migration: Add payment_time column if it doesn't exist
  try {
    const tableInfo = db.prepare(`PRAGMA table_info(parking_sessions)`).all();

    const hasPaymentTime = tableInfo.some((col) => col.name === "payment_time");

    if (!hasPaymentTime) {
      logger.info("Adding payment_time column to parking_sessions table...");
      db.exec(`ALTER TABLE parking_sessions ADD COLUMN payment_time DATETIME`);
      logger.info("✓ Added payment_time column to parking_sessions table");
    }
  } catch (error) {
    logger.warn(
      "Error checking/adding payment_time column (may already exist):",
      error.message
    );
  }

  // Add parking detail columns if they don't exist (migration for existing databases)
  try {
    db.exec(`ALTER TABLE payment_orders ADD COLUMN car_enter_time DATETIME`);
    logger.info("✓ Added car_enter_time column to payment_orders table");
  } catch (error) {
    if (!error.message.includes("duplicate column name")) {
      logger.warn(
        "Error adding car_enter_time column (may already exist):",
        error.message
      );
    }
  }

  try {
    db.exec(`ALTER TABLE payment_orders ADD COLUMN car_exit_time DATETIME`);
    logger.info("✓ Added car_exit_time column to payment_orders table");
  } catch (error) {
    if (!error.message.includes("duplicate column name")) {
      logger.warn(
        "Error adding car_exit_time column (may already exist):",
        error.message
      );
    }
  }

  try {
    db.exec(`ALTER TABLE payment_orders ADD COLUMN parking_duration INTEGER`);
    logger.info("✓ Added parking_duration column to payment_orders table");
  } catch (error) {
    if (!error.message.includes("duplicate column name")) {
      logger.warn(
        "Error adding parking_duration column (may already exist):",
        error.message
      );
    }
  }

  try {
    db.exec(`ALTER TABLE payment_orders ADD COLUMN billing_duration INTEGER`);
    logger.info("✓ Added billing_duration column to payment_orders table");
  } catch (error) {
    if (!error.message.includes("duplicate column name")) {
      logger.warn(
        "Error adding billing_duration column (may already exist):",
        error.message
      );
    }
  }

  try {
    db.exec(`ALTER TABLE payment_orders ADD COLUMN free_time_minutes INTEGER`);
    logger.info("✓ Added free_time_minutes column to payment_orders table");
  } catch (error) {
    if (!error.message.includes("duplicate column name")) {
      logger.warn(
        "Error adding free_time_minutes column (may already exist):",
        error.message
      );
    }
  }

  try {
    db.exec(`ALTER TABLE payment_orders ADD COLUMN hourly_rate INTEGER`);
    logger.info("✓ Added hourly_rate column to payment_orders table");
  } catch (error) {
    if (!error.message.includes("duplicate column name")) {
      logger.warn(
        "Error adding hourly_rate column (may already exist):",
        error.message
      );
    }
  }

  logger.info("All tables created successfully!");
}

/**
 * Insert default settings
 */
function insertDefaultSettings() {
  const db = getDatabase();

  logger.info("Inserting default settings...");

  const settings = [
    ["heartbeat_timeout", "60", "number", "Timeout cho heartbeat (giây)"],
    ["heartbeat_interval", "30", "number", "Khoảng thời gian heartbeat (giây)"],
    ["aes_key", "AAAAAAAAAAAAAAAAAAAAAA==", "string", "AES-128-CBC key"],
    ["aes_iv", "BBBBBBBBBBBBBBBBBBBBBB==", "string", "AES-128-CBC IV"],
    ["command_timeout", "10", "number", "Timeout cho command (giây)"],
    ["auto_offline_check", "30", "number", "Kiểm tra offline interval (giây)"],
    [
      "global_hourly_rate",
      "50000",
      "number",
      "Giá đỗ xe toàn hệ thống (VND/giờ)",
    ],
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, type, description)
    VALUES (?, ?, ?, ?)
  `);

  for (const [key, value, type, description] of settings) {
    stmt.run(key, value, type, description);
  }

  logger.info("✓ Default settings inserted");
}

/**
 * Run migrations
 */
export async function runMigrations() {
  try {
    initDatabase();
    createTables();
    insertDefaultSettings();
    logger.info("Migrations completed successfully!");
    return true;
  } catch (error) {
    logger.error("Migration failed:", error);
    throw error;
  }
}

// Run migrations if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log("✓ Database migration completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("✗ Migration failed:", error);
      process.exit(1);
    });
}

export default { runMigrations };
