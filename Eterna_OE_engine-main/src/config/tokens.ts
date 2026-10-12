import { Cluster } from '@solana/web3.js';
import { getCluster } from '../utils/solana';

/**
 * Token mint addresses for Solana by cluster
 * Maps token symbols to their Solana mint addresses per cluster
 */
// Token mints by cluster - supports all cluster types
type TokenMintMap = Partial<Record<Cluster, string>> & { default: string };

const TOKEN_MINTS_BY_CLUSTER: Record<string, TokenMintMap> = {
  // Native SOL (same across all clusters)
  SOL: {
    default: 'So11111111111111111111111111111111111111112', // Wrapped SOL (WSOL)
    devnet: 'So11111111111111111111111111111111111111112',
    'mainnet-beta': 'So11111111111111111111111111111111111111112',
    testnet: 'So11111111111111111111111111111111111111112',
  },
  WSOL: {
    default: 'So11111111111111111111111111111111111111112',
    devnet: 'So11111111111111111111111111111111111111112',
    'mainnet-beta': 'So11111111111111111111111111111111111111112',
    testnet: 'So11111111111111111111111111111111111111112',
  },

  // USDC - different addresses for devnet vs mainnet
  USDC: {
    devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC devnet (official Circle devnet mint)
    'mainnet-beta': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mainnet (official Circle mainnet mint)
    default: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Default to mainnet
    testnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Testnet uses mainnet mint if available
  },

  // USDT
  USDT: {
    'mainnet-beta': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT mainnet
    default: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // No official USDT on devnet/testnet
    testnet: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  },
};

/**
 * Check if token symbol is native SOL
 */
export function isNativeSol(symbol: string): boolean {
  return symbol.toUpperCase() === 'SOL';
}

/**
 * Get token mint address for a symbol based on current cluster
 */
export function getTokenMint(symbol: string, cluster?: Cluster): string | undefined {
  const symbolUpper = symbol.toUpperCase();
  const clusterMints = TOKEN_MINTS_BY_CLUSTER[symbolUpper];
  
  if (!clusterMints) {
    return undefined;
  }

  // Use provided cluster or detect from environment
  const currentCluster = cluster || getCluster();
  
  // Try cluster-specific mint first, then default
  return clusterMints[currentCluster] || clusterMints.default;
}

/**
 * Get wrapped SOL mint address
 */
export function getWrappedSolMint(): string {
  return TOKEN_MINTS_BY_CLUSTER.WSOL.default;
}

/**
 * Get token symbol from mint address (reverse lookup)
 * Searches across all clusters
 */
export function getTokenSymbol(mint: string): string | undefined {
  for (const [symbol, clusterMints] of Object.entries(TOKEN_MINTS_BY_CLUSTER)) {
    for (const cluster of Object.keys(clusterMints)) {
      if (clusterMints[cluster as Cluster | 'default'] === mint) {
        return symbol;
      }
    }
  }
  return undefined;
}
