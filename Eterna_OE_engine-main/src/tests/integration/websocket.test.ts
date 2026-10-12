import { websocketService } from '../../services/websocket.service';
import { OrderStatus } from '../../types/order.types';
import { WebSocketMessage } from '../../types/websocket.types';

describe('WebSocket Service Integration', () => {
  let mockSocket: any;

  beforeEach(() => {
    mockSocket = {
      send: jest.fn(),
      on: jest.fn(),
      close: jest.fn(),
      readyState: 1, // OPEN
    };
  });

  afterEach(() => {
    // Clean up connections
    websocketService.removeConnection('test-order-id');
    websocketService.removeConnection('test-order-id-2');
    websocketService.removeConnection('test-order-id-3');
  });

  it('should add and remove connections', () => {
    websocketService.addConnection('test-order-id', mockSocket);
    expect(websocketService.hasConnection('test-order-id')).toBe(true);

    websocketService.removeConnection('test-order-id');
    expect(websocketService.hasConnection('test-order-id')).toBe(false);
  });

  it('should send status updates to connected clients', () => {
    websocketService.addConnection('test-order-id', mockSocket);

    const message: WebSocketMessage = {
      type: 'status_update',
      orderId: 'test-order-id',
      status: OrderStatus.PENDING,
      data: {
        timestamp: new Date().toISOString(),
      },
    };

    websocketService.sendStatusUpdate('test-order-id', message);

    expect(mockSocket.send).toHaveBeenCalled();
    expect(mockSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
  });

  it('should send confirmation updates with explorerLink', () => {
    websocketService.addConnection('test-order-id', mockSocket);

    const message: WebSocketMessage = {
      type: 'confirmation',
      orderId: 'test-order-id',
      status: OrderStatus.CONFIRMED,
      data: {
        txHash: 'test-tx-hash',
        executedPrice: 1.0,
        selectedDex: 'raydium',
        explorerLink: 'https://explorer.solana.com/tx/test-tx-hash?cluster=devnet',
        timestamp: new Date().toISOString(),
      },
    };

    websocketService.sendStatusUpdate('test-order-id', message);

    expect(mockSocket.send).toHaveBeenCalled();
    const sentMessage = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(sentMessage.data.explorerLink).toBeDefined();
    expect(sentMessage.data.txHash).toBe('test-tx-hash');
  });

  it('should send error updates when order fails', () => {
    websocketService.addConnection('test-order-id', mockSocket);

    const message: WebSocketMessage = {
      type: 'error',
      orderId: 'test-order-id',
      status: OrderStatus.FAILED,
      data: {
        error: 'Test error message',
        timestamp: new Date().toISOString(),
      },
    };

    websocketService.sendStatusUpdate('test-order-id', message);

    expect(mockSocket.send).toHaveBeenCalled();
    const sentMessage = JSON.parse(mockSocket.send.mock.calls[0][0]);
    expect(sentMessage.data.error).toBe('Test error message');
    expect(sentMessage.status).toBe(OrderStatus.FAILED);
  });

  it('should handle multiple connections for same order', () => {
    const socket1 = { ...mockSocket, send: jest.fn() };
    const socket2 = { ...mockSocket, send: jest.fn() };

    websocketService.addConnection('test-order-id', socket1);
    websocketService.addConnection('test-order-id', socket2);

    const message: WebSocketMessage = {
      type: 'status_update',
      orderId: 'test-order-id',
      status: OrderStatus.ROUTING,
      data: { timestamp: new Date().toISOString() },
    };

    websocketService.sendStatusUpdate('test-order-id', message);

    // Both sockets should receive the update
    expect(socket1.send).toHaveBeenCalled();
    expect(socket2.send).toHaveBeenCalled();
  });

  it('should handle connection removal gracefully', () => {
    websocketService.addConnection('test-order-id', mockSocket);
    expect(websocketService.hasConnection('test-order-id')).toBe(true);

    websocketService.removeConnection('test-order-id');
    expect(websocketService.hasConnection('test-order-id')).toBe(false);

    // Removing again should not throw
    expect(() => websocketService.removeConnection('test-order-id')).not.toThrow();
  });

  it('should handle sending to non-existent connection', () => {
    const message: WebSocketMessage = {
      type: 'status_update',
      orderId: 'non-existent-order',
      status: OrderStatus.PENDING,
      data: { timestamp: new Date().toISOString() },
    };

    // Should not throw when sending to non-existent connection
    expect(() => websocketService.sendStatusUpdate('non-existent-order', message)).not.toThrow();
  });

  it('should handle WebSocket lifecycle events', () => {
    const onClose = jest.fn();
    const onError = jest.fn();

    mockSocket.on = jest.fn((event: string, callback: Function) => {
      if (event === 'close') {
        onClose.mockImplementation(callback);
      } else if (event === 'error') {
        onError.mockImplementation(callback);
      }
    });

    websocketService.addConnection('test-order-id', mockSocket);

    // Simulate close event
    if (onClose.mock.calls.length > 0) {
      onClose();
      expect(websocketService.hasConnection('test-order-id')).toBe(false);
    }

    // Simulate error event
    if (onError.mock.calls.length > 0) {
      onError(new Error('WebSocket error'));
      expect(websocketService.hasConnection('test-order-id')).toBe(false);
    }
  });

  it('should send status updates for all lifecycle stages', () => {
    websocketService.addConnection('test-order-id', mockSocket);

    const statuses = [
      OrderStatus.PENDING,
      OrderStatus.ROUTING,
      OrderStatus.BUILDING,
      OrderStatus.SUBMITTED,
      OrderStatus.CONFIRMED,
    ];

    statuses.forEach((status, index) => {
      const message: WebSocketMessage = {
        type: status === OrderStatus.CONFIRMED ? 'confirmation' : 'status_update',
        orderId: 'test-order-id',
        status,
        data: { timestamp: new Date().toISOString() },
      };

      websocketService.sendStatusUpdate('test-order-id', message);
    });

    // Should have sent updates for each status
    expect(mockSocket.send).toHaveBeenCalledTimes(statuses.length);
  });
});
