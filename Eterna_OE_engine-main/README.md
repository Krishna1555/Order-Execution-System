# Order Execution Engine

A high-performance order execution engine with DEX routing and real-time WebSocket status updates. This system processes market orders by comparing prices across multiple DEXs (Raydium and Meteora) and routes orders to the best execution venue.

## Features

- **Market Order Execution**: Immediate execution at current market price
- **User-Owned Wallets**: Each order uses the user's own wallet for execution (not a shared service wallet)
- **DEX Routing**: Automatically compares and routes to best price (Raydium/Meteora)
- **Real-time Updates**: WebSocket streaming of order lifecycle with Solana Explorer links
- **Queue Management**: Concurrent processing with rate limiting (10 concurrent, 100/min)
- **Retry Logic**: Exponential backoff with up to 3 attempts
- **Health Monitoring**: Comprehensive health checks for all services
- **Devnet Execution**: Optional real Solana devnet execution via `DEVNET_ENABLED=true` (requires user wallets)

## Architecture

```
Client → Fastify Server → Order Service → BullMQ Queue → Order Processor
                                                              ↓
                                                         DEX Router
                                                              ↓
                                                      WebSocket Updates
```

### Order Lifecycle

1. **Pending** - Order received and queued
2. **Routing** - Comparing DEX prices
3. **Building** - Creating transaction
4. **Submitted** - Transaction sent to network
5. **Confirmed** - Transaction successful (includes txHash)
6. **Failed** - If any step fails (includes error)

## Tech Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Fastify with WebSocket support
- **Queue**: BullMQ with Redis
- **Database**: PostgreSQL for order history
- **Testing**: Jest with unit and integration tests

## Prerequisites

- Node.js 18+
- Memurai (Windows Redis alternative) or Redis-compatible server
- Supabase account (for PostgreSQL database) or PostgreSQL database
- **Solana Wallet** (for real devnet execution): Users provide their own wallet in order requests
  - For devnet testing, use Solana faucet: https://faucet.solana.com
  - For mock execution (`DEVNET_ENABLED=false`), any wallet format is accepted (not used for execution)

## Quick Start

### 1. Clone and Install

```bash
git clone <repo-url>
cd eterna_oe_engine
npm install
```

### 2. Set Up Services

