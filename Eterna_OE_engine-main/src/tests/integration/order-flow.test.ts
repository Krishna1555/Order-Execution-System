import { OrderService } from '../../services/order.service';
import { getOrderQueue } from '../../queue/order.queue';
import { OrderType } from '../../types/order.types';
import { Keypair } from '@solana/web3.js';
import * as bs58 from 'bs58';

describe('Order Flow Integration', () => {
  let orderService: OrderService;
  let userKeypair: Keypair;

  beforeAll(async () => {
    // Initialize services
    orderService = new OrderService();
    // Generate test keypair for user wallet
    userKeypair = Keypair.generate();
  });

  it('should create and queue an order with user wallet', async () => {
    const walletPrivateKey = bs58.encode(userKeypair.secretKey);
    
    const request = {
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletPrivateKey,
    };

    const order = await orderService.createOrder(request);
    expect(order).toBeDefined();
    expect(order.status).toBe('pending');
    expect(order.userWalletAddress).toBe(userKeypair.publicKey.toBase58());

    const queue = getOrderQueue();
    const job = await queue.add('execute-order', {
      orderId: order.orderId,
      tokenIn: order.tokenIn,
      tokenOut: order.tokenOut,
      amountIn: order.amountIn,
      slippageTolerance: order.slippageTolerance,
      walletPrivateKey,
    });

    expect(job).toBeDefined();
    expect(job.data.orderId).toBe(order.orderId);
    expect(job.data.walletPrivateKey).toBe(walletPrivateKey);
  });

  it('should create order with walletKeypair array format', async () => {
    const walletKeypair = Array.from(userKeypair.secretKey);
    
    const request = {
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletKeypair,
    };

    const order = await orderService.createOrder(request);
    expect(order).toBeDefined();
    expect(order.status).toBe('pending');
    expect(order.userWalletAddress).toBe(userKeypair.publicKey.toBase58());
  });

  it('should validate wallet format and reject invalid wallets', async () => {
    const invalidRequest = {
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletPrivateKey: 'invalid-key-format',
    };

    await expect(orderService.createOrder(invalidRequest)).rejects.toThrow();
  });

  it('should handle complete order lifecycle with user wallet', async () => {
    const walletPrivateKey = bs58.encode(userKeypair.secretKey);
    
    // Create order
    const request = {
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletPrivateKey,
    };

    const order = await orderService.createOrder(request);
    expect(order.status).toBe('pending');
    expect(order.userWalletAddress).toBe(userKeypair.publicKey.toBase58());

    // Update to routing
    await orderService.updateOrderStatus(order.orderId, 'routing' as any);
    const routingOrder = await orderService.getOrder(order.orderId);
    expect(routingOrder?.status).toBe('routing');

    // Update to building
    await orderService.updateOrderStatus(order.orderId, 'building' as any, {
      selectedDex: 'raydium',
    });
    const buildingOrder = await orderService.getOrder(order.orderId);
    expect(buildingOrder?.status).toBe('building');
    expect(buildingOrder?.selectedDex).toBe('raydium');

    // Update to confirmed with transaction details
    const txHash = 'test-transaction-hash-123';
    await orderService.updateOrderStatus(order.orderId, 'confirmed' as any, {
      selectedDex: 'raydium',
      txHash,
      executedPrice: 0.985,
      amountOut: 98.5,
      explorerLink: 'https://explorer.solana.com/tx/test-transaction-hash-123?cluster=devnet',
    });
    const confirmedOrder = await orderService.getOrder(order.orderId);
    expect(confirmedOrder?.status).toBe('confirmed');
    expect(confirmedOrder?.txHash).toBe(txHash);
    expect(confirmedOrder?.explorerLink).toBeDefined();
    expect(confirmedOrder?.executedPrice).toBe(0.985);
    expect(confirmedOrder?.amountOut).toBe(98.5);
  });

  it('should handle order failure with error message', async () => {
    const walletPrivateKey = bs58.encode(userKeypair.secretKey);
    
    const request = {
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletPrivateKey,
    };

    const order = await orderService.createOrder(request);
    
    // Simulate failure
    await orderService.updateOrderStatus(order.orderId, 'failed' as any, {
      error: 'Slippage tolerance exceeded',
    });

    const failedOrder = await orderService.getOrder(order.orderId);
    expect(failedOrder?.status).toBe('failed');
    expect(failedOrder?.error).toBe('Slippage tolerance exceeded');
  });

  it('should handle multiple orders from same user wallet', async () => {
    const walletPrivateKey = bs58.encode(userKeypair.secretKey);
    
    const orders = await Promise.all([
      orderService.createOrder({
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 100,
        orderType: OrderType.MARKET,
        walletPrivateKey,
      }),
      orderService.createOrder({
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amountIn: 50,
        orderType: OrderType.MARKET,
        walletPrivateKey,
      }),
      orderService.createOrder({
        tokenIn: 'USDC',
        tokenOut: 'SOL',
        amountIn: 200,
        orderType: OrderType.MARKET,
        walletPrivateKey,
      }),
    ]);

    expect(orders).toHaveLength(3);
    orders.forEach(order => {
      expect(order.userWalletAddress).toBe(userKeypair.publicKey.toBase58());
      expect(order.status).toBe('pending');
    });

    // Verify all orders have same wallet address
    const uniqueWallets = new Set(orders.map(o => o.userWalletAddress));
    expect(uniqueWallets.size).toBe(1);
  });

  it('should handle orders from different user wallets', async () => {
    const keypair1 = Keypair.generate();
    const keypair2 = Keypair.generate();
    const wallet1 = bs58.encode(keypair1.secretKey);
    const wallet2 = bs58.encode(keypair2.secretKey);

    const order1 = await orderService.createOrder({
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletPrivateKey: wallet1,
    });

    const order2 = await orderService.createOrder({
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletPrivateKey: wallet2,
    });

    expect(order1.userWalletAddress).toBe(keypair1.publicKey.toBase58());
    expect(order2.userWalletAddress).toBe(keypair2.publicKey.toBase58());
    expect(order1.userWalletAddress).not.toBe(order2.userWalletAddress);
  });

  it('should persist order with explorerLink when confirmed', async () => {
    const walletPrivateKey = bs58.encode(userKeypair.secretKey);
    
    const order = await orderService.createOrder({
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletPrivateKey,
    });

    const txHash = 'confirmed-tx-hash-456';
    const explorerLink = 'https://explorer.solana.com/tx/confirmed-tx-hash-456?cluster=devnet';

    await orderService.updateOrderStatus(order.orderId, 'confirmed' as any, {
      txHash,
      executedPrice: 0.99,
      amountOut: 99,
      explorerLink,
    });

    const confirmedOrder = await orderService.getOrder(order.orderId);
    expect(confirmedOrder?.explorerLink).toBe(explorerLink);
    expect(confirmedOrder?.txHash).toBe(txHash);
  });

  it('should handle order status transitions correctly', async () => {
    const walletPrivateKey = bs58.encode(userKeypair.secretKey);
    
    const order = await orderService.createOrder({
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletPrivateKey,
    });

    // Verify status transitions
    const statuses = ['pending', 'routing', 'building', 'submitted', 'confirmed'] as const;
    
    for (const status of statuses) {
      await orderService.updateOrderStatus(order.orderId, status as any);
      const updatedOrder = await orderService.getOrder(order.orderId);
      expect(updatedOrder?.status).toBe(status);
    }
  });
});
