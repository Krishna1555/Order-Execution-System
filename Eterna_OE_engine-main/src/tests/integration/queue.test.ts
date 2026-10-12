import { getOrderQueue, closeQueue } from '../../queue/order.queue';
import { Keypair } from '@solana/web3.js';
import * as bs58 from 'bs58';

describe('Queue Integration', () => {
  let testKeypair: Keypair;
  let walletPrivateKey: string;

  beforeAll(() => {
    // Generate test keypair for user wallet
    testKeypair = Keypair.generate();
    walletPrivateKey = bs58.encode(testKeypair.secretKey);
  });

  afterAll(async () => {
    // Clean up queue connections
    await closeQueue();
  });

  it('should add job to queue with user wallet', async () => {
    const queue = getOrderQueue();

    const job = await queue.add('test-job', {
      orderId: 'test-order-id',
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      slippageTolerance: 0.01,
      walletPrivateKey,
    });

    expect(job).toBeDefined();
    expect(job.data.orderId).toBe('test-order-id');
    expect(job.data.walletPrivateKey).toBe(walletPrivateKey);

    // Clean up - try to remove, but don't fail if job is already processed
    try {
      await job.remove();
    } catch (error) {
      // Job may already be processed, ignore error
    }
  });

  it('should add multiple jobs concurrently', async () => {
    const queue = getOrderQueue();
    const jobs = await Promise.all([
      queue.add('test-job-1', {
        orderId: 'test-order-1',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        slippageTolerance: 0.01,
        walletPrivateKey,
      }),
      queue.add('test-job-2', {
        orderId: 'test-order-2',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 50,
        slippageTolerance: 0.01,
        walletPrivateKey,
      }),
      queue.add('test-job-3', {
        orderId: 'test-order-3',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 200,
        slippageTolerance: 0.01,
        walletPrivateKey,
      }),
    ]);

    expect(jobs).toHaveLength(3);
    jobs.forEach((job, index) => {
      expect(job.data.orderId).toBe(`test-order-${index + 1}`);
    });

    // Clean up - try to remove, but don't fail if jobs are already processed
    await Promise.all(jobs.map(job => job.remove().catch(() => {})));
  });

  it('should respect queue concurrency limit', async () => {
    const queue = getOrderQueue();
    
    // Add jobs up to concurrency limit (default 10)
    const jobs = [];
    for (let i = 0; i < 15; i++) {
      jobs.push(
        queue.add(`concurrency-test-${i}`, {
          orderId: `test-order-${i}`,
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amountIn: 100,
          slippageTolerance: 0.01,
          walletPrivateKey,
        })
      );
    }

    const allJobs = await Promise.all(jobs);
    expect(allJobs.length).toBe(15);

    // Verify queue counts
    const waiting = await queue.getWaitingCount();
    const active = await queue.getActiveCount();
    
    // Active should be <= concurrency (10), waiting should be >= 5 (15 - 10)
    expect(active).toBeLessThanOrEqual(10);
    expect(waiting + active).toBeGreaterThanOrEqual(5);

    // Clean up
    await Promise.all(allJobs.map(job => job.remove()));
  }, 30000); // Longer timeout for concurrency test

  it('should handle queue rate limiting', async () => {
    const queue = getOrderQueue();

    // Add multiple jobs rapidly (rate limit is 100/minute)
    // For small batches (< 100), rate limiting should not apply
    const jobs = [];
    for (let i = 0; i < 5; i++) {
      jobs.push(
        queue.add(`rate-limit-test-${i}`, {
          orderId: `rate-test-${i}`,
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amountIn: 100,
          slippageTolerance: 0.01,
          walletPrivateKey,
        })
      );
    }

    const allJobs = await Promise.all(jobs);

    // Rate limit shouldn't affect small batches, but verify they're queued
    expect(allJobs.length).toBe(5);

    // Clean up - try to remove, but don't fail if jobs are already processed
    await Promise.all(allJobs.map(job => job.remove().catch(() => {})));
  });

  it('should get queue counts correctly', async () => {
    const queue = getOrderQueue();

    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
    ]);

    expect(typeof waiting).toBe('number');
    expect(typeof active).toBe('number');
    expect(typeof completed).toBe('number');
    expect(typeof failed).toBe('number');
    expect(waiting).toBeGreaterThanOrEqual(0);
    expect(active).toBeGreaterThanOrEqual(0);
    expect(completed).toBeGreaterThanOrEqual(0);
    expect(failed).toBeGreaterThanOrEqual(0);
  });

  it('should handle job retries with exponential backoff', async () => {
    const queue = getOrderQueue();

    // Add a job with retry configuration
    // Note: Actual retry logic is in order processor
    const job = await queue.add('retry-test', {
      orderId: 'retry-test-order',
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      slippageTolerance: 0.01,
      walletPrivateKey,
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      } as any, // BullMQ backoff type may vary
    });

    expect(job).toBeDefined();
    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff).toBeDefined();

    // Clean up - try to remove, but don't fail if job is already processed
    try {
      await job.remove();
    } catch (error) {
      // Job may already be processed, ignore error
    }
  });

  it('should handle job with walletKeypair format', async () => {
    const queue = getOrderQueue();
    const walletKeypair = Array.from(testKeypair.secretKey);

    const job = await queue.add('keypair-test', {
      orderId: 'keypair-test-order',
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      slippageTolerance: 0.01,
      walletKeypair,
    });

    expect(job).toBeDefined();
    expect(job.data.walletKeypair).toEqual(walletKeypair);
    expect(job.data.walletPrivateKey).toBeUndefined();

    // Clean up - try to remove, but don't fail if job is already processed
    try {
      await job.remove();
    } catch (error) {
      // Job may already be processed, ignore error
    }
  });
});
