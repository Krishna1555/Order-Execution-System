import { Pool } from 'pg';
import { getPool } from './database';
import { Order, OrderStatus, OrderType } from '../types/order.types';
import { logger } from '../utils/logger';
import { getSolanaExplorerLink, getCluster } from '../utils/solana';

export class OrderModel {
  private pool: Pool;

  constructor() {
    this.pool = getPool();
  }

  async create(order: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>): Promise<Order> {
    const query = `
      INSERT INTO orders (
        order_id, status, token_in, token_out, amount_in, amount_out,
        executed_price, slippage_tolerance, order_type, selected_dex, tx_hash, error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, order_id, status, token_in, token_out, amount_in, amount_out,
                executed_price, slippage_tolerance, order_type, selected_dex, tx_hash, error,
                created_at, updated_at
    `;

    const values = [
      order.orderId,
      order.status,
      order.tokenIn,
      order.tokenOut,
      order.amountIn,
      order.amountOut || null,
      order.executedPrice || null,
      order.slippageTolerance,
      order.orderType,
      order.selectedDex || null,
      order.txHash || null,
      order.error || null,
    ];

    try {
      const result = await this.pool.query(query, values);
      return this.mapRowToOrder(result.rows[0]);
    } catch (error) {
      logger.error('Error creating order', { error, order });
      throw error;
    }
  }

  async findByOrderId(orderId: string): Promise<Order | null> {
    const query = `
      SELECT id, order_id, status, token_in, token_out, amount_in, amount_out,
             executed_price, slippage_tolerance, order_type, selected_dex, tx_hash, error,
             created_at, updated_at
      FROM orders
      WHERE order_id = $1
    `;

    try {
      const result = await this.pool.query(query, [orderId]);
      if (result.rows.length === 0) {
        return null;
      }
      return this.mapRowToOrder(result.rows[0]);
    } catch (error) {
      logger.error('Error finding order by orderId', { error, orderId });
      throw error;
    }
  }

  async updateStatus(
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
    // Get current status for logging
    let previousStatus: string | undefined;
    try {
      const currentOrder = await this.pool.query('SELECT status FROM orders WHERE order_id = $1', [orderId]);
      previousStatus = currentOrder.rows[0]?.status;
    } catch (error) {
      // Ignore error if order doesn't exist yet - will be caught below
    }

    logger.info('Updating order status in database', {
      orderId,
      status,
      previousStatus,
      updates: {
        selectedDex: updates?.selectedDex,
        hasTxHash: !!updates?.txHash,
        executedPrice: updates?.executedPrice,
        amountOut: updates?.amountOut,
        hasExplorerLink: !!updates?.explorerLink,
        error: updates?.error,
      },
    });

    const updateFields: string[] = ['status = $2', 'updated_at = NOW()'];
    const values: any[] = [orderId, status];
    let paramIndex = 3;

    if (updates?.selectedDex !== undefined) {
      updateFields.push(`selected_dex = $${paramIndex}`);
      values.push(updates.selectedDex);
      paramIndex++;
    }

    if (updates?.txHash !== undefined) {
      updateFields.push(`tx_hash = $${paramIndex}`);
      values.push(updates.txHash);
      paramIndex++;
    }

    if (updates?.executedPrice !== undefined) {
      updateFields.push(`executed_price = $${paramIndex}`);
      values.push(updates.executedPrice);
      paramIndex++;
    }

    if (updates?.amountOut !== undefined) {
      updateFields.push(`amount_out = $${paramIndex}`);
      values.push(updates.amountOut);
      paramIndex++;
    }

    // Note: explorerLink is computed from txHash, not stored in database
    // It's included in updates for WebSocket messages only

    if (updates?.error !== undefined) {
      updateFields.push(`error = $${paramIndex}`);
      values.push(updates.error);
      paramIndex++;
    }

    const query = `
      UPDATE orders
      SET ${updateFields.join(', ')}
      WHERE order_id = $1
      RETURNING id, order_id, status, token_in, token_out, amount_in, amount_out,
                executed_price, slippage_tolerance, order_type, selected_dex, tx_hash, error,
                created_at, updated_at
    `;

    try {
      const result = await this.pool.query(query, values);
      if (result.rows.length === 0) {
        throw new Error(`Order not found: ${orderId}`);
      }
      
      const updatedOrder = this.mapRowToOrder(result.rows[0]);
      logger.info('Order status updated successfully in database', {
        orderId,
        previousStatus,
        newStatus: updatedOrder.status,
        txHash: updatedOrder.txHash,
        explorerLink: updatedOrder.explorerLink, // Computed from txHash
        selectedDex: updatedOrder.selectedDex,
        executedPrice: updatedOrder.executedPrice,
        amountOut: updatedOrder.amountOut,
      });
      
      return updatedOrder;
    } catch (error) {
      logger.error('Error updating order status', { error, orderId, status, updates });
      throw error;
    }
  }

  private mapRowToOrder(row: any): Order {
    // Compute explorer link from txHash if available
    const explorerLink = row.tx_hash
      ? getSolanaExplorerLink(row.tx_hash, getCluster())
      : undefined;

    return {
      id: row.id,
      orderId: row.order_id,
      status: row.status as OrderStatus,
      tokenIn: row.token_in,
      tokenOut: row.token_out,
      amountIn: parseFloat(row.amount_in),
      amountOut: row.amount_out ? parseFloat(row.amount_out) : undefined,
      executedPrice: row.executed_price ? parseFloat(row.executed_price) : undefined,
      slippageTolerance: parseFloat(row.slippage_tolerance),
      orderType: row.order_type as OrderType,
      selectedDex: row.selected_dex || undefined,
      txHash: row.tx_hash || undefined,
      explorerLink,
      error: row.error || undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
