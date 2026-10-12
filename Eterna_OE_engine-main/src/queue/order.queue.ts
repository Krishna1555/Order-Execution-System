import { Queue, QueueOptions } from 'bullmq';
import Redis from 'ioredis';
import { retryConfig } from './retry.config';
import { logger } from '../utils/logger';

let redis: Redis | null = null;
let orderQueue: Queue | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    // Parse Redis URL to determine connection type
    let connectionType = 'local';
    if (redisUrl.includes('MEMORYSTORE_PRIVATE_IP') || redisUrl.match(/redis:\/\/\d+\.\d+\.\d+\.\d+:6379/)) {
      connectionType = 'cloud-memorystore';
    } else if (redisUrl.includes('localhost') || redisUrl.includes('127.0.0.1')) {
      connectionType = 'local';
    }
    
    logger.info('Initializing Redis connection', { connectionType, url: redisUrl.replace(/:[^:@]+@/, ':****@') });
    
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      // For Cloud Memorystore, ensure proper connection handling
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    redis.on('error', (error) => {
      logger.error('Redis connection error', { error, connectionType });
    });

    redis.on('connect', () => {
      logger.info('Redis connected', { connectionType });
    });
  }

  return redis;
}

export function getOrderQueue(): Queue {
  if (!orderQueue) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    logger.info('Parsing Redis URL for BullMQ queue', {
      redisUrl: redisUrl.replace(/:[^:@]+@/, ':****@'), // Hide password in logs
    });
    
    // Parse Redis URL to extract host and port for BullMQ
    // BullMQ doesn't always parse connection strings correctly, so parse it ourselves
    let connectionOptions: any;
    try {
      const url = new URL(redisUrl);
      connectionOptions = {
        host: url.hostname,
        port: parseInt(url.port || '6379', 10),
      };
      logger.info('Redis URL parsed successfully for BullMQ queue', {
        host: connectionOptions.host,
        port: connectionOptions.port,
      });
    } catch (error) {
      // Fallback to connection string if URL parsing fails
      logger.warn('Failed to parse Redis URL, using connection string directly', {
        error: error instanceof Error ? error.message : String(error),
        redisUrl: redisUrl.replace(/:[^:@]+@/, ':****@'),
      });
      connectionOptions = redisUrl;
    }
    
    const queueOptions: QueueOptions = {
      connection: connectionOptions as any, // Pass connection options instead of string
      defaultJobOptions: {
        attempts: retryConfig.attempts,
        backoff: retryConfig.backoff,
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours
        },
      },
    };

    orderQueue = new Queue('order-execution', queueOptions);

    logger.info('Order queue initialized', {
      concurrency: process.env.QUEUE_CONCURRENCY || 10,
      rateLimit: process.env.QUEUE_RATE_LIMIT || 100,
      redisUrl: process.env.REDIS_URL?.replace(/:[^:@]+@/, ':****@'), // Hide password in logs
    });
  }

  return orderQueue;
}

export async function closeQueue(): Promise<void> {
  if (orderQueue) {
    await orderQueue.close();
    orderQueue = null;
  }
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
