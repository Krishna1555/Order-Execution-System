import { Keypair, Connection, Cluster, PublicKey } from '@solana/web3.js';
import { createSyncNativeInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';
import { SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as bs58 from 'bs58';
import { logger } from './logger';
import { ValidationError } from './errors';

let connection: Connection | null = null;

// Constants
const LAMPORTS_PER_SOL = 1_000_000_000; // 1 SOL = 1e9 lamports

/**
 * Parse user-provided wallet private key (base58) to Keypair
 */
export function parseWalletPrivateKey(privateKey: string): Keypair {
  try {
    const secretKey = bs58.decode(privateKey);
    if (secretKey.length !== 64) {
      throw new ValidationError('Invalid private key length. Expected 64 bytes.', 'walletPrivateKey');
    }
    const keypair = Keypair.fromSecretKey(secretKey);
    logger.debug('Parsed wallet from private key', { publicKey: keypair.publicKey.toBase58() });
    return keypair;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error('Failed to parse wallet private key', { error });
    throw new ValidationError('Invalid walletPrivateKey format. Expected base58-encoded private key (64 bytes).', 'walletPrivateKey');
  }
}

/**
 * Parse user-provided wallet keypair (JSON array) to Keypair
 */
export function parseWalletKeypair(keypairArray: number[]): Keypair {
  try {
    if (!Array.isArray(keypairArray) || keypairArray.length !== 64) {
      throw new ValidationError('Invalid keypair array length. Expected array of 64 numbers.', 'walletKeypair');
    }
    const secretKey = Uint8Array.from(keypairArray);
    const keypair = Keypair.fromSecretKey(secretKey);
    logger.debug('Parsed wallet from keypair array', { publicKey: keypair.publicKey.toBase58() });
    return keypair;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    logger.error('Failed to parse wallet keypair array', { error });
    throw new ValidationError('Invalid walletKeypair format. Expected JSON array of 64 numbers.', 'walletKeypair');
  }
}

/**
 * Parse user wallet from OrderRequest (either privateKey or keypair array)
 * Returns the user's keypair for executing swaps
 * This function is used by order service to parse user-provided wallet
 */
export function parseUserWallet(privateKey?: string, keypairArray?: number[]): Keypair {
  if (!privateKey && !keypairArray) {
    throw new ValidationError(
      'Wallet is required. Provide either walletPrivateKey (base58-encoded private key) or walletKeypair (JSON array of 64 numbers).',
      'wallet'
    );
  }

  if (privateKey && keypairArray) {
    throw new ValidationError(
      'Provide only one wallet format: either walletPrivateKey or walletKeypair, not both.',
      'wallet'
    );
  }

  if (privateKey) {
    return parseWalletPrivateKey(privateKey);
  }

  if (keypairArray) {
    return parseWalletKeypair(keypairArray);
  }

  throw new ValidationError('Invalid wallet format. Expected walletPrivateKey or walletKeypair.', 'wallet');
}

/**
 * Get Solana connection instance
 * Uses SOLANA_RPC_URL if provided, otherwise defaults based on SOLANA_CLUSTER
 */
export function getConnection(): Connection {
  if (connection) {
    return connection;
  }

  // Use explicit RPC URL if provided, otherwise derive from cluster
  let rpcUrl = process.env.SOLANA_RPC_URL;
  
  if (!rpcUrl) {
    const cluster = getCluster();
    switch (cluster) {
      case 'mainnet-beta':
        rpcUrl = 'https://api.mainnet-beta.solana.com';
        break;
      case 'testnet':
        rpcUrl = 'https://api.testnet.solana.com';
        break;
      case 'devnet':
      default:
        rpcUrl = 'https://api.devnet.solana.com';
        break;
    }
  }
  
  connection = new Connection(rpcUrl, 'confirmed');
  logger.info('Created Solana connection', { rpcUrl, cluster: getCluster() });
  return connection;
}

/**
 * Get current cluster (devnet or mainnet-beta)
 * Automatically detects from RPC URL if SOLANA_CLUSTER not set
 */
export function getCluster(): Cluster {
  // First check explicit environment variable
  if (process.env.SOLANA_CLUSTER) {
    const cluster = process.env.SOLANA_CLUSTER;
    if (cluster === 'devnet' || cluster === 'mainnet-beta' || cluster === 'testnet') {
      return cluster;
    }
  }
  
  // If not set, try to detect from RPC URL
  const rpcUrl = process.env.SOLANA_RPC_URL || '';
  if (rpcUrl.includes('mainnet-beta') || rpcUrl.includes('mainnet')) {
    return 'mainnet-beta';
  }
  if (rpcUrl.includes('testnet')) {
    return 'testnet';
  }
  if (rpcUrl.includes('devnet')) {
    return 'devnet';
  }
  
  // Default to devnet if can't determine
  return 'devnet';
}

/**
 * Check if devnet execution is enabled
 */
export function isDevnetEnabled(): boolean {
  return process.env.DEVNET_ENABLED === 'true';
}

/**
 * Wrap native SOL to WSOL (Wrapped SOL) for a user wallet
 * Creates associated token account if it doesn't exist, transfers SOL, and syncs
 */
export async function wrapSol(userKeypair: Keypair, amountLamports: number): Promise<string> {
  const connection = getConnection();

  // Get associated token account address for WSOL
  const wrappedSolAccount = await getAssociatedTokenAddress(NATIVE_MINT, userKeypair.publicKey);

  // Check if account exists
  const accountInfo = await connection.getAccountInfo(wrappedSolAccount);
  const transaction = new Transaction();

  // If account doesn't exist, create it first
  if (!accountInfo) {
    const { createAssociatedTokenAccountInstruction } = await import('@solana/spl-token');
    transaction.add(
      createAssociatedTokenAccountInstruction(
        userKeypair.publicKey, // payer
        wrappedSolAccount, // ata
        userKeypair.publicKey, // owner
        NATIVE_MINT // mint
      )
    );
  }

  // Transfer SOL to WSOL account and sync to activate it
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: userKeypair.publicKey,
      toPubkey: wrappedSolAccount,
      lamports: amountLamports,
    }),
    createSyncNativeInstruction(wrappedSolAccount, TOKEN_PROGRAM_ID)
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [userKeypair]);
  logger.info('Wrapped SOL to WSOL', { 
    signature, 
    amountLamports, 
    amountSOL: amountLamports / LAMPORTS_PER_SOL,
    userWallet: userKeypair.publicKey.toBase58(),
    wrappedSolAccount: wrappedSolAccount.toBase58(),
    accountCreated: !accountInfo
  });
  return signature;
}

