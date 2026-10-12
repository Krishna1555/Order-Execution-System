# Solana Order Execution Engine

A TypeScript-based backend for processing Solana token swaps. The system compares swap quotes from Raydium and Meteora, manages orders through a background queue, and provides real-time order status updates.

## Features

- Token swap order processing
- DEX quote comparison and routing
- Background job processing with BullMQ and Redis
- Real-time updates using WebSockets
- Order history stored in PostgreSQL
- Retry handling for failed jobs
- Mock execution and optional Solana devnet support

## Tech Stack

- **Language:** TypeScript, Node.js
- **API:** Fastify
- **Blockchain:** Solana Web3.js
- **DEXs:** Raydium, Meteora
- **Queue:** BullMQ, Redis
- **Database:** PostgreSQL
- **Communication:** REST API, WebSockets

## How It Works

1. A client submits a token swap order.
2. The order is validated and added to the queue.
3. A background worker processes the order.
4. The system compares DEX quotes and prepares the swap.
5. Order status updates are sent through WebSockets.
6. Order details and execution results are stored in the database.

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- Redis or Memurai
- PostgreSQL or Supabase

### Installation

```bash
git clone <YOUR-REPOSITORY-URL>
cd <YOUR-REPOSITORY-NAME>
npm install
```

### Environment Setup

Create a `.env` file in the project root:

```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
DATABASE_URL=your_postgresql_connection_string
REDIS_URL=redis://localhost:6379
QUEUE_CONCURRENCY=10
QUEUE_RATE_LIMIT=100
DEVNET_ENABLED=false
```

### Run the Project

```bash
npm run db:migrate
npm run dev
```

The API runs at `http://localhost:3000` by default.

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Check server health |
| POST | `/api/orders/execute` | Submit a swap order |
| GET | `/api/orders/:orderId` | Retrieve order status |
| WebSocket | `/api/orders/:orderId/ws` | Receive real-time updates |

## Testing

Run the test suite:

```bash
npm test
```

## Future Improvements

- Support additional DEX providers
- Improve swap routing and quote comparison
- Add execution performance analytics
- Enhance transaction monitoring and error handling
- Expand automated testing

## Security

Never commit private keys, database credentials, or `.env` files to GitHub. Verify devnet functionality before attempting on-chain transactions.

**Note:** Real swap execution depends on the completeness of the DEX integrations and transaction configuration. Mock execution does not guarantee successful on-chain swaps.

## License

MIT License.
