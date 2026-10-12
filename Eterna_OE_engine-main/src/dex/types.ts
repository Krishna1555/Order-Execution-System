export interface DexQuote {
  price: number;
  fee: number;
  amountOut: number;
  dex: string;
}

export interface DexExecutionResult {
  txHash: string;
  executedPrice: number;
  amountOut: number;
  fee: number;
}

import { Keypair } from '@solana/web3.js';

export interface DexProvider {
  getQuote(tokenIn: string, tokenOut: string, amountIn: number): Promise<DexQuote>;
  executeSwap(tokenIn: string, tokenOut: string, amountIn: number, minAmountOut: number, userKeypair: Keypair, expectedAmountOut?: number): Promise<DexExecutionResult>;
}
