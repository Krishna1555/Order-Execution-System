export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = 'OrderNotFoundError';
  }
}

export class DexError extends Error {
  constructor(message: string, public dex?: string) {
    super(message);
    this.name = 'DexError';
  }
}

export class QueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueError';
  }
}

export class SolanaNetworkError extends Error {
  constructor(message: string, public originalError?: Error) {
    super(message);
    this.name = 'SolanaNetworkError';
  }
}

export class InsufficientFundsError extends Error {
  constructor(message: string = 'Insufficient funds for transaction') {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

export class SlippageExceededError extends Error {
  constructor(expected: number, actual: number) {
    super(`Slippage tolerance exceeded. Expected at least ${expected}, got ${actual}`);
    this.name = 'SlippageExceededError';
  }
}

export class TransactionFailedError extends Error {
  constructor(txHash: string, reason?: string) {
    super(`Transaction failed: ${txHash}${reason ? ` - ${reason}` : ''}`);
    this.name = 'TransactionFailedError';
    this.txHash = txHash;
  }
  public txHash: string;
}
