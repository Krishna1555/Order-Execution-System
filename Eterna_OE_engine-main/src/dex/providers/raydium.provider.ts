import { DexProvider, DexQuote, DexExecutionResult } from '../types';
import { getTokenMint, getWrappedSolMint, isNativeSol } from '../../config/tokens';
import { logger } from '../../utils/logger';
import { DexError } from '../../utils/errors';
import { Keypair, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { getConnection, getCluster, awaitTransactionConfirmation } from '../../utils/solana';
import axios from 'axios';

// Constants
const LAMPORTS_PER_SOL = 1_000_000_000; // 1 SOL = 1e9 lamports
const RAYDIUM_API_BASE = 'https://transaction-v1.raydium.io';

/**
 * Convert token amount to lamports (smallest unit)
 * For SOL: 1 SOL = 1e9 lamports
 * For other tokens: Assume 6 decimals by default (can be enhanced with token info lookup)
 */
function toLamports(amount: number, tokenSymbol: string): string {
  if (isNativeSol(tokenSymbol)) {
    // SOL has 9 decimals
    return Math.floor(amount * LAMPORTS_PER_SOL).toString();
  }
  // Assume 6 decimals for other tokens (USDC, USDT typically have 6 decimals)
  // In production, you'd want to fetch token decimals from chain or token registry
  const decimals = 6;
  return Math.floor(amount * Math.pow(10, decimals)).toString();
}

/**
 * Convert lamports back to token amount
 */
function fromLamports(lamports: string, tokenSymbol: string): number {
  if (isNativeSol(tokenSymbol)) {
    return parseInt(lamports) / LAMPORTS_PER_SOL;
  }
  // Assume 6 decimals for other tokens
  const decimals = 6;
  return parseInt(lamports) / Math.pow(10, decimals);
}

export class RaydiumProvider implements DexProvider {
  async getQuote(tokenIn: string, tokenOut: string, amountIn: number): Promise<DexQuote> {
    logger.info('Getting Raydium quote', { tokenIn, tokenOut, amountIn });

    try {
      const cluster = getCluster();
      
      // Get token mint addresses (cluster-aware)
      const tokenInMintStr = isNativeSol(tokenIn) ? getWrappedSolMint() : getTokenMint(tokenIn, cluster);
      const tokenOutMintStr = getTokenMint(tokenOut, cluster);

      if (!tokenInMintStr || !tokenOutMintStr) {
        throw new DexError(`Token not supported: ${tokenIn} or ${tokenOut}`, 'raydium');
      }

      const amountInLamports = toLamports(amountIn, tokenIn);

      // IMPORTANT: Raydium Trade API only supports mainnet, not devnet
      // For devnet, use Raydium SDK with pool discovery
      if (cluster === 'devnet') {
        // On devnet, Raydium SDK requires pool IDs upfront for cpmm.getPoolInfoFromRpc()
        // The Trade API only supports mainnet
        // For real devnet execution, we need to know pool addresses
        // Since route discovery isn't available, throw a helpful error
        // User can either: 1) Switch to mainnet for real execution (recommended for bonus points), or 2) Create pools on devnet first
        
        throw new DexError(
          `Raydium is not available on devnet without pool addresses. ` +
          `The Raydium Trade API only supports mainnet. ` +
          `For real execution (bonus points), switch to mainnet: ` +
          `Set SOLANA_CLUSTER=mainnet-beta and SOLANA_RPC_URL=https://api.mainnet-beta.solana.com in your .env file. ` +
          `This will enable real trade execution on mainnet using the Trade API. ` +
          `For devnet, you would need to create pools first and provide pool addresses.`,
          'raydium'
        );
      }

      // Use Raydium Trade API for mainnet
      const slippageBps = 50; // 0.5% slippage for quote
      const txVersion = 'V0';
      
      const quoteUrl = `${RAYDIUM_API_BASE}/compute/swap-base-in`;
      const quoteParams = {
        inputMint: tokenInMintStr,
        outputMint: tokenOutMintStr,
        amount: amountInLamports,
        slippageBps: slippageBps,
        txVersion: txVersion,
      };

      logger.debug('Fetching Raydium quote from Trade API (mainnet)', { 
        url: quoteUrl, 
        params: quoteParams,
        cluster 
      });

      const quoteResponse = await axios.get(quoteUrl, { params: quoteParams });
      
      if (!quoteResponse.data.success || !quoteResponse.data.data) {
        throw new DexError(`Raydium API returned error: ${JSON.stringify(quoteResponse.data)}`, 'raydium');
      }

      const quoteData = quoteResponse.data.data;
      const outputAmountLamports = quoteData.outputAmount;
      const amountOut = fromLamports(outputAmountLamports, tokenOut);
      
      // Calculate price (output / input)
      const price = amountOut / amountIn;
      
      // Extract fee from route plan (sum of all fees in the route)
      let totalFeeAmount = 0;
      if (quoteData.routePlan && Array.isArray(quoteData.routePlan)) {
        for (const route of quoteData.routePlan) {
          totalFeeAmount += parseInt(route.feeAmount || '0');
        }
      }
      const feeAmountInToken = fromLamports(totalFeeAmount.toString(), tokenIn);
      const fee = totalFeeAmount > 0 ? feeAmountInToken / amountIn : 0.003; // Default to 0.3% if no fee info

      logger.info('Raydium quote received from Trade API (mainnet)', {
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        price,
        fee,
        priceImpact: quoteData.priceImpactPct,
        routePlan: quoteData.routePlan?.length || 0,
        cluster,
      });

      return {
        price,
        fee,
        amountOut,
        dex: 'raydium',
      };
    } catch (error) {
      // Log detailed error information
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorDetails = axios.isAxiosError(error) 
        ? { status: error.response?.status, statusText: error.response?.statusText, data: error.response?.data }
        : { message: errorMessage };
      
      logger.error('Error getting Raydium quote', { 
        error: errorMessage,
        details: errorDetails,
        tokenIn, 
        tokenOut, 
        amountIn 
      });
      
      if (error instanceof DexError) {
        throw error;
      }
      
      // If API call fails, provide helpful error message
      if (axios.isAxiosError(error)) {
        const apiError = `Raydium API error: ${error.response?.status} ${error.response?.statusText || 'Unknown'} - ${error.message}`;
        const apiDetails = error.response?.data ? ` Response: ${JSON.stringify(error.response.data)}` : '';
        throw new DexError(apiError + apiDetails, 'raydium');
      }
      
      throw new DexError(`Failed to get Raydium quote: ${errorMessage}`, 'raydium');
    }
  }

  async executeSwap(
    tokenIn: string,
    tokenOut: string,
    amountIn: number,
    minAmountOut: number,
    userKeypair: Keypair,
    _expectedAmountOut?: number // Used by mock providers to ensure execution matches routing quote; real providers can ignore
  ): Promise<DexExecutionResult> {
    logger.info('Executing Raydium swap', { 
      tokenIn, 
      tokenOut, 
      amountIn, 
      minAmountOut,
      userWallet: userKeypair.publicKey.toBase58() 
    });

    try {
      const connection = getConnection();
      const cluster = getCluster();
      
      // Get token mint addresses (cluster-aware)
      const tokenInMintStr = isNativeSol(tokenIn) ? getWrappedSolMint() : getTokenMint(tokenIn, cluster);
      const tokenOutMintStr = getTokenMint(tokenOut, cluster);

      if (!tokenInMintStr || !tokenOutMintStr) {
        throw new DexError(`Token not supported: ${tokenIn} or ${tokenOut}`, 'raydium');
      }

      const amountInLamports = toLamports(amountIn, tokenIn);

      // IMPORTANT: Raydium Trade API only supports mainnet
      // For devnet, SDK requires pool IDs upfront and has initialization issues
      if (cluster === 'devnet') {
        throw new DexError(
          `Raydium is not available on devnet without pool addresses. ` +
          `The Raydium Trade API only supports mainnet. ` +
          `For real execution (bonus points), switch to mainnet: ` +
          `Set SOLANA_CLUSTER=mainnet-beta and SOLANA_RPC_URL=https://api.mainnet-beta.solana.com in your .env file. ` +
          `This will enable real trade execution on mainnet using the Trade API. ` +
          `For devnet, you would need to create pools first and provide pool addresses.`,
          'raydium'
        );
      }

      // Use Raydium Trade API for mainnet
      const slippageBps = 50; // 0.5% slippage for quote
      const txVersion = 'V0';
      
      const quoteUrl = `${RAYDIUM_API_BASE}/compute/swap-base-in`;
      const quoteParams = {
        inputMint: tokenInMintStr,
        outputMint: tokenOutMintStr,
        amount: amountInLamports,
        slippageBps: slippageBps,
        txVersion: txVersion,
      };

      logger.debug('Fetching Raydium quote for swap execution (mainnet)', { params: quoteParams, cluster });
      
      const quoteResponse = await axios.get(quoteUrl, { params: quoteParams });
      
      if (!quoteResponse.data.success || !quoteResponse.data.data) {
        throw new DexError(`Raydium API quote error: ${JSON.stringify(quoteResponse.data)}`, 'raydium');
      }

      const quoteData = quoteResponse.data.data;
      const actualAmountOut = fromLamports(quoteData.outputAmount, tokenOut);
      const otherAmountThreshold = fromLamports(quoteData.otherAmountThreshold || quoteData.outputAmount, tokenOut);

      // Check slippage protection
      if (actualAmountOut < minAmountOut && otherAmountThreshold < minAmountOut) {
        throw new DexError(
          `Slippage tolerance exceeded. Expected at least ${minAmountOut}, got ${actualAmountOut} (threshold: ${otherAmountThreshold})`,
          'raydium'
        );
      }

      // Step 2: Fetch token accounts for input and output tokens (if not native SOL)
      // Per Raydium SDK demo (src/api/swap.ts lines 48-50): fetch token accounts using getTokenAccountsByOwner
      // Then find matching accounts by mint address
      const isInputSol = isNativeSol(tokenIn);
      const isOutputSol = isNativeSol(tokenOut);
      
      let inputTokenAccount: PublicKey | undefined = undefined;
      let outputTokenAccount: PublicKey | undefined = undefined;
      
      if (!isInputSol || !isOutputSol) {
        try {
          // Fetch all token accounts for the user's wallet (per SDK demo)
          const [tokenAccounts, token2022Accounts] = await Promise.all([
            connection.getTokenAccountsByOwner(userKeypair.publicKey, { programId: TOKEN_PROGRAM_ID }),
            connection.getTokenAccountsByOwner(userKeypair.publicKey, { programId: TOKEN_2022_PROGRAM_ID }),
          ]);
          
          // Parse token accounts to find ones matching our mints
          // Per SDK demo: tokenAccounts.value contains accounts with pubkey and account data
          const allTokenAccounts = [...tokenAccounts.value, ...token2022Accounts.value];
          
          for (const tokenAccount of allTokenAccounts) {
            try {
              // Parse token account data: mint address is at the start of the account data
              const accountData = tokenAccount.account.data;
              // SPL Token account layout: mint (32 bytes) + owner (32 bytes) + amount (8 bytes) + ...
              if (accountData.length >= 64) {
                const mintPubkey = new PublicKey(accountData.slice(0, 32));
                const mintStr = mintPubkey.toBase58();
                
                if (!isInputSol && mintStr === tokenInMintStr && !inputTokenAccount) {
                  inputTokenAccount = tokenAccount.pubkey;
                }
                if (!isOutputSol && mintStr === tokenOutMintStr && !outputTokenAccount) {
                  outputTokenAccount = tokenAccount.pubkey;
                }
              }
            } catch (parseError) {
              // Skip accounts that can't be parsed
              continue;
            }
          }
          
          logger.debug('Fetched token accounts for swap', {
            inputTokenAccount: inputTokenAccount?.toBase58(),
            outputTokenAccount: outputTokenAccount?.toBase58(),
            isInputSol,
            isOutputSol,
            totalTokenAccounts: allTokenAccounts.length,
          });
        } catch (tokenAccountError) {
          logger.warn('Failed to fetch token accounts, API will handle account creation if needed', {
            error: tokenAccountError instanceof Error ? tokenAccountError.message : String(tokenAccountError),
          });
          // Continue without explicit token accounts - Raydium API may handle account creation
        }
      }

      // Step 3: Fetch recommended priority fee from Raydium auto-fee API
      // Per Raydium SDK demo: use HIGH priority fee for better transaction success rate
      let computeUnitPriceMicroLamports = '50000'; // Default fallback
      try {
        const autoFeeUrl = 'https://api-v3.raydium.io/main/auto-fee';
        logger.debug('Fetching recommended priority fee from Raydium auto-fee API', { url: autoFeeUrl });
        const autoFeeResponse = await axios.get(autoFeeUrl, { timeout: 5000 });
        
        if (autoFeeResponse.data && autoFeeResponse.data.data && autoFeeResponse.data.data.default) {
          // Use HIGH priority fee (per SDK demo) for better transaction success rate
          const highFee = autoFeeResponse.data.data.default.h || autoFeeResponse.data.data.default.m || '50000';
          computeUnitPriceMicroLamports = String(highFee);
          logger.debug('Using recommended priority fee from auto-fee API', { 
            computeUnitPriceMicroLamports,
            priorityLevel: 'high',
            availableFees: {
              vh: autoFeeResponse.data.data.default.vh,
              h: autoFeeResponse.data.data.default.h,
              m: autoFeeResponse.data.data.default.m,
            },
          });
        }
      } catch (autoFeeError) {
        // If auto-fee API fails, use default value
        logger.warn('Failed to fetch recommended priority fee, using default', { 
          error: autoFeeError instanceof Error ? autoFeeError.message : String(autoFeeError),
          defaultFee: computeUnitPriceMicroLamports,
        });
      }

      // Step 4: Build transaction using Raydium Trade API
      // IMPORTANT: Per Raydium SDK demo (src/api/swap.ts), the payload structure is:
      // - swapResponse: The ENTIRE response from quote endpoint (quoteResponse.data)
      // - inputAccount/outputAccount: Token accounts (undefined for native SOL)
      // - computeUnitPriceMicroLamports: As STRING (HIGH priority fee from auto-fee API)
      const buildTxUrl = `${RAYDIUM_API_BASE}/transaction/swap-base-in`;
      
      // Build payload exactly as shown in Raydium SDK demo
      const basePayload: any = {
        swapResponse: quoteResponse.data, // Pass entire response object from quote endpoint
        wallet: userKeypair.publicKey.toBase58(),
        txVersion: txVersion,
        wrapSol: isInputSol, // Wrap SOL if input is native SOL
        unwrapSol: isOutputSol, // true means output mint receive sol, false means output mint received wsol
        computeUnitPriceMicroLamports: computeUnitPriceMicroLamports, // As STRING, HIGH priority fee
        // Per SDK demo: inputAccount and outputAccount are undefined for native SOL
        inputAccount: isInputSol ? undefined : inputTokenAccount?.toBase58(),
        outputAccount: isOutputSol ? undefined : outputTokenAccount?.toBase58(),
      };

      logger.debug('Building Raydium swap transaction (mainnet)', { 
        url: buildTxUrl,
        payload: {
          computeUnitPriceMicroLamports: basePayload.computeUnitPriceMicroLamports,
          inputAccount: basePayload.inputAccount,
          outputAccount: basePayload.outputAccount,
          wrapSol: basePayload.wrapSol,
          unwrapSol: basePayload.unwrapSol,
          swapResponseHasData: !!basePayload.swapResponse?.data,
        },
      });
      
      const buildTxResponse = await axios.post(buildTxUrl, basePayload);
      
      if (!buildTxResponse.data.success || !buildTxResponse.data.data || !buildTxResponse.data.data[0]) {
        throw new DexError(`Raydium API transaction build error: ${JSON.stringify(buildTxResponse.data)}`, 'raydium');
      }

      // Per Raydium SDK demo: transactions are returned as array of base64-encoded transactions
      const transactionBuffer = Buffer.from(buildTxResponse.data.data[0].transaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuffer);

      // Step 5: Sign transaction (per SDK demo)
      transaction.sign([userKeypair]);

      logger.info('Sending Raydium swap transaction to network (mainnet)', {
        tokenIn,
        tokenOut,
        amountIn,
        expectedAmountOut: actualAmountOut,
        userWallet: userKeypair.publicKey.toBase58(),
        transactionCount: buildTxResponse.data.data.length,
      });

      // Per Raydium SDK demo (src/api/swap.ts lines 114-127): 
      // 1. Send with skipPreflight: true
      // 2. Get latest blockhash AFTER sending
      // 3. Confirm with that blockhash
      let txHash: string;
      try {
        txHash = await connection.sendTransaction(transaction, {
          skipPreflight: true, // Per SDK demo - skip preflight for better performance
          maxRetries: 3,
        });
      } catch (sendError: any) {
        // Catch SendTransactionError and extract more details
        const errorDetails = sendError.signature 
          ? { signature: sendError.signature, logs: sendError.logs }
          : { message: sendError.message };
        
        logger.error('Failed to send Raydium transaction', {
          error: sendError.message || String(sendError),
          details: errorDetails,
          userWallet: userKeypair.publicKey.toBase58(),
        });
        
        throw new DexError(
          `Failed to send transaction: ${sendError.message || String(sendError)}. ` +
          `Make sure your wallet has enough SOL to cover the swap amount (${amountIn} SOL) + transaction fees (~0.001 SOL). ` +
          `Current wallet balance check recommended.`,
          'raydium'
        );
      }

      logger.info('Raydium swap transaction sent (mainnet)', { txHash });

      // Step 6: Confirm transaction
      // IMPORTANT: The transaction was created by Raydium API with a specific blockhash.
      // By the time we send it and try to confirm, that blockhash may have expired.
      // Using signature-only confirmation (without blockhash) is more reliable as it polls until confirmed.
      // This is slower but avoids "block height exceeded" errors.
      logger.debug('Confirming Raydium transaction (signature-only, will poll until confirmed)', {
        txHash,
        note: 'Using signature-only confirmation to avoid blockhash expiration issues',
      });

      // Use custom confirmation utility to avoid 30-second default timeout
      // confirmTransaction has a hardcoded 30-second timeout, so we use awaitTransactionConfirmation
      logger.debug('Confirming Raydium transaction (custom polling with 60s timeout)', {
        txHash,
        note: 'Using awaitTransactionConfirmation with 60s timeout to avoid default 30s limit',
      });

      try {
        // Use the utility function that polls with 60-second timeout
        await awaitTransactionConfirmation(connection, txHash, 60000);
        logger.info('Raydium transaction confirmed', { txHash });
      } catch (confirmationError: any) {
        // Check if transaction actually failed or just timed out
        const status = await connection.getSignatureStatus(txHash);
        if (status.value?.err) {
          throw new DexError(
            `Transaction failed: ${JSON.stringify(status.value.err)}. ` +
            `Transaction signature: ${txHash}. ` +
            `Check transaction status at https://solscan.io/tx/${txHash}`,
            'raydium'
          );
        }
        
        // If timeout but no error, transaction might still be processing
        throw new DexError(
          `Transaction confirmation timeout after 60 seconds. ` +
          `It is unknown if it succeeded or failed. ` +
          `Check signature ${txHash} using the Solana Explorer or CLI tools. ` +
          `View at: https://solscan.io/tx/${txHash}`,
          'raydium'
        );
      }

      // Calculate executed price and fee
      const executedPrice = actualAmountOut / amountIn;
      
      // Extract fee from route plan
      let totalFeeAmount = 0;
      if (quoteData.routePlan && Array.isArray(quoteData.routePlan)) {
        for (const route of quoteData.routePlan) {
          totalFeeAmount += parseInt(route.feeAmount || '0');
        }
      }
      const feeAmountInToken = fromLamports(totalFeeAmount.toString(), tokenIn);
      const fee = totalFeeAmount > 0 ? feeAmountInToken / amountIn : 0.003;

      logger.info('Raydium swap executed successfully (mainnet)', {
        txHash,
        executedPrice,
        amountOut: actualAmountOut,
        fee,
        userWallet: userKeypair.publicKey.toBase58(),
      });

      return {
        txHash,
        executedPrice,
        amountOut: actualAmountOut,
        fee,
      };
    } catch (error) {
      logger.error('Error executing Raydium swap', { 
        error, 
        tokenIn, 
        tokenOut, 
        amountIn,
        userWallet: userKeypair.publicKey.toBase58() 
      });
      
      if (error instanceof DexError) {
        throw error;
      }
      
      if (axios.isAxiosError(error)) {
        throw new DexError(
          `Raydium API error: ${error.response?.status} ${error.response?.statusText} - ${error.message}`,
          'raydium'
        );
      }
      
      throw new DexError(
        `Failed to execute Raydium swap: ${error instanceof Error ? error.message : String(error)}`,
        'raydium'
      );
    }
  }
}
