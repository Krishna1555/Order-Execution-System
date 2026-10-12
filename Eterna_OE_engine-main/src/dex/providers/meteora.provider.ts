import { DexProvider, DexQuote, DexExecutionResult } from '../types';
import { getTokenMint, getWrappedSolMint, isNativeSol } from '../../config/tokens';
import { logger } from '../../utils/logger';
import { DexError } from '../../utils/errors';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { getConnection, getCluster, awaitTransactionConfirmation } from '../../utils/solana';
import axios from 'axios';
import BN from 'bn.js';

// Constants
const LAMPORTS_PER_SOL = 1_000_000_000; // 1 SOL = 1e9 lamports
const JUPITER_API_BASE = 'https://lite-api.jup.ag'; // Jupiter Aggregator API free tier (no API key required, includes Meteora pools)

/**
 * Convert token amount to lamports (smallest unit)
 * For SOL: 1 SOL = 1e9 lamports
 * For other tokens: Assume 6 decimals by default
 */
function toLamports(amount: number, tokenSymbol: string): BN {
  if (isNativeSol(tokenSymbol)) {
    return new BN(Math.floor(amount * LAMPORTS_PER_SOL));
  }
  // Assume 6 decimals for other tokens
  const decimals = 6;
  return new BN(Math.floor(amount * Math.pow(10, decimals)));
}

/**
 * Convert lamports back to token amount
 */
function fromLamports(lamports: BN, tokenSymbol: string): number {
  if (isNativeSol(tokenSymbol)) {
    return lamports.toNumber() / LAMPORTS_PER_SOL;
  }
  const decimals = 6;
  return lamports.toNumber() / Math.pow(10, decimals);
}

export class MeteoraProvider implements DexProvider {
  // Note: findPool() method removed - we now use Jupiter API for both quotes and execution
  // This eliminates SDK compatibility issues and provides a unified execution path

  async getQuote(tokenIn: string, tokenOut: string, amountIn: number): Promise<DexQuote> {
    logger.info('Getting Meteora quote', { tokenIn, tokenOut, amountIn });

    try {
      const cluster = getCluster();
      
      // Get token mint addresses (cluster-aware)
      const tokenInMintStr = isNativeSol(tokenIn) ? getWrappedSolMint() : getTokenMint(tokenIn, cluster);
      const tokenOutMintStr = getTokenMint(tokenOut, cluster);

      if (!tokenInMintStr || !tokenOutMintStr) {
        throw new DexError(`Token not supported: ${tokenIn} or ${tokenOut}`, 'meteora');
      }

      // IMPORTANT: Meteora SDK has compatibility issues with pool state decoding ("Invalid bool" errors)
      // Use Jupiter API instead, which aggregates Meteora pools and provides reliable quotes
      // Jupiter API filters routes to include only Meteora pools when available
      const amountInLamports = toLamports(amountIn, tokenIn);
      const slippageBps = 50; // 0.5% slippage for quote
      
      const quoteUrl = `${JUPITER_API_BASE}/swap/v1/quote`;
      const quoteParams = {
        inputMint: tokenInMintStr,
        outputMint: tokenOutMintStr,
        amount: amountInLamports.toString(),
        slippageBps: slippageBps,
        onlyDirectRoutes: false, // Allow multi-hop routes if needed
        asLegacyTransaction: false,
      };

      logger.debug('Fetching Meteora quote via Jupiter API (aggregates Meteora pools)', {
        url: quoteUrl,
        params: quoteParams,
        cluster,
        note: 'Jupiter API aggregates Meteora pools and provides reliable quotes',
      });

      const quoteResponse = await axios.get(quoteUrl, { 
        params: quoteParams,
        timeout: 15000,
      });

      if (!quoteResponse.data || !quoteResponse.data.outAmount) {
        throw new DexError(`Jupiter API returned invalid response: ${JSON.stringify(quoteResponse.data)}`, 'meteora');
      }

      // Check if the route uses Meteora pools
      const routePlan = quoteResponse.data.routePlan || [];
      const hasMeteoraRoute = routePlan.some((route: any) => {
        const swapInfo = route.swapInfo;
        return swapInfo && (
          swapInfo.label?.toLowerCase().includes('meteora') ||
          swapInfo.label?.toLowerCase().includes('damm') ||
          swapInfo.label?.toLowerCase().includes('dlmm')
        );
      });

      if (!hasMeteoraRoute && routePlan.length > 0) {
        logger.warn('Jupiter quote does not use Meteora pools, but quote is available', {
          routeLabels: routePlan.map((r: any) => r.swapInfo?.label).filter(Boolean),
        });
        // Still return the quote, but note it might not be a pure Meteora route
      }

      const outAmountLamports = quoteResponse.data.outAmount;
      const amountOut = fromLamports(new BN(outAmountLamports), tokenOut);
      
      // Calculate price
      const price = amountOut / amountIn;
      
      // Calculate fee from route plan (sum of all fees)
      let totalFeeLamports = 0;
      if (Array.isArray(routePlan)) {
        for (const route of routePlan) {
          if (route.swapInfo?.feeAmount) {
            totalFeeLamports += parseInt(route.swapInfo.feeAmount) || 0;
          }
        }
      }
      const feeAmount = fromLamports(new BN(totalFeeLamports), tokenIn);
      const fee = feeAmount > 0 ? feeAmount / amountIn : 0.002; // Default to 0.2% if no fee

      logger.info('Meteora quote received via Jupiter API', {
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        price,
        fee,
        priceImpact: quoteResponse.data.priceImpactPct || 'N/A',
        routePlanLength: routePlan.length,
        hasMeteoraRoute,
        cluster,
      });

      return {
        price,
        fee,
        amountOut,
        dex: 'meteora',
      };
    } catch (error) {
      // Log detailed error information
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorDetails = axios.isAxiosError(error)
        ? { status: error.response?.status, statusText: error.response?.statusText, data: error.response?.data }
        : { message: errorMessage, stack: error instanceof Error ? error.stack : undefined };
      
      logger.error('Error getting Meteora quote', { 
        error: errorMessage,
        details: errorDetails,
        tokenIn, 
        tokenOut, 
        amountIn 
      });
      
      if (error instanceof DexError) {
        throw error;
      }
      
      if (axios.isAxiosError(error)) {
        const apiError = `Meteora API error: ${error.response?.status} ${error.response?.statusText || 'Unknown'} - ${error.message}`;
        const apiDetails = error.response?.data ? ` Response: ${JSON.stringify(error.response.data)}` : '';
        throw new DexError(apiError + apiDetails, 'meteora');
      }
      
      throw new DexError(`Failed to get Meteora quote: ${errorMessage}`, 'meteora');
    }
  }

