import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '../models/database';
import { getRedis, getOrderQueue } from '../queue/order.queue';
import { logger } from '../utils/logger';

export async function healthRoutes(fastify: FastifyInstance) {
  // GET /health - Overall health check
  fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // GET /health/db - Database health check
  fastify.get('/health/db', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      return reply.send({
        status: 'ok',
        service: 'postgresql',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error('Database health check failed', { error: error.message });
      return reply.status(503).send({
        status: 'error',
        service: 'postgresql',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // GET /health/redis - Redis health check
  fastify.get('/health/redis', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const redis = getRedis();
      await redis.ping();
      return reply.send({
        status: 'ok',
        service: 'redis',
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error('Redis health check failed', { error: error.message });
      return reply.status(503).send({
        status: 'error',
        service: 'redis',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // GET /health/queue - Queue health check
  fastify.get('/health/queue', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const queue = getOrderQueue();
      const [waiting, active, completed, failed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
      ]);

      return reply.send({
        status: 'ok',
        service: 'queue',
        counts: {
          waiting,
          active,
          completed,
          failed,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error('Queue health check failed', { error: error.message });
      return reply.status(503).send({
        status: 'error',
        service: 'queue',
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  });
}
