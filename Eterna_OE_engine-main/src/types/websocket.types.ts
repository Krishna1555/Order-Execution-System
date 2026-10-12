import { OrderStatus } from './order.types';

export interface WebSocketMessage {
  type: 'status_update' | 'error' | 'confirmation';
  orderId: string;
  status: OrderStatus;
  data?: {
    txHash?: string;
    executedPrice?: number;
    amountOut?: number;
    selectedDex?: string;
    explorerLink?: string;
    error?: string;
    timestamp: string;
  };
}

export interface WebSocketConnection {
  socket: any;
  orderId: string;
  connectedAt: Date;
}