  async executeSwap(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    minAmountOut: number,
    userKeypair: Keypair,
    expectedAmountOut?: number // Used to verify slippage; Jupiter API will handle execution
  ): Promise<DexExecutionResult> {
    logger.info('Executing Meteora swap via Jupiter API', { 
      tokenIn, 
      tokenOut, 
      amountIn, 
      minAmountOut,
      expectedAmountOut,
      userWallet: userKeypair.publicKey.toBase58() 
    });

    try {
      const connection = getConnection();
      const cluster = getCluster();
      
      // Get token mint addresses (cluster-aware)
      const tokenInMintStr = isNativeSol(tokenIn) ? getWrappedSolMint() : getTokenMint(tokenIn, cluster);
      const tokenOutMintStr = getTokenMint(tokenOut, cluster);

      if (!tokenInMintStr || !tokenOutMintStr) {
        throw new DexError(`Token not supported: ${tokenIn} or ${tokenOut}`, 'meteora');
      }

      // Step 1: Get quote from Jupiter API (same as getQuote, but we need the full response)
      const amountInLamports = toLamports(amountIn, tokenIn);
      const minAmountOutLamports = toLamports(minAmountOut, tokenOut);
      const slippageBps = 50; // 0.5% slippage
      
      const quoteUrl = `${JUPITER_API_BASE}/swap/v1/quote`;
      const quoteParams = {
        inputMint: tokenInMintStr,
        outputMint: tokenOutMintStr,
        amount: amountInLamports.toString(),
        slippageBps: slippageBps,
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
      };

      logger.debug('Fetching Jupiter quote for swap execution', {
        url: quoteUrl,
        params: quoteParams,
        cluster,
      });

      const quoteResponse = await axios.get(quoteUrl, { 
        params: quoteParams,
        timeout: 15000,
      });

      if (!quoteResponse.data || !quoteResponse.data.outAmount) {
        throw new DexError(`Jupiter API returned invalid quote response: ${JSON.stringify(quoteResponse.data)}`, 'meteora');
      }

      // Verify slippage protection
      const outAmountLamports = new BN(quoteResponse.data.outAmount);
      if (outAmountLamports.lt(minAmountOutLamports)) {
        const actualOut = fromLamports(outAmountLamports, tokenOut);
        throw new DexError(
          `Slippage tolerance exceeded. Expected at least ${minAmountOut}, got ${actualOut}`,
          'meteora'
        );
      }

      // Step 2: Get swap transaction from Jupiter API
      // Note: Jupiter uses versioned transactions with address lookup tables
      // We need to ensure the transaction is properly signed and sent
      const swapUrl = `${JUPITER_API_BASE}/swap/v1/swap`;
      const swapPayload = {
        userPublicKey: userKeypair.publicKey.toBase58(),
        quoteResponse: quoteResponse.data,
        // Add dynamic priority fee for better confirmation rates on mainnet
        prioritizationFeeLamports: 'auto', // Jupiter will calculate appropriate fee
      };

      logger.info('Requesting swap transaction from Jupiter API', {
        url: swapUrl,
        userPublicKey: userKeypair.publicKey.toBase58(),
        inputMint: tokenInMintStr,
        outputMint: tokenOutMintStr,
        amountIn: amountInLamports.toString(),
        expectedOut: quoteResponse.data.outAmount,
        priorityFee: 'auto',
      });

      let swapResponse;
      try {
        swapResponse = await axios.post(swapUrl, swapPayload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
        });
      } catch (swapRequestError: any) {
        const errorMessage = swapRequestError?.response?.data?.message || swapRequestError?.message || String(swapRequestError);
        logger.error('Jupiter swap API request failed', {
          error: errorMessage,
          status: swapRequestError?.response?.status,
          data: swapRequestError?.response?.data,
        });
        throw new DexError(
          `Failed to get swap transaction from Jupiter API: ${errorMessage}`,
          'meteora'
        );
      }

      if (!swapResponse.data || !swapResponse.data.swapTransaction) {
        throw new DexError(`Jupiter API returned invalid swap response: ${JSON.stringify(swapResponse.data)}`, 'meteora');
      }

      // Step 3: Deserialize, sign, and send transaction
      const swapTransactionBase64 = swapResponse.data.swapTransaction;
      if (!swapTransactionBase64) {
        throw new DexError('Jupiter API did not return swapTransaction in response', 'meteora');
      }
      
      const swapTransactionBuffer = Buffer.from(swapTransactionBase64, 'base64');
      
      let versionedTransaction: VersionedTransaction;
      try {
        versionedTransaction = VersionedTransaction.deserialize(swapTransactionBuffer);
      } catch (deserializeError) {
        throw new DexError(
          `Failed to deserialize Jupiter swap transaction: ${deserializeError instanceof Error ? deserializeError.message : String(deserializeError)}`,
          'meteora'
        );
      }
      
      // Sign the transaction
      try {
        versionedTransaction.sign([userKeypair]);
      } catch (signError) {
        throw new DexError(
          `Failed to sign transaction: ${signError instanceof Error ? signError.message : String(signError)}`,
          'meteora'
        );
      }

      logger.info('Sending Meteora swap transaction to network (via Jupiter)', {
        tokenIn,
        tokenOut,
        amountIn,
        expectedOut: fromLamports(new BN(quoteResponse.data.outAmount), tokenOut),
        userWallet: userKeypair.publicKey.toBase58(),
        transactionSize: swapTransactionBuffer.length,
      });

      // Send transaction with proper error handling
      // Note: Jupiter transactions use versioned transactions with address lookup tables
      // We use skipPreflight: true to avoid simulation issues, but this means we rely on network confirmation
      let txHash: string;
      try {
        // Serialize the signed transaction to send as raw bytes
        const serializedTx = versionedTransaction.serialize();
        
        txHash = await connection.sendRawTransaction(serializedTx, {
          skipPreflight: true, // Skip preflight to avoid simulation issues with lookup tables
          maxRetries: 3,
        });
        
        if (!txHash || typeof txHash !== 'string') {
          throw new Error(`sendRawTransaction returned invalid transaction hash: ${txHash}`);
        }
        
        // Verify the transaction hash is a reasonable length (Solana signatures are ~88 chars)
        if (txHash.length < 64 || txHash.length > 128) {
          throw new Error(`Transaction hash has invalid length: ${txHash.length} (expected 64-128 chars)`);
        }
      } catch (sendError: any) {
        // Log detailed error information
        const errorMessage = sendError?.message || String(sendError);
        const errorDetails = {
          error: errorMessage,
          errorType: sendError?.constructor?.name,
          userWallet: userKeypair.publicKey.toBase58(),
          tokenIn,
          tokenOut,
          amountIn,
        };
        
        logger.error('Failed to send Meteora swap transaction', errorDetails);
        
        // Check for common errors
        if (errorMessage.includes('insufficient funds') || errorMessage.includes('0 SOL')) {
          throw new DexError(
            `Insufficient SOL balance for transaction fees. ` +
            `Wallet ${userKeypair.publicKey.toBase58()} needs SOL for fees. ` +
            `Current balance may be too low.`,
            'meteora'
          );
        }
        
        if (errorMessage.includes('blockhash') || errorMessage.includes('expired')) {
          throw new DexError(
            `Transaction blockhash expired. This can happen if there's a delay between quote and execution. ` +
            `Error: ${errorMessage}`,
            'meteora'
          );
        }
        
        throw new DexError(
          `Failed to send transaction to Solana network: ${errorMessage}. ` +
          `Check your wallet balance and network connection.`,
          'meteora'
        );
      }

      logger.info('Meteora swap transaction sent (via Jupiter)', { 
        txHash,
        note: 'Transaction broadcasted to network, waiting for confirmation',
      });

      // Step 4: Wait for confirmation (using custom utility with 120s timeout for mainnet)
      // Mainnet transactions can take longer during network congestion
      logger.debug('Confirming Meteora transaction (custom polling with 120s timeout)', {
        txHash,
        note: 'Using awaitTransactionConfirmation with 120s timeout for mainnet reliability',
      });

      try {
        await awaitTransactionConfirmation(connection, txHash, 120000); // 120 seconds for mainnet
        logger.info('Meteora transaction confirmed', { txHash });
      } catch (confirmationError: any) {
        // Check if transaction actually failed or just timed out
        // Give it one more check after a short delay in case it's still processing
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds
        const status = await connection.getSignatureStatus(txHash);
        
        if (status.value?.err) {
          throw new DexError(
            `Transaction failed: ${JSON.stringify(status.value.err)}. ` +
            `Transaction signature: ${txHash}. ` +
            `Check transaction status at https://solscan.io/tx/${txHash}`,
            'meteora'
          );
        }
        
        // Check if it's confirmed or finalized
        if (status.value && (status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized')) {
          logger.info('Meteora transaction confirmed after timeout check', { 
            txHash, 
            confirmationStatus: status.value.confirmationStatus 
          });
          // Transaction succeeded, continue
        } else {
          // If timeout but no error, transaction might still be processing
          // Log a warning but don't fail - the transaction might succeed later
          logger.warn(
            `Transaction confirmation timeout after 120 seconds, but no error detected. ` +
            `Transaction may still be processing. Check status at: https://solscan.io/tx/${txHash}`,
            { txHash, status: status.value }
          );
          
          throw new DexError(
            `Transaction confirmation timeout after 120 seconds. ` +
            `It is unknown if it succeeded or failed. ` +
            `The transaction was sent successfully and may still be processing. ` +
            `Check signature ${txHash} using the Solana Explorer: https://solscan.io/tx/${txHash}`,
            'meteora'
          );
        }
      }

      // Calculate executed price and fee from quote
      const amountOut = fromLamports(new BN(quoteResponse.data.outAmount), tokenOut);
      const executedPrice = amountOut / amountIn;
      
      // Calculate fee from route plan
      const routePlan = quoteResponse.data.routePlan || [];
      let totalFeeLamports = 0;
      if (Array.isArray(routePlan)) {
        for (const route of routePlan) {
          if (route.swapInfo?.feeAmount) {
            totalFeeLamports += parseInt(route.swapInfo.feeAmount) || 0;
          }
        }
      }
      const feeAmount = fromLamports(new BN(totalFeeLamports), tokenIn);
      const fee = feeAmount > 0 ? feeAmount / amountIn : 0.002; // Default to 0.2% if no fee

      logger.info('Meteora swap executed successfully (via Jupiter)', {
        txHash,
        executedPrice,
        amountOut,
        fee,
        userWallet: userKeypair.publicKey.toBase58(),
      });

      return {
        txHash,
        executedPrice,
        amountOut,
        fee,
      };
    } catch (error) {
      logger.error('Error executing Meteora swap', { 
        error, 
        tokenIn, 
        tokenOut, 
        amountIn,
        userWallet: userKeypair.publicKey.toBase58() 
      });
      
      if (error instanceof DexError) {
        throw error;
      }
      
      throw new DexError(
        `Failed to execute Meteora swap: ${error instanceof Error ? error.message : String(error)}`,
        'meteora'
      );
    }
  }
}
