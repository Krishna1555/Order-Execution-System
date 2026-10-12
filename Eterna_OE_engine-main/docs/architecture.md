# Architecture Documentation

## Design Decisions

### Why Market Orders?

Market orders provide immediate execution at current market price, making them ideal for demonstrating the DEX routing and execution flow. They eliminate the complexity of price monitoring (limit orders) or token launch detection (sniper orders), allowing focus on core architecture: routing logic, queue management, and real-time status updates.

### User-Owned Wallets (Not Service Wallets)

The system uses **user-owned wallets** rather than a shared service wallet. This architecture choice provides:

- **Security**: Users maintain control of their funds - the service never holds user assets
- **Transparency**: Each transaction is signed by the user's wallet, visible on Solana Explorer
- **Decentralization**: No single point of failure or custody risk
- **Compliance**: Reduces regulatory concerns by not acting as a custodian

Users provide their wallet (`walletPrivateKey` or `walletKeypair`) in order requests. The private key is used only during swap execution and is never stored in the database (only the public wallet address is stored for reference).

### Extending to Other Order Types

The engine is designed to be extensible:

- **Limit Orders**: Add a price monitoring service that polls DEX prices and triggers execution when the target price is reached. The existing queue system and DEX router can be reused without architectural changes. User wallets would be required in the limit order request.

- **Sniper Orders**: Add a token launch detection service that monitors new token deployments and executes swaps immediately upon pool creation. This would integrate with the existing execution pipeline, using the user's wallet provided in the order request.

## System Architecture

### Components

1. **Fastify Server**: Handles HTTP requests and WebSocket connections
2. **Order Service**: Validates and creates orders (requires user wallet in request)
3. **BullMQ Queue**: Manages order processing with concurrency and rate limiting
4. **Order Processor**: Worker that processes orders through the execution lifecycle using user's wallet
5. **DEX Router**: Fetches quotes from multiple DEXs and selects the best execution venue
   - **Mock Providers** (default): Simulate DEX responses with realistic delays
   - **Real Providers** (`DEVNET_ENABLED=true`): Use actual Raydium/Meteora SDKs for devnet execution
6. **WebSocket Service**: Manages real-time status updates to clients (includes Solana Explorer links)
7. **PostgreSQL**: Persistent storage for order history (stores user wallet address, not private key)
8. **Redis**: Queue backend and active order cache

### User-Owned Wallets Architecture

**Key Design Decision:** Each order uses the user's own wallet for execution, not a shared service wallet.

**Benefits:**
- **Security**: Users maintain control of their private keys
- **Transparency**: Each transaction is clearly linked to the user's wallet
- **Compliance**: Easier to track and audit user transactions
- **No Custody**: Service doesn't hold or manage user funds

**Implementation:**
- Users provide wallet (`walletPrivateKey` or `walletKeypair`) in order request
- Wallet is parsed and validated before order creation
- Wallet private key is passed through queue (never stored in database)
- Only wallet public address is stored in order record for reference
- Each swap transaction is executed with the user's keypair
- Solana Explorer links are generated for confirmed transactions

### Order Lifecycle

1. **Pending**: Order received and queued
2. **Routing**: Comparing DEX prices
3. **Building**: Creating transaction
4. **Submitted**: Transaction sent to network
5. **Confirmed**: Transaction successful (includes txHash)
6. **Failed**: If any step fails (includes error)

### DEX Routing Logic

The router fetches quotes from both Raydium and Meteora concurrently, compares the effective output amounts (after fees), and selects the DEX offering the best price. Routing decisions are logged for transparency.

**Provider Switching:**
- **Mock Providers (Option B)**: Used when `DEVNET_ENABLED=false` or undefined. Simulates DEX responses with realistic delays (2-3 seconds) and price variations (~2-5%).
- **Real Providers (Option A)**: Used when `DEVNET_ENABLED=true`. Uses actual Raydium/Meteora SDKs to execute real trades on Solana devnet/mainnet. Requires user wallets for transaction signing.

**Execution:**
- User provides their wallet (`walletPrivateKey` or `walletKeypair`) in order request
- Wallet is parsed and validated before order creation
- During swap execution, the user's wallet is used to sign and submit the transaction
- Transaction hash and Solana Explorer link are returned in the confirmed order status

### Queue Configuration

- **Concurrency**: 10 workers processing orders simultaneously
- **Rate Limit**: 100 orders per minute
- **Retry**: Exponential backoff with maximum 3 attempts
- **Failed Jobs**: Retained for 24 hours for post-mortem analysis

### Error Handling

- Validation errors return 400 status
- DEX errors trigger retry mechanism
- Failed orders are persisted with error messages
- WebSocket connections handle errors gracefully

## Technology Choices

- **Fastify**: High-performance web framework with built-in WebSocket support
- **BullMQ**: Robust queue system with Redis backend
- **PostgreSQL**: Reliable relational database for order history
- **TypeScript**: Type safety and better developer experience
- **Jest**: Comprehensive testing framework
- **Solana Web3.js**: Core Solana blockchain interaction and wallet management
- **Raydium SDK v2**: DEX routing and swap execution on Raydium
- **Meteora SDK**: DEX routing and swap execution on Meteora
- **bs58**: Base58 encoding/decoding for Solana private keys

## Solana Integration (Option A: Real Devnet Execution)

### Wallet Management
- Users provide their own Solana wallets (private keys) in order requests
- Wallets are parsed using `parseUserWallet()` utility function
- Supports two formats:
  - `walletPrivateKey`: Base58-encoded private key (64 bytes)
  - `walletKeypair`: JSON array of 64 numbers representing the secret key
- Private keys are used only during transaction execution and never stored in the database

### DEX Providers
- **Raydium Provider**: Uses `@raydium-io/raydium-sdk-v2` for real Raydium swaps
- **Meteora Provider**: Uses `@meteora-ag/dynamic-amm-sdk` for real Meteora swaps
- Both providers accept user keypair in `executeSwap()` method
- Transaction execution uses `sendAndConfirmTransaction()` from `@solana/web3.js`

### Transaction Flow
1. User submits order with their wallet
2. Order is queued with wallet information
3. Processor fetches quotes from both DEXs
4. Best DEX is selected based on price comparison
5. Swap transaction is built using user's wallet
6. Transaction is signed by user's keypair and submitted to Solana network
7. Transaction hash and Solana Explorer link are returned
8. Order status updated to "confirmed" with transaction details

### Solana Explorer Integration
- Transaction hashes are automatically converted to Solana Explorer links
- Links include cluster parameter (devnet/mainnet-beta)
- Format: `https://explorer.solana.com/tx/{txHash}?cluster={cluster}`
- Explorer links are included in WebSocket updates and HTTP responses for confirmed orders

## Queue System Architecture

For detailed documentation on the BullMQ <> Redis queue system, including:
- Complete end-to-end control flow
- Job lifecycle and state transitions
- Redis data structures and operations
- Error handling and retry mechanisms
- Worker configuration and scaling
- Performance considerations

See: **[BullMQ <> Redis Architecture Documentation](./bullmq-redis-architecture.md)**
