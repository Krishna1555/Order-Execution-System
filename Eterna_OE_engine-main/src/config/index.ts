import dotenv from 'dotenv';

dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  database: {
    url: process.env.DATABASE_URL || '', // Supabase connection string required
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379', // Memurai default
  },
  queue: {
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '10', 10),
    rateLimit: parseInt(process.env.QUEUE_RATE_LIMIT || '100', 10),
  },
  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    cluster: (process.env.SOLANA_CLUSTER as 'devnet' | 'mainnet-beta' | 'testnet') || 'devnet',
    // Note: Service wallet removed - users provide their own wallets in order requests
    devnetEnabled: process.env.DEVNET_ENABLED === 'true',
  },
  service: {
    type: process.env.SERVICE_TYPE || 'default',
    enableHttpServer: process.env.ENABLE_HTTP_SERVER !== 'false', // Default: true
    enableWebSocket: process.env.ENABLE_WEBSOCKET !== 'false', // Default: true
    enableWorker: process.env.ENABLE_WORKER !== 'false', // Default: true
    enableHealth: process.env.ENABLE_HEALTH !== 'false', // Default: true
  },
};