/**
 * Unwrap WSOL to native SOL
 * TODO: Implement using SPL token close account instruction
 */
export async function unwrapSol(amountLamports: number): Promise<string> {
  logger.info('Unwrapping WSOL to SOL', { amountLamports });
  throw new Error('Unwrap SOL not yet implemented - requires SPL token close account instruction');
}

/**
 * Get token account balance
 */
export async function getTokenBalance(mint: string, wallet: PublicKey): Promise<number> {
  const connection = getConnection();
  const mintPubkey = new PublicKey(mint);
  const tokenAccount = await getAssociatedTokenAddress(mintPubkey, wallet);

  try {
    const balance = await connection.getTokenAccountBalance(tokenAccount);
    return parseFloat(balance.value.amount);
  } catch (error) {
    logger.warn('Token account not found or error fetching balance', { mint, wallet: wallet.toBase58(), error });
    return 0;
  }
}

/**
 * Wait for transaction confirmation with timeout
 */
export async function awaitTransactionConfirmation(
  connection: Connection,
  txHash: string,
  timeoutMs: number = 60000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const status = await connection.getSignatureStatus(txHash);
    if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') {
      return;
    }
    if (status?.value?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Transaction confirmation timeout after ${timeoutMs}ms`);
}

/**
 * Generate Solana Explorer link for transaction hash
 */
export function getSolanaExplorerLink(txHash: string, cluster?: string): string {
  const clusterName = cluster || getCluster();
  const clusterParam = clusterName === 'mainnet-beta' ? '' : `?cluster=${clusterName}`;
  return `https://explorer.solana.com/tx/${txHash}${clusterParam}`;
}
