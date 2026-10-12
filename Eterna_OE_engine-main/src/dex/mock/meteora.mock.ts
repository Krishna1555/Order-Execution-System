import { DexProvider, DexQuote, DexExecutionResult } from '../types';
import { logger } from '../../utils/logger';
import { Keypair } from '@solana/web3.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MockMeteoraProvider implements DexProvider {
  private readonly baseDelayMin: number;
  private readonly baseDelayMax: number;
  private readonly executionDelayMin: number;
  private readonly executionDelayMax: number;

  constructor() {
    this.baseDelayMin = parseInt(process.env.MOCK_DEX_DELAY_MIN || '200', 10);
    this.baseDelayMax = parseInt(process.env.MOCK_DEX_DELAY_MAX || '300', 10);
    this.executionDelayMin = parseInt(process.env.MOCK_EXECUTION_DELAY_MIN || '2000', 10);
    this.executionDelayMax = parseInt(process.env.MOCK_EXECUTION_DELAY_MAX || '3000', 10);
  }

  async getQuote(tokenIn: string, tokenOut: string, amountIn: number): Promise<DexQuote> {
    // Simulate network delay
    const delay = this.baseDelayMin + Math.random() * (this.baseDelayMax - this.baseDelayMin);
    await sleep(delay);

    // Mock base price (in reality, this would fetch from Meteora pools)
    const basePrice = 1.0; // 1:1 ratio for simplicity
    const priceVariance = 0.97 + Math.random() * 0.05; // 97% to 102% of base price
    const price = basePrice * priceVariance;
    const fee = 0.002; // 0.2% fee (slightly lower than Raydium)
    const amountOut = amountIn * price * (1 - fee);

    logger.debug('Meteora quote generated', { tokenIn, tokenOut, amountIn, price, fee, amountOut });

    return {
      price,
      fee,
      amountOut,
      dex: 'meteora',
    };
  }

  async executeSwap(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    minAmountOut: number,
    userKeypair: Keypair,
    expectedAmountOut?: number
  ): Promise<DexExecutionResult> {
    // Simulate execution delay
    const delay = this.executionDelayMin + Math.random() * (this.executionDelayMax - this.executionDelayMin);
    await sleep(delay);

    // Use expectedAmountOut if provided (from routing quote), otherwise get new quote
    // This ensures execution matches the quote used for routing (prevents slippage failures)
    let amountOut: number;
    let executedPrice: number;
    const fee = 0.002; // 0.2% fee (slightly lower than Raydium)

    if (expectedAmountOut !== undefined && expectedAmountOut >= minAmountOut) {
      // Use the amountOut from the routing quote (ensures slippage check passes)
      amountOut = expectedAmountOut;
      executedPrice = amountOut / (amountIn * (1 - fee));
      
      logger.debug('Using expected amountOut from routing quote for execution', {
        expectedAmountOut,
        minAmountOut,
        amountOut,
        executedPrice,
      });
    } else {
      // Fallback: Get new quote (shouldn't happen in normal flow)
      const quote = await this.getQuote(tokenIn, tokenOut, amountIn);
      amountOut = quote.amountOut;
      executedPrice = quote.price;
    }
    
    // Final slippage protection check
    if (amountOut < minAmountOut) {
      throw new Error(`Slippage tolerance exceeded. Expected at least ${minAmountOut}, got ${amountOut}`);
    }

    // Generate mock transaction hash (will not validate on Solana Explorer - this is expected for mock execution)
    const txHash = this.generateMockTxHash();

    logger.info('Meteora swap executed (MOCK)', { 
      tokenIn, 
      tokenOut, 
      amountIn, 
      txHash, 
      executedPrice,
      amountOut,
      fee,
      userWallet: userKeypair.publicKey.toBase58(),
      note: 'Mock transaction hash generated. Will not validate on Solana Explorer - this is expected behavior for mock execution.',
    });

    return {
      txHash,
      executedPrice,
      amountOut,
      fee,
    };
  }

  private generateMockTxHash(): string {
    // Generate a mock Solana transaction hash (base58 encoded, 88 chars)
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let hash = '';
    for (let i = 0; i < 88; i++) {
      hash += chars[Math.floor(Math.random() * chars.length)];
    }
    return hash;
  }
}
