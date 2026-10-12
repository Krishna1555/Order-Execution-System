import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOrderQueue } from '../queue/order.queue';
import { orderService } from '../services/order.service';
import { websocketService } from '../services/websocket.service';
import { OrderRequest, OrderType } from '../types/order.types';
import { logger } from '../utils/logger';
import { parseUserWallet } from '../utils/solana';
import { config } from '../config';

export async function ordersRoutes(fastify: FastifyInstance) {
  // Register API routes
  registerApiRoutes(fastify);
}

function registerApiRoutes(fastify: FastifyInstance): void {
  // HTTP → WebSocket Pattern: Single endpoint /api/orders/execute handles both protocols
  // - POST /api/orders/execute: Creates order, returns orderId
  // - GET /api/orders/execute?orderId=xxx: WebSocket connection for status updates
  // Note: Fastify WebSocket requires GET method for wsHandler, so we register POST separately
  if (config.service.enableWebSocket) {
    // Register POST route for order creation
    fastify.post('/api/orders/execute', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = request.body as OrderRequest;

        logger.info('Received order execution request', {
          tokenIn: body.tokenIn,
          tokenOut: body.tokenOut,
          amountIn: body.amountIn,
          orderType: body.orderType || OrderType.MARKET,
          slippageTolerance: body.slippageTolerance || 0.01,
        });

        // Parse and validate user wallet (validation already checks this)
        const userKeypair = parseUserWallet(body.walletPrivateKey, body.walletKeypair);
        const userWalletAddress = userKeypair.publicKey.toBase58();

        // Validate and create order (wallet validation happens in createOrder)
        const order = await orderService.createOrder({
          ...body,
          orderType: body.orderType || OrderType.MARKET,
        });

        logger.info('Order created in database', {
          orderId: order.orderId,
          status: order.status,
          userWallet: userWalletAddress,
        });

        // Add order to queue with wallet information
        const queue = getOrderQueue();
        const job = await queue.add('execute-order', {
          orderId: order.orderId,
          tokenIn: order.tokenIn,
          tokenOut: order.tokenOut,
          amountIn: order.amountIn,
          slippageTolerance: order.slippageTolerance,
          walletPrivateKey: body.walletPrivateKey,
          walletKeypair: body.walletKeypair,
        });

        // Log queue statistics
        const [waiting, active, completed, failed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
        ]);

        logger.info('Order queued for execution', {
          orderId: order.orderId,
          jobId: job.id,
          userWallet: userWalletAddress,
          queueStats: {
            waiting,
            active,
            completed,
            failed,
          },
        });

        // Return HTTP response with orderId and WebSocket URL
        return reply.status(201).send({
          orderId: order.orderId,
          status: order.status,
          message: 'Order created and queued for execution',
          wsUrl: `/api/orders/execute?orderId=${order.orderId}`,
        });
      } catch (error: any) {
        logger.error('Error creating order', {
          error: error.message,
          tokenIn: (request.body as OrderRequest)?.tokenIn,
          tokenOut: (request.body as OrderRequest)?.tokenOut,
        });
        return reply.status(400).send({
          error: error.message || 'Failed to create order',
        });
      }
    });

    // Register GET route with WebSocket handler for status updates
    fastify.route({
      method: 'GET',
      url: '/api/orders/execute',
      // WebSocket handler - handles GET requests with WebSocket upgrade
      // In fastify.route() wsHandler, the first parameter is the WebSocket socket itself
      wsHandler: (socket, req: FastifyRequest) => {
        const query = req.query as { orderId?: string };
        const orderId = query.orderId;

        if (!orderId) {
          socket.close(1008, 'orderId required in query parameters');
          logger.warn('WebSocket connection rejected: orderId missing', {
            query: req.query,
          });
          return;
        }

        logger.info('WebSocket connection established', { orderId });

        // Store WebSocket connection (event handlers for 'close' and 'error' are registered in addConnection)
        websocketService.addConnection(orderId, socket);

        // Send initial status
        socket.send(
          JSON.stringify({
            type: 'status_update',
            orderId,
            status: 'pending',
            data: {
              timestamp: new Date().toISOString(),
            },
          })
        );
      },
      // HTTP handler for GET requests (non-WebSocket)
      handler: async (_request: FastifyRequest, reply: FastifyReply) => {
        // If it's a GET request without WebSocket upgrade, return info about the endpoint
        return reply.status(200).send({
          message: 'Use POST to create an order, or connect via WebSocket with ?orderId=xxx',
          endpoints: {
            createOrder: 'POST /api/orders/execute',
            websocket: 'GET /api/orders/execute?orderId=xxx (with WebSocket upgrade)',
          },
        });
      },
    });
  } else {
    // If WebSocket is disabled, only register POST handler
    fastify.post('/api/orders/execute', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = request.body as OrderRequest;

        logger.info('Received order execution request', {
          tokenIn: body.tokenIn,
          tokenOut: body.tokenOut,
          amountIn: body.amountIn,
          orderType: body.orderType || OrderType.MARKET,
          slippageTolerance: body.slippageTolerance || 0.01,
        });

        // Parse and validate user wallet (validation already checks this)
        const userKeypair = parseUserWallet(body.walletPrivateKey, body.walletKeypair);
        const userWalletAddress = userKeypair.publicKey.toBase58();

        // Validate and create order (wallet validation happens in createOrder)
        const order = await orderService.createOrder({
          ...body,
          orderType: body.orderType || OrderType.MARKET,
        });

        logger.info('Order created in database', {
          orderId: order.orderId,
          status: order.status,
          userWallet: userWalletAddress,
        });

        // Add order to queue with wallet information
        const queue = getOrderQueue();
        const job = await queue.add('execute-order', {
          orderId: order.orderId,
          tokenIn: order.tokenIn,
          tokenOut: order.tokenOut,
          amountIn: order.amountIn,
          slippageTolerance: order.slippageTolerance,
          walletPrivateKey: body.walletPrivateKey,
          walletKeypair: body.walletKeypair,
        });

        // Log queue statistics
        const [waiting, active, completed, failed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
          queue.getCompletedCount(),
          queue.getFailedCount(),
        ]);

        logger.info('Order queued for execution', {
          orderId: order.orderId,
          jobId: job.id,
          userWallet: userWalletAddress,
          queueStats: {
            waiting,
            active,
            completed,
            failed,
          },
        });

        // Return HTTP response with orderId (don't expose wallet info)
        return reply.status(201).send({
          orderId: order.orderId,
          status: order.status,
          message: 'Order created and queued for execution',
        });
      } catch (error: any) {
        logger.error('Error creating order', {
          error: error.message,
          tokenIn: (request.body as OrderRequest)?.tokenIn,
          tokenOut: (request.body as OrderRequest)?.tokenOut,
        });
        return reply.status(400).send({
          error: error.message || 'Failed to create order',
        });
      }
    });
  }

  // GET /api/orders/:orderId - Get order status (HTTP)
  fastify.get('/api/orders/:orderId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const params = request.params as { orderId: string };
      const order = await orderService.getOrder(params.orderId);

      if (!order) {
        return reply.status(404).send({
          error: 'Order not found',
        });
      }

      return reply.send(order);
    } catch (error: any) {
      logger.error('Error fetching order', { error: error.message });
      return reply.status(500).send({
        error: 'Failed to fetch order',
      });
    }
  });
}