**Install Memurai (Windows Redis):**
1. Download and install Memurai from [memurai.com](https://www.memurai.com/)
2. Memurai runs as a Windows service on port 6379 by default
3. Verify it's running: `Get-Service -Name Memurai*`

**Set Up Supabase:**
1. Create a project at [supabase.com](https://supabase.com/)
2. Go to Project Settings → Database
3. Copy the connection string (use Connection Pooling for better performance)

### 3. Environment Configuration

Create a `.env` file in the root directory:

```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Supabase connection string
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?sslmode=require

# Memurai (Redis-compatible)
REDIS_URL=redis://localhost:6379

# Queue Configuration
QUEUE_CONCURRENCY=10
QUEUE_RATE_LIMIT=100
```

See [ENV_SETUP.md](ENV_SETUP.md) for detailed setup instructions.

### 4. Run Database Migrations

```bash
npm run db:migrate
```

### 5. Run Application

```bash
# Development mode with hot reload
npm run dev

# Production build
npm run build
npm start
```

## API Endpoints

### Health Checks

- `GET /health` - Overall health check
- `GET /health/db` - Database connectivity
- `GET /health/redis` - Redis connectivity
- `GET /health/queue` - Queue status

### Orders

- `POST /api/orders/execute` - Create and execute order
  - Returns `orderId` for tracking
  - Order is queued for execution

- `GET /api/orders/:orderId/ws` - WebSocket connection for real-time status updates
  - Connect after creating order to receive status updates
  - Sends status updates: pending → routing → building → submitted → confirmed/failed

- `GET /api/orders/:orderId` - Get order status (HTTP)

### Request Example

**Note:** Users must provide their own wallet for executing swaps. This ensures orders are executed from the user's wallet, not a shared service wallet.

```json
{
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amountIn": 1,
  "slippageTolerance": 0.01,
  "orderType": "market",
  "walletPrivateKey": "base58-encoded-private-key-here"  // OR
  // "walletKeypair": [array, of, 64, numbers]  // Alternative format
}
```

**Wallet Format Options:**
- `walletPrivateKey`: Base58-encoded private key (64 bytes) - Recommended
- `walletKeypair`: JSON array of 64 numbers representing the secret key

**Security Note:** The wallet private key is used only for executing the swap transaction. It is NOT stored in the database (only the public wallet address is stored for reference). The private key is passed through the queue and used only during swap execution.

### Response Example

```json
{
  "orderId": "uuid-here",
  "status": "pending",
  "message": "Order created and queued for execution"
}
```

**Confirmed Order Response (via WebSocket/GET):**

```json
{
  "id": "uuid-here",
  "orderId": "uuid-here",
  "status": "confirmed",
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amountIn": 1,
  "amountOut": 0.985,
  "executedPrice": 0.985,
  "slippageTolerance": 0.01,
  "orderType": "market",
  "selectedDex": "raydium",
  "txHash": "transaction-hash-here",
  "explorerLink": "https://explorer.solana.com/tx/transaction-hash-here?cluster=devnet",
  "userWalletAddress": "user-wallet-public-key-here",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:01.000Z"
}
```

## WebSocket Updates

After creating an order, connect to the WebSocket endpoint to receive real-time status updates:

```javascript
// 1. Create order via POST
const response = await fetch('http://localhost:3000/api/orders/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tokenIn: 'SOL',
    tokenOut: 'USDC',
    amountIn: 1,
    orderType: 'market'
  })
});
const { orderId } = await response.json();

// 2. Connect to WebSocket for updates
const ws = new WebSocket(`ws://localhost:3000/api/orders/${orderId}/ws`);
ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log('Status update:', update);
};
```

Example WebSocket message:

```json
{
  "type": "status_update",
  "orderId": "uuid-here",
  "status": "routing",
  "data": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

## Testing

### Running Tests

**With Mock Providers (Default):**
```bash
# Run all tests (uses mock providers)
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# Coverage report
npm run test:coverage
```

**With Real Devnet Providers:**
```bash
# Windows PowerShell
$env:DEVNET_ENABLED="true"; npm test

# Or use npm scripts (Windows CMD)
npm run test:devnet           # All tests
npm run test:devnet:unit      # Unit tests only
npm run test:devnet:integration  # Integration tests only
```

**Test Behavior:**
- **`DEVNET_ENABLED=false` (default)**: Tests use mock providers (always pass, no network required)
- **`DEVNET_ENABLED=true`**: Tests use real Raydium/Meteora SDKs
  - `getQuote()` tests: Pass (real providers have placeholder implementations)
  - `executeSwap()` tests: Expect "not yet fully implemented" errors (expected until full SDK integration)
  
For more details, see [ENV_SETUP.md](./ENV_SETUP.md#testing-with-devnet-enabled).

### Manual Testing Scripts

**WebSocket Testing:**
```bash
# Single order with WebSocket
WALLET_PRIVATE_KEY=your-key tsx scripts/test-websocket.ts
```

**Concurrent Orders Testing (Queue Verification):**
```bash
# Test 5-7 concurrent orders to verify queue design
WALLET_PRIVATE_KEY=your-key tsx scripts/test-concurrent-orders.ts 7
```

The concurrent orders test will:
- Create multiple orders simultaneously
- Connect WebSocket to each order
- Track status progression for all orders
- Show real-time updates with millisecond timestamps
- Generate summary report with concurrency analysis
- Verify queue concurrency (10 workers) and rate limiting (100 orders/min)

## Documentation

- **[Architecture Overview](./docs/architecture.md)** - System design and decisions
- **[BullMQ <> Redis Architecture](./docs/bullmq-redis-architecture.md)** - Complete end-to-end control flow, queue system, and Redis integration details
- **[WebSocket Testing Guide](./docs/WEBSOCKET_TESTING.md)** - Guide for testing WebSocket connections and real-time status updates
- **[Environment Setup](./ENV_SETUP.md)** - Local development setup instructions
- **[API Documentation](./docs/api/postman-collection.json)** - Postman collection for API testing

## Project Structure

```
eterna_oe_engine/
├── src/
│   ├── server.ts              # Fastify server setup
│   ├── config/                # Configuration
│   │   ├── index.ts           # Main config
│   │   ├── database.ts        # Database config
│   │   ├── queue.ts           # Queue worker configuration
│   │   └── tokens.ts          # Solana token mint addresses
│   ├── routes/                # API routes
│   ├── services/              # Business logic
│   ├── processors/            # Queue workers (order.processor.ts)
│   ├── queue/                 # Queue management
│   │   ├── order.queue.ts     # BullMQ Queue instance
│   │   └── retry.config.ts    # Retry configuration
│   ├── dex/                   # DEX routing
│   │   ├── router.ts          # DEX router (switches between mock/real)
│   │   ├── types.ts           # DexProvider interface
│   │   ├── mock/              # Mock providers (Option B)
│   │   │   ├── raydium.mock.ts
│   │   │   └── meteora.mock.ts
│   │   └── providers/         # Real providers (Option A)
│   │       ├── raydium.provider.ts
│   │       └── meteora.provider.ts
│   ├── utils/                 # Utilities
│   │   ├── solana.ts          # Solana wallet/connection utilities
│   │   ├── validation.ts      # Input validation (includes wallet validation)
│   │   ├── logger.ts          # Logging
│   │   └── errors.ts          # Custom error types
│   ├── models/                # Database models
│   ├── queue/                 # Queue configuration
│   ├── types/                 # TypeScript types
│   ├── utils/                 # Utilities
│   └── tests/                 # Tests
├── migrations/                # Database migrations
├── scripts/                   # Utility scripts
└── docs/                      # Documentation
```

## Design Decisions

### Why Market Orders?

Market orders provide immediate execution at current market price, making them ideal for demonstrating the DEX routing and execution flow. They eliminate the complexity of price monitoring (limit orders) or token launch detection (sniper orders), allowing focus on core architecture: routing logic, queue management, and real-time status updates.

### User-Owned Wallets (Not Service Wallets)

The system uses **user-owned wallets** rather than a shared service wallet. This architecture choice provides:

- **Security**: Users maintain control of their funds - the service never holds user assets
- **Transparency**: Each transaction is signed by the user's wallet, visible on Solana Explorer
- **Decentralization**: No single point of failure or custody risk
- **Compliance**: Reduces regulatory concerns by not acting as a custodian

Users provide their wallet (`walletPrivateKey` or `walletKeypair`) in order requests. The private key is used only during swap execution and is **never stored** in the database (only the public wallet address is stored for reference).

### Real Devnet Execution (Option A)

When `DEVNET_ENABLED=true`, the system uses actual Raydium and Meteora SDKs to execute real trades on Solana devnet:

- **Raydium Provider**: Uses `@raydium-io/raydium-sdk-v2` for real Raydium swaps
- **Meteora Provider**: Uses `@meteora-ag/dynamic-amm-sdk` for real Meteora swaps
- **Transaction Execution**: Uses `@solana/web3.js` to sign and submit transactions with user's wallet
- **Solana Explorer**: Transaction hashes are automatically converted to Solana Explorer links
- **Devnet Testing**: Use Solana faucet (https://faucet.solana.com) to fund test wallets

### Mock Execution (Option B)

When `DEVNET_ENABLED=false` or undefined, the system uses mock providers:

- Simulates DEX responses with realistic delays (2-3 seconds)
- Mock price variations between DEXs (~2-5% difference)
- Focus on architecture and flow without Solana network dependencies
- Ideal for testing and development without devnet setup

### Extending to Other Order Types

- **Limit Orders**: Add price monitoring service that polls DEX prices and triggers execution when target price is reached. User wallets would be required in limit order requests.
- **Sniper Orders**: Add token launch detection service that monitors new token deployments and executes swaps immediately upon pool creation. Uses user's wallet for transaction signing.

Both extensions would integrate with the existing queue system and DEX router without requiring architectural changes.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed deployment instructions.

## API Documentation

Postman collection available in `docs/api/postman-collection.json`

## License

MIT
