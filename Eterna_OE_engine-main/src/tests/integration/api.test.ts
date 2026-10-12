import { FastifyInstance } from 'fastify';
import buildApp from '../../server';
import { OrderType } from '../../types/order.types';
import { Keypair } from '@solana/web3.js';
import * as bs58 from 'bs58';
import { closePool } from '../../models/database';
import { closeQueue } from '../../queue/order.queue';

describe('API Endpoint Integration', () => {
  let app: FastifyInstance;
  let testKeypair: Keypair;
  let walletPrivateKey: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    testKeypair = Keypair.generate();
    walletPrivateKey = bs58.encode(testKeypair.secretKey);
  });

  afterAll(async () => {
    await app.close();
    await closePool();
    await closeQueue();
  });

  describe('POST /api/orders/execute', () => {
    it('should create order with valid request and wallet', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amountIn: 100,
          slippageTolerance: 0.01,
          orderType: OrderType.MARKET,
          walletPrivateKey,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.orderId).toBeDefined();
      expect(body.status).toBe('pending');
      expect(body.message).toBeDefined();
    });

    it('should reject order without wallet', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amountIn: 100,
          orderType: OrderType.MARKET,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Wallet is required');
    });

    it('should reject order with invalid wallet format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amountIn: 100,
          orderType: OrderType.MARKET,
          walletPrivateKey: 'invalid-format',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBeDefined();
    });

    it('should reject order with both walletPrivateKey and walletKeypair', async () => {
      const walletKeypair = Array.from(testKeypair.secretKey);
      
      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amountIn: 100,
          orderType: OrderType.MARKET,
          walletPrivateKey,
          walletKeypair,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('only one wallet format');
    });

    it('should accept order with walletKeypair format', async () => {
      const walletKeypair = Array.from(testKeypair.secretKey);
      
      const response = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amountIn: 100,
          orderType: OrderType.MARKET,
          walletKeypair,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.orderId).toBeDefined();
      expect(body.status).toBe('pending');
    });

    it('should validate order input fields', async () => {
      // Missing tokenIn
      const response1 = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          tokenOut: 'USDC',
          amountIn: 100,
          orderType: OrderType.MARKET,
          walletPrivateKey,
        },
      });
      expect(response1.statusCode).toBe(400);

      // Invalid amountIn
      const response2 = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amountIn: -100,
          orderType: OrderType.MARKET,
          walletPrivateKey,
        },
      });
      expect(response2.statusCode).toBe(400);

      // Same tokens
      const response3 = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          tokenIn: 'SOL',
          tokenOut: 'SOL',
          amountIn: 100,
          orderType: OrderType.MARKET,
          walletPrivateKey,
        },
      });
      expect(response3.statusCode).toBe(400);
    });
  });

  describe('GET /api/orders/:orderId', () => {
    it('should get order status with explorerLink when confirmed', async () => {
      // Create order first
      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/orders/execute',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amountIn: 100,
          orderType: OrderType.MARKET,
          walletPrivateKey,
        },
      });

      const createBody = JSON.parse(createResponse.body);
      const orderId = createBody.orderId;

      // Get order status
      const getResponse = await app.inject({
        method: 'GET',
        url: `/api/orders/${orderId}`,
      });

      expect(getResponse.statusCode).toBe(200);
      const order = JSON.parse(getResponse.body);
      expect(order.orderId).toBe(orderId);
      expect(order.status).toBe('pending');
      expect(order.userWalletAddress).toBe(testKeypair.publicKey.toBase58());
    });

    it('should return 404 for non-existent order', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/orders/non-existent-order-id',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Order not found');
    });
  });

  describe('Health Check Endpoints', () => {
    it('should return health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBeDefined();
    });

    it('should check database health', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/db',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBeDefined();
    });

    it('should check Redis health', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/redis',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBeDefined();
    });

    it('should check queue health', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/queue',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBeDefined();
      expect(body.waiting).toBeDefined();
      expect(body.active).toBeDefined();
    });
  });
});
