import { DexProvider, DexQuote } from './types';
import { MockRaydiumProvider } from './mock/raydium.mock';
import { MockMeteoraProvider } from './mock/meteora.mock';
import { logger } from '../utils/logger';
import { DexError } from '../utils/errors';
import { Keypair } from '@solana/web3.js';

export class DexRouter {
  private raydium: DexProvider;
  private meteora: DexProvider;

  constructor() {
    const useDevnet = process.env.DEVNET_ENABLED === 'true';
    
    if (useDevnet) {
      // Lazy load real providers to avoid SDK import issues in tests
      // Dynamic import is used to prevent SDK from loading when using mocks
      const { RaydiumProvider } = require('./providers/raydium.provider');
      const { MeteoraProvider } = require('./providers/meteora.provider');
      this.raydium = new RaydiumProvider();
      this.meteora = new MeteoraProvider();
      logger.info('Using real devnet providers (Option A)');
    } else {
      this.raydium = new MockRaydiumProvider();
      this.meteora = new MockMeteoraProvider();
      logger.info('Using mock providers (Option B)');
    }
  }

  async getBestQuote(tokenIn: string, tokenOut: string, amountIn: number): Promise<DexQuote> {
    logger.info('Fetching quotes from DEXs', { tokenIn, tokenOut, amountIn });

    try {
      // Fetch quotes from both DEXs concurrently
      const [raydiumQuote, meteoraQuote] = await Promise.all([
        this.raydium.getQuote(tokenIn, tokenOut, amountIn).catch((error) => {
          logger.warn('Failed to get Raydium quote', { error });
          return null;
        }),
        this.meteora.getQuote(tokenIn, tokenOut, amountIn).catch((error) => {
          logger.warn('Failed to get Meteora quote', { error });
          return null;
        }),
      ]);

      // Filter out failed quotes
      const quotes: DexQuote[] = [raydiumQuote, meteoraQuote].filter(
        (quote): quote is DexQuote => quote !== null
      );

      if (quotes.length === 0) {
        throw new DexError('Failed to get quotes from any DEX');
      }

      // Compare quotes and select the best one (highest amountOut)
      const bestQuote = quotes.reduce((best, current) => {
        return current.amountOut > best.amountOut ? current : best;
      });

      logger.info('DEX routing decision', {
        tokenIn,
        tokenOut,
        amountIn,
        selectedDex: bestQuote.dex,
        amountOut: bestQuote.amountOut,
        price: bestQuote.price,
        fee: bestQuote.fee,
        allQuotes: quotes.map((q) => ({
          dex: q.dex,
          amountOut: q.amountOut,
          price: q.price,
          fee: q.fee,
        })),
      });

      return bestQuote;
    } catch (error) {
      logger.error('Error in DEX routing', { error, tokenIn, tokenOut, amountIn });
      throw error;
    }
  }

  async executeSwap(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    minAmountOut: number,
    dex: string,
    userKeypair: Keypair,
    expectedAmountOut?: number
  ) {
    logger.info('Executing swap on DEX', { 
      tokenIn, 
      tokenOut, 
      amountIn, 
      minAmountOut, 
      dex,
      expectedAmountOut,
      userWallet: userKeypair.publicKey.toBase58() 
    });

    let provider: DexProvider;
    if (dex === 'raydium') {
      provider = this.raydium;
    } else if (dex === 'meteora') {
      provider = this.meteora;
    } else {
      throw new DexError(`Unknown DEX: ${dex}`, dex);
    }

    try {
      // For mock providers, pass the expectedAmountOut from the routing quote
      // This ensures execution uses the same quote that was selected, preventing slippage failures
      // Real providers can ignore this parameter if not needed
      return await provider.executeSwap(tokenIn, tokenOut, amountIn, minAmountOut, userKeypair, expectedAmountOut);
    } catch (error) {
      logger.error('Error executing swap', { 
        error, 
        tokenIn, 
        tokenOut, 
        amountIn, 
        dex,
        expectedAmountOut,
        userWallet: userKeypair.publicKey.toBase58() 
      });
      throw new DexError(`Failed to execute swap on ${dex}: ${error}`, dex);
    }
  }
}
