import { v4 as uuidv4 } from 'uuid';
import { OrderModel } from '../models/order.model';
import { Order, OrderRequest, OrderStatus, OrderType } from '../types/order.types';
import { validateOrderRequest } from '../utils/validation';
import { logger } from '../utils/logger';
import { parseUserWallet } from '../utils/solana';

export class OrderService {
  private orderModel: OrderModel;

  constructor() {
    this.orderModel = new OrderModel();
  }

  async createOrder(request: OrderRequest, userWalletAddress?: string): Promise<Order> {
    // Validate request (includes wallet validation)
    validateOrderRequest(request);

    // Parse wallet to get address if not provided
    if (!userWalletAddress) {
      const userKeypair = parseUserWallet(request.walletPrivateKey, request.walletKeypair);
      userWalletAddress = userKeypair.publicKey.toBase58();
    }

    // Generate unique order ID
    const orderId = uuidv4();

    // Create order with pending status
    const order: Omit<Order, 'id' | 'createdAt' | 'updatedAt'> = {
      orderId,
      status: OrderStatus.PENDING,
      tokenIn: request.tokenIn,
      tokenOut: request.tokenOut,
      amountIn: request.amountIn,
      slippageTolerance: request.slippageTolerance || 0.01,
      orderType: request.orderType || OrderType.MARKET,
      userWalletAddress, // Store user wallet address for reference (public key only)
    };

    const createdOrder = await this.orderModel.create(order);
    logger.info('Order created', { 
      orderId, 
      status: createdOrder.status,
      userWallet: userWalletAddress 
    });

    return createdOrder;
  }

  async getOrder(orderId: string): Promise<Order | null> {
    return await this.orderModel.findByOrderId(orderId);
  }

  async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    updates?: {
      selectedDex?: string;
      txHash?: string;
      executedPrice?: number;
      amountOut?: number;
      explorerLink?: string;
      error?: string;
    }
  ): Promise<Order> {
    return await this.orderModel.updateStatus(orderId, status, updates);
  }
}

export const orderService = new OrderService();
