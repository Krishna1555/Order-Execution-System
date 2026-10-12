
# Eterna Order Execution Engine

A TypeScript-based order execution engine built for Solana DeFi. It processes market orders, compares swap prices across Raydium and Meteora, and provides real-time order status updates through WebSockets.

The project uses a queue system to handle multiple orders, retry failed operations, and track each order from submission to completion. It supports mock execution for development and testing, along with an optional Solana devnet mode.

## About the Project

The main idea behind this project is to build a system that can receive trading orders, process them in the background, and route swaps to a suitable decentralized exchange (DEX).

Instead of processing every order directly inside an API request, the engine uses BullMQ and Redis to manage the workload. This helps handle concurrent orders and keeps the API responsive while orders are being processed.

Each order moves through different stages, from being received and queued to routing, transaction building, submission, and confirmation or failure.

## Features

- **Market Order Execution:** Processes orders to swap one token for another.
- **DEX Routing:** Compares available quotes from Raydium and Meteora to select a suitable execution venue.
- **User Wallet Support:** Designed to execute transactions using the user's wallet.
- **Real-Time Updates:** Uses WebSockets to stream order status changes.
- **Order Queue:** Uses BullMQ and Redis for background processing and concurrent order handling.
- **Retry Mechanism:** Retries failed jobs with exponential backoff, up to three attempts.
- **Database Storage:** Stores order details and execution history in PostgreSQL.
- **Health Checks:** Provides endpoints to check the server, database, Redis, and queue.
- **Mock Execution:** Allows development and testing without connecting to the Solana network.
- **Devnet Support:** Includes an optional mode for testing against Solana devnet.

## How It Works

The basic flow of an order is:

1. The client submits an order through the API.
2. The order is validated and added to the queue.
3. A background worker picks up the order.
4. The DEX router compares available quotes.
5. The selected provider prepares the swap transaction.
6. The transaction is submitted for execution when supported by the configured provider.
7. The order status is updated and sent to the client through WebSockets.
8. The order details and execution result are stored in the database.

### Order Statuses

- `pending` – The order has been received and queued.
- `routing` – The engine is checking available DEX quotes.
- `building` – The transaction is being prepared.
- `submitted` – The transaction has been sent to the network.
- `confirmed` – The transaction has been confirmed successfully.
- `failed` – The order could not be completed.

## Architecture

The system is divided into separate components for API handling, order processing, queue management, DEX routing, and database operations.

```text
Client
  |
  v
Fastify API Server
  |
  v
Order Service
  |
  v
BullMQ + Redis Queue
  |
  v
Order Processor
  |
  v
DEX Router
  |
  +---- Raydium Provider
  |
  +---- Meteora Provider
  |
  v
Execution Result
  |
  +---- PostgreSQL
  |
  +---- WebSocket Updates
```

This structure separates incoming requests from background execution and makes the system easier to test and extend.

## Tech Stack

- **Node.js 18+** – Runtime environment.
- **TypeScript** – Application logic and type safety.
- **Fastify** – API server.
- **WebSockets** – Real-time order updates.
- **BullMQ** – Background job processing.
- **Redis / Memurai** – Queue storage and job coordination.
- **PostgreSQL** – Order history and persistent data.
- **Supabase** – Hosted PostgreSQL option.
- **Solana Web3.js** – Solana network interaction.
- **Raydium SDK and Meteora SDK** – DEX integration.
- **Jest** – Unit and integration testing.

## Project Structure

```text
eterna_oe_engine/
├── src/
│   ├── server.ts
│   ├── config/
│   │   ├── index.ts
│   │   ├── database.ts
│   │   ├── queue.ts
│   │   └── tokens.ts
│   ├── routes/
│   ├── services/
│   ├── processors/
│   ├── queue/
│   ├── dex/
│   │   ├── router.ts
│   │   ├── types.ts
│   │   ├── mock/
│   │   └── providers/
│   ├── utils/
│   ├── models/
│   ├── types/
│   └── tests/
├── migrations/
├── scripts/
├── docs/
├── package.json
├── requirements.txt
├── ENV_SETUP.md
├── DEPLOYMENT.md
└── README.md
```

The `src` directory contains the main application code. API routes handle requests, services manage order logic, processors execute queued jobs, and the DEX module handles routing and provider integrations.

The `migrations` directory contains database migrations, while `scripts` and `docs` contain supporting tools and documentation.

## Getting Started

### Prerequisites

Before running the project, install or configure:

- Node.js 18 or later.
- npm.
- Redis or Memurai on Windows.
- A PostgreSQL database, either locally or through Supabase.
- A Solana wallet funded with devnet SOL if testing real devnet transactions.

### 1. Clone the Repository

```bash
git clone <YOUR-REPOSITORY-URL>
cd <YOUR-REPOSITORY-NAME>
npm install
```

Replace the repository URL and folder name with your actual repository details.

### 2. Set Up Redis or Memurai

On Windows, Memurai can be used as a Redis-compatible service.

Install Memurai from:

https://www.memurai.com/

After installation, check that the service is running. The default Redis-compatible port is usually `6379`.

You can verify the service in PowerShell with:

