import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import config from '../config/config.js';
import logger from '../utils/logger.js';

let db = null;

/**
 * Initialize database connection
 */
export function initDatabase() {
  try {
    // Create data directory if not exists
    const dbDir = path.dirname(config.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      logger.info(`Created database directory: ${dbDir}`);
    }

    // Open database connection
    db = new Database(config.dbPath, {
      verbose: config.isDevelopment ? logger.debug.bind(logger) : null
    });

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Set journal mode to WAL for better concurrent access
    db.pragma('journal_mode = WAL');

    logger.info(`Database connected: ${config.dbPath}`);
    return db;
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Get database instance
 */
export function getDatabase() {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    logger.info('Database connection closed');
  }
}

/**
 * Execute query
 */
export function query(sql, params = []) {
  const database = getDatabase();
  return database.prepare(sql).all(params);
}

/**
 * Execute single row query
 */
export function queryOne(sql, params = []) {
  const database = getDatabase();
  return database.prepare(sql).get(params);
}

/**
 * Execute insert/update/delete
 */
export function execute(sql, params = []) {
  const database = getDatabase();
  return database.prepare(sql).run(params);
}

/**
 * Begin transaction
 */
export function beginTransaction() {
  const database = getDatabase();
  return database.prepare('BEGIN').run();
}

/**
 * Commit transaction
 */
export function commit() {
  const database = getDatabase();
  return database.prepare('COMMIT').run();
}

/**
 * Rollback transaction
 */
export function rollback() {
  const database = getDatabase();
  return database.prepare('ROLLBACK').run();
}

/**
 * Execute in transaction
 */
export function transaction(callback) {
  const database = getDatabase();
  return database.transaction(callback)();
}

export default {
  initDatabase,
  getDatabase,
  closeDatabase,
  query,
  queryOne,
  execute,
  beginTransaction,
  commit,
  rollback,
  transaction
};
