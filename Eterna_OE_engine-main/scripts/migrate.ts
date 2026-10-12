import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getPool, closePool } from '../src/models/database';
import { logger } from '../src/utils/logger';

async function runMigrations() {
  try {
    const pool = getPool();
    const migrationFile = join(__dirname, '../migrations/001_create_orders_table.sql');
    const sql = readFileSync(migrationFile, 'utf-8');

    await pool.query(sql);
    logger.info('Migration completed successfully');
    await closePool();
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed', { error: error instanceof Error ? error.message : error, stack: error instanceof Error ? error.stack : undefined });
    await closePool().catch(() => {});
    process.exit(1);
  }
}

runMigrations();
