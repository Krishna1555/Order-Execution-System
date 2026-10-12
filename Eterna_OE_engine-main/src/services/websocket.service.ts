import { WebSocketConnection, WebSocketMessage } from '../types/websocket.types';
import { getRedis } from '../queue/order.queue';
import { logger } from '../utils/logger';
import { config } from '../config';

class WebSocketService {
  private connections: Map<string, WebSocketConnection> = new Map();
  private redisSubscriber: ReturnType<typeof getRedis> | null = null;
  private subscribedChannels: Set<string> = new Set();
  private subscriberInitialized: boolean = false;

  constructor() {
    // Don't initialize Redis subscriber in constructor
    // Initialize on first use (after config is loaded)
  }

  /**
   * Initialize Redis subscriber for cross-service communication
   */
  private initializeRedisSubscriber(): void {
    try {
      this.redisSubscriber = getRedis().duplicate();
      this.redisSubscriber.on('message', (channel: string, message: string) => {
        try {
          const parsedMessage: WebSocketMessage = JSON.parse(message);
          const orderId = parsedMessage.orderId;

          // Broadcast to connected WebSocket clients
          this.sendStatusUpdate(orderId, parsedMessage);
        } catch (error) {
          logger.error('Error parsing Redis pub/sub message', { channel, error });
        }
      });

      this.redisSubscriber.on('error', (error) => {
        logger.error('Redis subscriber error', { error });
      });

      logger.info('Redis pub/sub subscriber initialized for WebSocket service');
    } catch (error) {
      logger.error('Error initializing Redis subscriber', { error });
    }
  }

  /**
   * Subscribe to Redis channel for a specific order
   */
  private subscribeToOrder(orderId: string): void {
    // Initialize Redis subscriber if not already initialized
    if (!this.subscriberInitialized && config.service.enableWebSocket) {
      this.initializeRedisSubscriber();
      this.subscriberInitialized = true;
    }

    if (this.redisSubscriber && !this.subscribedChannels.has(orderId)) {
      const channel = `order:status:${orderId}`;
      this.redisSubscriber.subscribe(channel);
      this.subscribedChannels.add(orderId);
      logger.debug('Subscribed to Redis channel', { orderId, channel });
    }
  }

  addConnection(orderId: string, socket: any): void {
    const connection: WebSocketConnection = {
      socket,
      orderId,
      connectedAt: new Date(),
    };

    this.connections.set(orderId, connection);
    logger.info('WebSocket connection added', { orderId });

    // Subscribe to Redis channel for this order (for cross-service communication)
    this.subscribeToOrder(orderId);

    // Handle connection close
    socket.on('close', () => {
      this.removeConnection(orderId);
    });

    socket.on('error', (error: Error) => {
      logger.error('WebSocket error', { orderId, error });
      this.removeConnection(orderId);
    });
  }

  removeConnection(orderId: string): void {
    if (this.connections.has(orderId)) {
      this.connections.delete(orderId);
      logger.info('WebSocket connection removed', { orderId });
    }

    // Optionally unsubscribe from Redis channel if no connections remain for this order
    // For now, we keep subscriptions active to avoid re-subscription overhead
  }

  sendStatusUpdate(orderId: string, message: WebSocketMessage): void {
    const connection = this.connections.get(orderId);
    if (!connection) {
      logger.warn('No WebSocket connection found for order', { orderId });
      return;
    }

    const socket = connection.socket;
    
    // Check if socket is ready
    if (!socket) {
      logger.error('WebSocket socket is null or undefined', { orderId });
      this.removeConnection(orderId);
      return;
    }

    // Check socket ready state (1 = OPEN, 0 = CONNECTING, 2 = CLOSING, 3 = CLOSED)
    if (socket.readyState !== 1) {
      logger.warn('WebSocket is not in OPEN state', { 
        orderId, 
        readyState: socket.readyState,
        readyStateName: socket.readyState === 0 ? 'CONNECTING' : socket.readyState === 2 ? 'CLOSING' : 'CLOSED'
      });
      if (socket.readyState === 3) {
        // Socket is closed, remove connection
        this.removeConnection(orderId);
      }
      return;
    }

    try {
      const messageStr = JSON.stringify(message);
      socket.send(messageStr);
      logger.info('WebSocket status update sent to client', {
        orderId,
        status: message.status,
        messageType: message.type,
        hasTxHash: !!message.data?.txHash,
        hasExplorerLink: !!(message.data && 'explorerLink' in message.data),
        timestamp: message.data?.timestamp,
      });
    } catch (error: any) {
      // Log detailed error information
      const errorDetails = {
        message: error?.message || String(error),
        name: error?.name,
        stack: error?.stack,
        code: error?.code,
        errno: error?.errno,
        syscall: error?.syscall,
      };
      
      logger.error('Error sending WebSocket message', { 
        orderId, 
        error: errorDetails,
        status: message.status,
        socketReadyState: socket.readyState,
      });
      this.removeConnection(orderId);
    }
  }

  hasConnection(orderId: string): boolean {
    return this.connections.has(orderId);
  }

  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Cleanup Redis subscriber on shutdown
   */
  async cleanup(): Promise<void> {
    if (this.redisSubscriber) {
      const channels = Array.from(this.subscribedChannels).map(id => `order:status:${id}`);
      if (channels.length > 0) {
        await this.redisSubscriber.unsubscribe(...channels);
      }
      await this.redisSubscriber.quit();
      this.redisSubscriber = null;
      this.subscribedChannels.clear();
      logger.info('Redis subscriber cleaned up');
    }
  }
}

export const websocketService = new WebSocketService();
