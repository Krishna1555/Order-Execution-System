import Fastify, { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { config } from './config';
import { initializeDatabase, closeDatabase } from './config/database';
import { startWorker, stopWorker } from './config/queue';
import { ordersRoutes } from './routes/orders';
import { healthRoutes } from './routes/health';
import { logger } from './utils/logger';

let fastify: FastifyInstance | null = null;

// Initialize Fastify instance
const createFastifyInstance = (): FastifyInstance => {
  const instance = Fastify({
    logger: false, // We use our custom logger
  });

  // Register WebSocket support if enabled
  if (config.service.enableWebSocket) {
    instance.register(websocket);
  }

  // Register routes conditionally
  if (config.service.enableHttpServer) {
    if (config.service.enableWebSocket || config.service.type === 'api' || config.service.type === 'websocket') {
      // Register orders routes (includes API endpoints, optionally WebSocket)
      instance.register(ordersRoutes);
    }
    if (config.service.enableHealth || config.service.type === 'health') {
      // Register health routes
      instance.register(healthRoutes);
    }
  }

  return instance;
};

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down server...', { serviceType: config.service.type });
  try {
    if (fastify) {
      await fastify.close();
    }
    if (config.service.enableWebSocket) {
      const { websocketService } = await import('./services/websocket.service');
      await websocketService.cleanup();
    }
    if (config.service.enableWorker) {
      await stopWorker();
    }
    await closeDatabase();
    logger.info('Server shut down successfully');
    process.exit(0);
  } catch (error) {
    const errorDetails = error instanceof Error 
      ? { message: error.message, stack: error.stack, name: error.name }
      : { error: String(error) };
    logger.error('Error during shutdown', errorDetails);
    process.exit(1);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start server
const start = async () => {
  try {
    logger.info('Starting server', {
      serviceType: config.service.type,
      enableHttpServer: config.service.enableHttpServer,
      enableWebSocket: config.service.enableWebSocket,
      enableWorker: config.service.enableWorker,
      enableHealth: config.service.enableHealth,
    });

    // Initialize database connections
    await initializeDatabase();

    // Start queue worker if enabled
    if (config.service.enableWorker) {
      startWorker();
    }

    // Start HTTP server if enabled
    if (config.service.enableHttpServer) {
      fastify = createFastifyInstance();
      await fastify.listen({ port: config.port, host: '0.0.0.0' });
      logger.info(`Server listening on port ${config.port}`, {
        serviceType: config.service.type,
      });
    } else {
      // If no HTTP server, keep process alive for worker
      logger.info('Running as worker-only service (no HTTP server)');
      // Keep process alive
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    }
  } catch (error) {
    const errorDetails = error instanceof Error 
      ? { message: error.message, stack: error.stack, name: error.name }
      : { error: String(error) };
    logger.error('Error starting server', errorDetails);
    process.exit(1);
  }
};

start();