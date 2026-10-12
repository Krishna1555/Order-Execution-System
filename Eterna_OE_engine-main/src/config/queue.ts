import { Worker, WorkerOptions } from 'bullmq';
import { processOrder } from '../processors/order.processor';
import { logger } from '../utils/logger';

let worker: Worker | null = null;

export function startWorker(): Worker {
  if (worker) {
    return worker;
  }

  const concurrency = parseInt(process.env.QUEUE_CONCURRENCY || '10', 10);
  const rateLimit = parseInt(process.env.QUEUE_RATE_LIMIT || '100', 10);
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  logger.info('Parsing Redis URL for BullMQ worker', {
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
    logger.info('Redis URL parsed successfully for BullMQ worker', {
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

  const workerOptions: WorkerOptions = {
    connection: connectionOptions as any, // Pass connection options instead of string
    concurrency,
    limiter: {
      max: rateLimit,
      duration: 60000, // 1 minute
    },
  };

  worker = new Worker('order-execution', processOrder, workerOptions);

  worker.on('active', (job) => {
    logger.info('Job started processing', {
      jobId: job.id,
      orderId: job.data.orderId,
      tokenIn: job.data.tokenIn,
      tokenOut: job.data.tokenOut,
      amountIn: job.data.amountIn,
      attempt: (job.attemptsMade || 0) + 1,
    });
  });

  worker.on('completed', (job) => {
    logger.info('Job completed successfully', {
      jobId: job.id,
      orderId: job.data.orderId,
      duration: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : undefined,
    });
  });

  worker.on('failed', (job, error) => {
    logger.error('Job failed permanently', {
      jobId: job?.id,
      orderId: job?.data?.orderId,
      error: error.message,
      attemptsMade: job?.attemptsMade,
      maxAttempts: job?.opts?.attempts,
      willRetry: job && job.attemptsMade !== undefined && job.opts?.attempts !== undefined
        ? job.attemptsMade < job.opts.attempts
        : false,
    });
  });

  worker.on('error', (error) => {
    logger.error('Worker error', { error: error.message, stack: error.stack });
  });

  logger.info('Order processor worker started', {
    concurrency,
    rateLimit: `${rateLimit} jobs/minute`,
    queueName: 'order-execution',
  });

  return worker;
}

export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('Order processor worker stopped');
  }
}
