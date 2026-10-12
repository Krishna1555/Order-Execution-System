export enum OrderStatus {
  PENDING = 'pending',
  ROUTING = 'routing',
  BUILDING = 'building',
  SUBMITTED = 'submitted',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
  SNIPER = 'sniper',
}

export interface OrderRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  slippageTolerance?: number;
  orderType: OrderType;
  // User-owned wallet: either privateKey (base58) or keypair (JSON array)
  walletPrivateKey?: string; // Base58-encoded private key
  walletKeypair?: number[]; // JSON array of numbers representing secret key
}

export interface Order {
  id: string;
  orderId: string;
  status: OrderStatus;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  amountOut?: number;
  executedPrice?: number;
  slippageTolerance: number;
  orderType: OrderType;
  selectedDex?: string;
  txHash?: string;
  explorerLink?: string; // Solana Explorer link for transaction hash
  userWalletAddress?: string; // Public key of user's wallet (for reference only, not stored in DB)
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderResponse {
  orderId: string;
  status: OrderStatus;
  message?: string;
}
