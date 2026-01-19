import { getDatabase, initDatabase } from './db.js';
import { runMigrations } from './migrations.js';
import { generateLockId } from '../utils/helpers.js';
import logger from '../utils/logger.js';

/**
 * Seed test data
 */
async function seedData() {
  const db = getDatabase();

  logger.info('Seeding test data...');

  // Clear existing data
  db.prepare('DELETE FROM status_logs').run();
  db.prepare('DELETE FROM command_logs').run();
  db.prepare('DELETE FROM lockers').run();
  db.prepare('DELETE FROM devices').run();

  logger.info('✓ Cleared existing data');

  // Insert test devices
  const devices = [
    {
      id: 'PK001',
      serial_number: 'SN001ABC',
      name: 'Khu A - Tầng 1',
      location: 'Toà nhà A',
      status: 'OFFLINE',
      ip_address: null
    },
    {
      id: 'PK002',
      serial_number: 'SN002DEF',
      name: 'Khu A - Tầng 2',
      location: 'Toà nhà A',
      status: 'OFFLINE',
      ip_address: null
    }
  ];

  const deviceStmt = db.prepare(`
    INSERT INTO devices (id, serial_number, name, location, status, ip_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const device of devices) {
    deviceStmt.run(
      device.id,
      device.serial_number,
      device.name,
      device.location,
      device.status,
      device.ip_address
    );
  }

  logger.info(`✓ Inserted ${devices.length} devices`);

  // Insert lockers for each device (32 lockers per device)
  const lockerStmt = db.prepare(`
    INSERT INTO lockers (lock_id, device_id, lock_number, name, status, mode, occupied)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let totalLockers = 0;

  for (const device of devices) {
    for (let i = 1; i <= 32; i++) {
      const lockId = generateLockId(device.id, i);
      const name = `Chỗ đỗ ${device.id}-${String(i).padStart(2, '0')}`;

      lockerStmt.run(
        lockId,
        device.id,
        i,
        name,
        'UP',
        'NORMAL',
        0
      );

      totalLockers++;
    }
  }

  logger.info(`✓ Inserted ${totalLockers} lockers`);

  logger.info('Seed data completed successfully!');
}

/**
 * Main function
 */
async function main() {
  try {
    initDatabase();
    await runMigrations();
    await seedData();
    logger.info('✓ Database seeded successfully!');
    return true;
  } catch (error) {
    logger.error('Seeding failed:', error);
    throw error;
  }
}

// Run seed if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => {
      console.log('✓ Database seed completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('✗ Seed failed:', error);
      process.exit(1);
    });
}

export default { seedData };
