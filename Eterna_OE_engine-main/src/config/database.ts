import { getPool, closePool } from '../models/database';
import { getRedis } from '../queue/order.queue';
import { logger } from '../utils/logger';

export async function initializeDatabase(): Promise<void> {
  try {
    // Validate that required environment variables are set (loaded from .env file)
    // Note: .env file is included in deployment and loaded via dotenv.config() in entry points
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set. Please set it in .env file (included in deployment).');
    }
    if (!process.env.REDIS_URL) {
      throw new Error('REDIS_URL environment variable is not set. Please set it in .env file (included in deployment).');
    }
    logger.info('Environment variables validated (loaded from .env file)', {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      hasRedisUrl: !!process.env.REDIS_URL,
      databaseUrl: process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@'), // Hide password
      redisUrl: process.env.REDIS_URL.replace(/:[^:@]+@/, ':****@'), // Hide password if present
    });

    // Test PostgreSQL connection with retry logic
    // App Engine Standard may need a moment to create the Unix socket
    const pool = getPool();
    const maxRetries = 5;
    const retryDelay = 2000; // 2 seconds
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await pool.query('SELECT 1');
        logger.info('PostgreSQL connected', { attempt });
        break;
      } catch (error: any) {
        if (error?.code === 'ECONNREFUSED' && attempt < maxRetries) {
          logger.warn(`PostgreSQL connection attempt ${attempt} failed, retrying...`, {
            error: error.message,
            attempt,
            maxRetries,
            willRetryIn: `${retryDelay}ms`
          });
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
        throw error;
      }
    }

    // Test Redis connection
    const redis = getRedis();
    await redis.ping();
    logger.info('Redis connected');
  } catch (error) {
    const errorDetails = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      code: (error as any)?.code,
      name: (error as any)?.name,
      severity: (error as any)?.severity,
      databaseUrl: process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@'), // Hide password
    };
    logger.error('Database initialization failed', errorDetails);
    throw error;
  }
}

export async function closeDatabase(): Promise<void> {
  await closePool();
  logger.info('Database connections closed');
}
