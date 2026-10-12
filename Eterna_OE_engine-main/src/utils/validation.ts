import { OrderRequest, OrderType } from '../types/order.types';
import { ValidationError } from './errors';

import { parseUserWallet } from './solana';

export function validateOrderRequest(request: OrderRequest): void {
  if (!request.tokenIn || typeof request.tokenIn !== 'string') {
    throw new ValidationError('tokenIn is required and must be a string', 'tokenIn');
  }

  if (!request.tokenOut || typeof request.tokenOut !== 'string') {
    throw new ValidationError('tokenOut is required and must be a string', 'tokenOut');
  }

  if (request.tokenIn === request.tokenOut) {
    throw new ValidationError('tokenIn and tokenOut must be different');
  }

  if (!request.amountIn || typeof request.amountIn !== 'number' || request.amountIn <= 0) {
    throw new ValidationError('amountIn is required and must be a positive number', 'amountIn');
  }

  if (!Object.values(OrderType).includes(request.orderType)) {
    throw new ValidationError(`orderType must be one of: ${Object.values(OrderType).join(', ')}`, 'orderType');
  }

  if (request.slippageTolerance !== undefined) {
    if (typeof request.slippageTolerance !== 'number' || request.slippageTolerance < 0 || request.slippageTolerance > 1) {
      throw new ValidationError('slippageTolerance must be a number between 0 and 1', 'slippageTolerance');
    }
  }

  // Validate wallet is provided (user-owned wallet requirement)
  if (!request.walletPrivateKey && !request.walletKeypair) {
    throw new ValidationError(
      'Wallet is required. Provide either walletPrivateKey (base58-encoded private key) or walletKeypair (JSON array of 64 numbers).',
      'wallet'
    );
  }

  if (request.walletPrivateKey && request.walletKeypair) {
    throw new ValidationError(
      'Provide only one wallet format: either walletPrivateKey or walletKeypair, not both.',
      'wallet'
    );
  }

  // Try to parse wallet to validate format
  try {
    parseUserWallet(request.walletPrivateKey, request.walletKeypair);
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(
      `Invalid wallet format: ${error instanceof Error ? error.message : String(error)}`,
      'wallet'
    );
  }
}