```powershell
Get-Service -Name Memurai
```

If you use Redis directly, follow its installation instructions and ensure the server is running.

### 3. Set Up the Database

Create a PostgreSQL database or a Supabase project:

https://supabase.com/

Get the database connection string from your database settings. Use the connection format required by the application and enable SSL if your database provider requires it.

### 4. Configure Environment Variables

Create a file named `.env` in the project's root directory.

Add the required configuration, using your own database credentials:

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

Check `ENV_SETUP.md` for the complete list of environment variables and any additional configuration required by the current code.

**Security note:** Never commit your `.env` file, wallet private keys, database passwords, or other secrets to GitHub.

### 5. Run Database Migrations

```bash
npm run db:migrate
```

This prepares the database tables required by the application.

### 6. Start the Application

For development:

```bash
npm run dev
```

To build and start the production version:

```bash
npm run build
npm start
```

The API will normally run at `http://localhost:3000`, unless a different port is configured.

## API Endpoints

### Health Checks

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Overall service health |
| GET | `/health/db` | Database connectivity |
| GET | `/health/redis` | Redis connectivity |
| GET | `/health/queue` | Queue status |

### Order Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/orders/execute` | Submit a new order |
| GET | `/api/orders/:orderId` | Retrieve order status |
| WebSocket | `/api/orders/:orderId/ws` | Receive real-time status updates |

### Example Order Request

```json
{
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amountIn": 1,
  "slippageTolerance": 0.01,
  "orderType": "market"
}
```

The API's actual request schema may require additional wallet fields or use a different format. Check the validation code before sending a request.

### Example Response

```json
{
  "orderId": "your-order-id",
  "status": "pending",
  "message": "Order created and queued for execution"
}
```

The order ID can be used to retrieve the order status or establish a WebSocket connection.

## Real-Time Order Updates

After submitting an order, the client can connect to the order's WebSocket endpoint to receive status changes.

A basic example:

```javascript
const response = await fetch(
  "http://localhost:3000/api/orders/execute",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      tokenIn: "SOL",
      tokenOut: "USDC",
      amountIn: 1,
      orderType: "market"
    })
  }
);

const { orderId } = await response.json();

const ws = new WebSocket(
  `ws://localhost:3000/api/orders/${orderId}/ws`
);

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log("Order update:", update);
};
```

This example assumes the API accepts the request without additional fields. If wallet details are required, include them according to the API schema.

WebSocket messages can contain the order ID, current status, and update timestamp.

## Testing

The project includes tests for order processing, queue behavior, and other application components.

Run all tests:

```bash
npm test
```

Run unit tests:

```bash
npm run test:unit
```

Run integration tests:

```bash
npm run test:integration
```

Generate a coverage report:

```bash
npm run test:coverage
```

### Testing with Devnet

The project is designed to support mock providers by default and optional devnet configuration.

On Windows PowerShell, devnet mode can be enabled for a test run with:

```powershell
$env:DEVNET_ENABLED="true"
npm test
```

Check `ENV_SETUP.md` for the available devnet-specific test scripts.

**Important:** The repository documentation indicates that parts of the real DEX provider implementation may still be incomplete. Mock tests do not prove that real swaps work successfully. Verify the current implementation before attempting live devnet execution.

## Design Decisions

### Why Use a Queue?

A queue allows the API to accept orders without having to finish processing them immediately. Background workers can handle multiple jobs while rate limits and retry rules help manage failures.

### Why Compare DEX Quotes?

Different decentralized exchanges may offer different prices for the same swap. Comparing quotes helps the engine choose a suitable route based on the available data.

The final execution price can still differ because of slippage, changing liquidity, network conditions, and transaction fees.

### Mock Execution and Devnet

Mock execution makes it easier to test the order lifecycle without depending on a live network. Devnet mode provides a way to test supported Solana integrations using test funds.

Real execution depends on complete provider implementations, valid transactions, sufficient test SOL, and available liquidity.

### Security Considerations

The design supports user-owned wallets rather than a shared service wallet. However, accepting private keys through an API request or queue introduces security risks.

For any real deployment:

- Never send wallet private keys through an unencrypted connection.
- Avoid logging or persisting private keys.
- Do not expose secrets in API responses or error messages.
- Use secure transaction-signing practices and minimize private-key handling.
- Validate orders, token addresses, amounts, and slippage settings.
- Use authentication, rate limits, and appropriate access controls.

A claim that private keys are not stored should be verified against the actual application code and logging configuration.

## Future Improvements

Possible extensions include:

- Adding limit orders with price-based execution triggers.
- Supporting more DEX providers.
- Improving quote comparison and route selection.
- Adding more detailed execution metrics and monitoring.
- Completing and testing real swap execution.
- Improving wallet security and transaction-signing workflows.

## Documentation

Additional documentation may be available in:

- `ENV_SETUP.md` – Environment configuration.
- `DEPLOYMENT.md` – Deployment instructions.
- `docs/architecture.md` – System architecture.
- `docs/bullmq-redis-architecture.md` – Queue and Redis workflow.
- `docs/WEBSOCKET_TESTING.md` – WebSocket testing.
- `docs/api/postman-collection.json` – API testing collection.

