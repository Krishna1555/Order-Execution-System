import { OrderRequest, OrderType } from '../../types/order.types';

export const mockOrderRequest: OrderRequest = {
  tokenIn: 'SOL',
  tokenOut: 'USDC',
  amountIn: 100,
  slippageTolerance: 0.01,
  orderType: OrderType.MARKET,
};

export const mockOrderRequestInvalid = {
  tokenIn: '',
  tokenOut: 'USDC',
  amountIn: -100,
  orderType: 'invalid',
};
