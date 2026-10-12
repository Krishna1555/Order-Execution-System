// Optional seed script for test data
// This can be used to populate the database with sample orders for testing

import { logger } from '../src/utils/logger';

async function seed() {
  logger.info('Seed script - no data to seed by default');
  // Add seed logic here if needed
  process.exit(0);
}

seed().catch((error) => {
  logger.error('Seed failed', { error });
  process.exit(1);
});
