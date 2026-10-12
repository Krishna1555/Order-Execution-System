import { OrderService } from '../../services/order.service';
import { OrderType, OrderStatus } from '../../types/order.types';
import { OrderModel } from '../../models/order.model';

jest.mock('../../models/order.model');

describe('Order Service', () => {
  let orderService: OrderService;
  let mockOrderModel: jest.Mocked<OrderModel>;

  beforeEach(() => {
    mockOrderModel = new OrderModel() as jest.Mocked<OrderModel>;
    orderService = new OrderService();
    (orderService as any).orderModel = mockOrderModel;
  });

  it('should create order with valid request and wallet', async () => {
    const testKeypair = Keypair.generate();
    const walletPrivateKey = require('bs58').encode(testKeypair.secretKey);
    const userWalletAddress = testKeypair.publicKey.toBase58();

    const request = {
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      orderType: OrderType.MARKET,
      walletPrivateKey,
    };

    const mockOrder = {
      id: 'test-id',
      orderId: 'test-order-id',
      status: OrderStatus.PENDING,
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      slippageTolerance: 0.01,
      orderType: OrderType.MARKET,
      userWalletAddress,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockOrderModel.create = jest.fn().mockResolvedValue(mockOrder);

    const order = await orderService.createOrder(request);

    expect(order).toBeDefined();
    expect(order.status).toBe(OrderStatus.PENDING);
    expect(order.userWalletAddress).toBe(userWalletAddress);
    expect(mockOrderModel.create).toHaveBeenCalled();
  });

  it('should get order by orderId', async () => {
    const mockOrder = {
      id: 'test-id',
      orderId: 'test-order-id',
      status: OrderStatus.PENDING,
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      slippageTolerance: 0.01,
      orderType: OrderType.MARKET,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockOrderModel.findByOrderId = jest.fn().mockResolvedValue(mockOrder);

    const order = await orderService.getOrder('test-order-id');

    expect(order).toBeDefined();
    expect(order?.orderId).toBe('test-order-id');
  });

  it('should update order status', async () => {
    const mockOrder = {
      id: 'test-id',
      orderId: 'test-order-id',
      status: OrderStatus.CONFIRMED,
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amountIn: 100,
      slippageTolerance: 0.01,
      orderType: OrderType.MARKET,
      txHash: 'test-tx-hash',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockOrderModel.updateStatus = jest.fn().mockResolvedValue(mockOrder);

    const order = await orderService.updateOrderStatus('test-order-id', OrderStatus.CONFIRMED, {
      txHash: 'test-tx-hash',
    });

    expect(order.status).toBe(OrderStatus.CONFIRMED);
    expect(order.txHash).toBe('test-tx-hash');
  });
});
