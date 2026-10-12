import { Job } from 'bullmq';
import { OrderStatus } from '../types/order.types';
import { DexRouter } from '../dex/router';
import { orderService } from '../services/order.service';
import { statusService } from '../services/status.service';
import { logger } from '../utils/logger';
import { getSolanaExplorerLink, getCluster, parseUserWallet, isDevnetEnabled } from '../utils/solana';

interface OrderJobData {
  orderId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  slippageTolerance: number;
  walletPrivateKey?: string; // Base58-encoded private key
  walletKeypair?: number[]; // JSON array of numbers representing secret key
}

export async function processOrder(job: Job<OrderJobData>): Promise<void> {
  const { orderId, tokenIn, tokenOut, amountIn, slippageTolerance, walletPrivateKey, walletKeypair } = job.data;

  logger.info('Order job started processing', {
    jobId: job.id,
    orderId,
    tokenIn,
    tokenOut,
    amountIn,
    attempt: job.attemptsMade + 1,
    maxAttempts: job.opts.attempts,
  });

  try {
    // Parse user wallet from job data
    const userKeypair = parseUserWallet(walletPrivateKey, walletKeypair);
    const userWalletAddress = userKeypair.publicKey.toBase58();

    logger.info('User wallet parsed for order', { orderId, userWallet: userWalletAddress });

    // Update status to routing
    logger.info('Order status: PENDING → ROUTING', { orderId, stage: 'routing' });
    await orderService.updateOrderStatus(orderId, OrderStatus.ROUTING);
    statusService.broadcastStatusUpdate(orderId, OrderStatus.ROUTING);

    // Get best quote from DEX router
    const dexRouter = new DexRouter();
    const bestQuote = await dexRouter.getBestQuote(tokenIn, tokenOut, amountIn);

    logger.info('DEX routing completed - best quote selected', {
      orderId,
      selectedDex: bestQuote.dex,
      amountOut: bestQuote.amountOut,
      price: bestQuote.price,
      fee: bestQuote.fee,
    });

    // Calculate minimum amount out based on slippage tolerance
    const minAmountOut = bestQuote.amountOut * (1 - slippageTolerance);

    logger.info('Order status: ROUTING → BUILDING', {
      orderId,
      stage: 'building',
      selectedDex: bestQuote.dex,
      minAmountOut,
    });

    // Update status to building
    await orderService.updateOrderStatus(orderId, OrderStatus.BUILDING, {
      selectedDex: bestQuote.dex,
    });
    statusService.broadcastStatusUpdate(orderId, OrderStatus.BUILDING, {
      selectedDex: bestQuote.dex,
    });

    logger.info('Order status: BUILDING → SUBMITTED', {
      orderId,
      stage: 'submitted',
      selectedDex: bestQuote.dex,
    });

    // Update status to submitted
    await orderService.updateOrderStatus(orderId, OrderStatus.SUBMITTED, {
      selectedDex: bestQuote.dex,
    });
    statusService.broadcastStatusUpdate(orderId, OrderStatus.SUBMITTED, {
      selectedDex: bestQuote.dex,
    });

    // Execute swap on selected DEX with user's wallet
    // Pass expectedAmountOut from routing quote to ensure execution matches quote (prevents slippage failures in mocks)
    const executionResult = await dexRouter.executeSwap(
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
      bestQuote.dex,
      userKeypair,
      bestQuote.amountOut // Pass the quote's amountOut so execution uses the same value
    );

    // Generate Solana Explorer link for transaction hash
    const explorerLink = getSolanaExplorerLink(executionResult.txHash, getCluster());

    // Check if using mock execution (devnet disabled means mocks are used)
    const isMockExecution = !isDevnetEnabled();
    if (isMockExecution) {
      logger.info('Transaction executed successfully (MOCK - signature not valid on Explorer)', {
        orderId,
        txHash: executionResult.txHash,
        executedPrice: executionResult.executedPrice,
        amountOut: executionResult.amountOut,
        explorerLink,
        selectedDex: bestQuote.dex,
        note: 'Mock transaction hash generated for testing. Explorer link will show "Signature is not valid" - this is expected for mock execution.',
      });
    } else {
      logger.info('Transaction executed successfully', {
        orderId,
        txHash: executionResult.txHash,
        executedPrice: executionResult.executedPrice,
        amountOut: executionResult.amountOut,
        explorerLink,
        selectedDex: bestQuote.dex,
      });
    }

    logger.info('Order status: SUBMITTED → CONFIRMED', {
      orderId,
      stage: 'confirmed',
      txHash: executionResult.txHash,
      explorerLink,
    });

    // Update status to confirmed
    await orderService.updateOrderStatus(orderId, OrderStatus.CONFIRMED, {
      selectedDex: bestQuote.dex,
      txHash: executionResult.txHash,
      executedPrice: executionResult.executedPrice,
      amountOut: executionResult.amountOut,
      explorerLink,
    });

    statusService.broadcastStatusUpdate(orderId, OrderStatus.CONFIRMED, {
      txHash: executionResult.txHash,
      executedPrice: executionResult.executedPrice,
      amountOut: executionResult.amountOut,
      selectedDex: bestQuote.dex,
      explorerLink,
    });

    logger.info('Order processed successfully - COMPLETE', {
      orderId,
      txHash: executionResult.txHash,
      executedPrice: executionResult.executedPrice,
      amountOut: executionResult.amountOut,
      explorerLink,
      userWallet: userWalletAddress,
      selectedDex: bestQuote.dex,
      jobId: job.id,
    });
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error occurred';
    const attemptsMade = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts || 3;

    logger.error('Error processing order', {
      orderId,
      jobId: job.id,
      error: errorMessage,
      attempt: attemptsMade,
      maxAttempts,
      willRetry: attemptsMade < maxAttempts,
    });

    // Update status to failed if this is the final attempt
    if (attemptsMade >= maxAttempts) {
      logger.error('Order status: → FAILED (max attempts reached)', {
        orderId,
        stage: 'failed',
        error: errorMessage,
        attemptsMade,
        maxAttempts,
      });

      await orderService.updateOrderStatus(orderId, OrderStatus.FAILED, {
        error: errorMessage,
      });

      statusService.broadcastStatusUpdate(orderId, OrderStatus.FAILED, {
        error: errorMessage,
      });
    } else {
      logger.warn('Order will retry', {
        orderId,
        attemptsMade,
        maxAttempts,
        nextAttempt: attemptsMade + 1,
      });
    }

    // Re-throw to trigger retry mechanism
    throw error;
  }
}
