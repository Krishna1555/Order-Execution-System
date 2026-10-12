import { OrderStatus } from '../types/order.types';
import { WebSocketMessage } from '../types/websocket.types';
import { websocketService } from './websocket.service';
import { getRedis } from '../queue/order.queue';
import { logger } from '../utils/logger';
import { config } from '../config';

export class StatusService {
  /**
   * Broadcast status update to WebSocket clients (local service)
   * This is used when WebSocket service is in the same process
   */
  broadcastStatusUpdate(
    orderId: string,
    status: OrderStatus,
    data?: {
      txHash?: string;
      executedPrice?: number;
      amountOut?: number;
      selectedDex?: string;
      explorerLink?: string;
      error?: string;
    }
  ): void {
    const message: WebSocketMessage = {
      type: status === OrderStatus.CONFIRMED ? 'confirmation' : status === OrderStatus.FAILED ? 'error' : 'status_update',
      orderId,
      status,
      data: {
        ...data,
        timestamp: new Date().toISOString(),
      },
    };

    logger.info('Broadcasting WebSocket status update', {
      orderId,
      status,
      messageType: message.type,
      hasTxHash: !!data?.txHash,
      hasExplorerLink: !!data?.explorerLink,
      selectedDex: data?.selectedDex,
      error: data?.error,
    });

    // If WebSocket service is enabled in this process, send directly
    if (config.service.enableWebSocket) {
      websocketService.sendStatusUpdate(orderId, message);
    }

    // Always publish to Redis pub/sub for cross-service communication
    this.publishStatusUpdate(orderId, status, data);

    logger.info('Status update broadcasted', { orderId, status, data });
  }

  /**
   * Publish status update to Redis pub/sub channel
   * This is used for cross-service communication (e.g., worker -> WebSocket service)
   */
  publishStatusUpdate(
    orderId: string,
    status: OrderStatus,
    data?: {
      txHash?: string;
      executedPrice?: number;
      amountOut?: number;
      selectedDex?: string;
      explorerLink?: string;
      error?: string;
    }
  ): void {
    try {
      const redis = getRedis();
      const channel = `order:status:${orderId}`;
      const message: WebSocketMessage = {
        type: status === OrderStatus.CONFIRMED ? 'confirmation' : status === OrderStatus.FAILED ? 'error' : 'status_update',
        orderId,
        status,
        data: {
          ...data,
          timestamp: new Date().toISOString(),
        },
      };

      redis.publish(channel, JSON.stringify(message));
      logger.debug('Status update published to Redis', { orderId, status, channel });
    } catch (error) {
      logger.error('Error publishing status update to Redis', { orderId, status, error });
    }
  }
}

export const statusService = new StatusService();
