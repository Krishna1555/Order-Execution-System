# BullMQ <> Redis Architecture & End-to-End Control Flow

This document describes the complete architecture and control flow of the Order Execution Engine, focusing on the BullMQ queue system and Redis integration.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Redis Connection & Setup](#redis-connection--setup)
3. [BullMQ Components](#bullmq-components)
4. [End-to-End Control Flow](#end-to-end-control-flow)
5. [Job Lifecycle](#job-lifecycle)
6. [Queue Configuration](#queue-configuration)
7. [Error Handling & Retries](#error-handling--retries)
8. [Status Updates & WebSocket Integration](#status-updates--websocket-integration)
9. [Monitoring & Health Checks](#monitoring--health-checks)

---

## Architecture Overview

The Order Execution Engine uses **BullMQ** (a Redis-based queue system) to process orders asynchronously. This architecture provides:

- **Asynchronous Processing**: Orders are queued immediately and processed by workers
- **Scalability**: Multiple workers can process jobs concurrently
- **Reliability**: Redis persistence ensures jobs survive server restarts
- **Retry Mechanism**: Failed jobs are automatically retried with exponential backoff
- **Rate Limiting**: Built-in rate limiting prevents overwhelming DEX APIs

### System Components

```
┌─────────────────┐
│   HTTP Client   │
└────────┬────────┘
         │ POST /api/orders/execute
         ▼
┌─────────────────────────────────────────────┐
│         Fastify HTTP Server                 │
│  ┌──────────────────────────────────────┐  │
│  │     routes/orders.ts                 │  │
│  │  - Validates request                 │  │
│  │  - Creates order in PostgreSQL       │  │
│  │  - Adds job to BullMQ queue          │  │
│  └────────────┬─────────────────────────┘  │
└───────────────┼─────────────────────────────┘
                │
                │ queue.add('execute-order', jobData)
                ▼
┌─────────────────────────────────────────────┐
│              Redis (Memurai)                │
│  ┌──────────────────────────────────────┐  │
│  │      BullMQ Queue: order-execution   │  │
│  │  - waiting: [Job1, Job2, ...]        │  │
│  │  - active: [Job3, Job4, ...]         │  │
│  │  - completed: [Job5, ...]            │  │
│  │  - failed: [Job6, ...]               │  │
│  └────────────┬─────────────────────────┘  │
└───────────────┼─────────────────────────────┘
                │
                │ Worker picks up job
                ▼
┌─────────────────────────────────────────────┐
│         BullMQ Worker (config/queue.ts)     │
│  ┌──────────────────────────────────────┐  │
│  │  - Concurrency: 10 (configurable)    │  │
│  │  - Rate Limit: 100 jobs/min          │  │
│  │  - Processes jobs concurrently       │  │
│  └────────────┬─────────────────────────┘  │
└───────────────┼─────────────────────────────┘
                │
                │ processOrder(job)
                ▼
┌─────────────────────────────────────────────┐
│      Order Processor (processors/)          │
│  ┌──────────────────────────────────────┐  │
│  │  1. Parse user wallet                │  │
│  │  2. Update status: ROUTING           │  │
│  │  3. Get best quote (DEX Router)      │  │
│  │  4. Update status: BUILDING          │  │
│  │  5. Update status: SUBMITTED         │  │
│  │  6. Execute swap (DEX Provider)      │  │
│  │  7. Update status: CONFIRMED         │  │
│  │  8. Broadcast WebSocket update       │  │
│  └────────────┬─────────────────────────┘  │
└───────────────┼─────────────────────────────┘
                │
                │ Updates PostgreSQL & WebSocket
                ▼
┌─────────────────────────────────────────────┐
│         PostgreSQL Database                 │
│  ┌──────────────────────────────────────┐  │
│  │      orders table                    │  │
│  │  - Status updates                    │  │
│  │  - Transaction hashes                │  │
│  │  - Execution details                 │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

---

## Redis Connection & Setup

### Redis Client (ioredis)

The system uses **ioredis** as the Redis client library, configured for use with **Memurai** (Windows Redis alternative) or standard Redis.

**Location**: `src/queue/order.queue.ts`

```typescript
export function getRedis(): Redis {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    redis.on('error', (error) => {
      logger.error('Redis connection error', { error });
    });

    redis.on('connect', () => {
      logger.info('Redis connected');
    });
  }
  return redis;
}
```

**Configuration**:
- **Connection String**: `REDIS_URL` environment variable (default: `redis://localhost:6379`)
- **Options**:
  - `maxRetriesPerRequest: null` - Allows unlimited retries for BullMQ operations
  - `enableReadyCheck: false` - Disables ready check for faster initialization

**Events**:
- `connect` - Logged when Redis connection is established
- `error` - Logged when Redis connection errors occur

### Redis Data Structures

BullMQ uses Redis to store queue data in the following structures:

1. **waiting** - Jobs waiting to be processed (FIFO list) - `bull:order-execution:waiting`
2. **active** - Jobs currently being processed (set) - `bull:order-execution:active`
3. **completed** - Successfully completed jobs (sorted set) - `bull:order-execution:completed`
4. **failed** - Failed jobs (sorted set) - `bull:order-execution:failed`
5. **delayed** - Jobs scheduled for future execution (sorted set) - `bull:order-execution:delayed`
6. **meta** - Queue metadata (hash) - `bull:order-execution:meta`
7. **job data** - Individual job data (hash) - `bull:order-execution:<jobId>`

**Redis Keys Pattern**: `bull:order-execution:*`

### Redis Operations Overview

| Operation | Redis Command | Purpose |
|-----------|---------------|---------|
| Add job | `LPUSH bull:order-execution:waiting <jobId>`<br>`HSET bull:order-execution:<jobId> { data }` | Enqueue new job |
| Pick up job | `BLPOP bull:order-execution:waiting`<br>`SADD bull:order-execution:active <jobId>` | Worker gets next job |
| Complete job | `SREM bull:order-execution:active <jobId>`<br>`ZSADD bull:order-execution:completed <timestamp> <jobId>` | Mark job as completed |
| Fail job | `SREM bull:order-execution:active <jobId>`<br>`ZSADD bull:order-execution:failed <timestamp> <jobId>` | Mark job as failed |
| Delay job (retry) | `ZADD bull:order-execution:delayed <futureTimestamp> <jobId>` | Schedule retry |
| Get queue stats | `LLEN`, `SCARD`, `ZCARD` operations | Monitor queue health |

---

## BullMQ Components

### 1. Queue

**Location**: `src/queue/order.queue.ts`

The **Queue** is responsible for adding jobs to Redis. It's used by the HTTP API to enqueue orders.

```typescript
export function getOrderQueue(): Queue {
  if (!orderQueue) {
    const queueOptions: QueueOptions = {
      connection: redisUrl,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000, // Initial delay: 2s
        },
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours
        },
      },
    };

    orderQueue = new Queue('order-execution', queueOptions);
  }
  return orderQueue;
}
```

**Queue Name**: `order-execution`

**Default Job Options**:
- **Retry Attempts**: 3 (with exponential backoff)
- **Job Cleanup**: 
  - Completed jobs: Kept for 1 hour or last 1000 jobs
  - Failed jobs: Kept for 24 hours

### 2. Worker

**Location**: `src/config/queue.ts`

The **Worker** processes jobs from the queue. It runs concurrently with the HTTP server.

```typescript
export function startWorker(): Worker {
  const workerOptions: WorkerOptions = {
    connection: redisUrl,
    concurrency: 10, // Process up to 10 jobs concurrently
    limiter: {
      max: 100, // Max 100 jobs per duration
      duration: 60000, // Duration: 1 minute
    },
  };

  worker = new Worker('order-execution', processOrder, workerOptions);

  worker.on('completed', (job) => {
    logger.info('Job completed', { jobId: job.id, orderId: job.data.orderId });
  });

  worker.on('failed', (job, error) => {
    logger.error('Job failed', { jobId: job?.id, orderId: job?.data?.orderId, error });
  });

  worker.on('error', (error) => {
    logger.error('Worker error', { error });
  });

  return worker;
}
```

**Configuration**:
- **Concurrency**: `QUEUE_CONCURRENCY` env var (default: 10 jobs concurrently)
- **Rate Limiting**: `QUEUE_RATE_LIMIT` env var (default: 100 jobs per minute)

**Worker Events**:
- `completed` - Job successfully processed
- `failed` - Job failed after all retry attempts
- `error` - Worker-level error (not job-specific)

### 3. Job Processor

**Location**: `src/processors/order.processor.ts`

The **processor function** (`processOrder`) is called by the worker for each job. It contains the business logic for order execution.

---

## End-to-End Control Flow

### 1. Order Creation (HTTP Request)

**Entry Point**: `POST /api/orders/execute`

**Location**: `src/routes/orders.ts`

```
Client Request
    │
    ├─> Validate request (wallet, tokens, amounts)
    ├─> Parse user wallet (walletPrivateKey or walletKeypair)
    ├─> Create order in PostgreSQL (status: PENDING)
    │   └─> OrderService.createOrder()
    │       └─> OrderModel.create()
    │           └─> PostgreSQL INSERT
    │
    ├─> Add job to BullMQ queue
    │   └─> Queue.add('execute-order', {
    │           orderId,
    │           tokenIn,
    │           tokenOut,
    │           amountIn,
    │           slippageTolerance,
    │           walletPrivateKey, // User wallet for execution
    │           walletKeypair,    // Alternative format
    │       })
    │       └─> Redis: bull:order-execution:waiting (list)
    │
    └─> Return HTTP 201 { orderId, status: 'pending' }
```

**Job Data Structure**:
```typescript
interface OrderJobData {
  orderId: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  slippageTolerance: number;
  walletPrivateKey?: string; // Base58-encoded private key
  walletKeypair?: number[];  // JSON array of 64 numbers
}
```

### 2. Job Queuing (BullMQ → Redis)

```
Queue.add('execute-order', jobData) called
    │
    ├─> Job created with unique ID (UUID)
    ├─> Job data serialized to JSON
    │   └─> JSON.stringify({
    │           orderId: string,
    │           tokenIn: string,
    │           tokenOut: string,
    │           amountIn: number,
    │           slippageTolerance: number,
    │           walletPrivateKey?: string,
    │           walletKeypair?: number[]
    │       })
    │
    ├─> Job stored in Redis hash
    │   └─> HSET bull:order-execution:<jobId> {
    │           data: JSON.stringify(jobData),
    │           name: 'execute-order',
    │           opts: JSON.stringify(defaultJobOptions),
    │           timestamp: Date.now(),
    │           attemptsMade: 0,
    │           ...
    │       }
    │
    ├─> Job added to waiting list (FIFO)
    │   └─> LPUSH bull:order-execution:waiting <jobId>
    │
    ├─> Queue metadata updated
    │   └─> HINCRBY bull:order-execution:meta waiting 1
    │
    └─> Job in 'waiting' state (ready for worker)
```

### 3. Job Processing (Worker → Processor)

```
Worker continuously polls Redis for jobs
    │
    ├─> Worker checks rate limiter
    │   └─> ZCARD bull:order-execution:rate-limit:<workerId>
    │   └─> If < 100 jobs/min → Proceed
    │
    ├─> Worker checks concurrency limit
    │   └─> SCARD bull:order-execution:active
    │   └─> If < 10 active jobs → Proceed
    │
    ├─> Worker fetches next job (blocking)
    │   └─> BLPOP bull:order-execution:waiting 1 (1 second timeout)
    │   └─> Returns: [queueName, jobId] or null
    │
    ├─> If jobId received:
    │   ├─> Load job data from Redis
    │   │   └─> HGETALL bull:order-execution:<jobId>
    │   │       └─> Deserialize JSON data
    │   │
    │   ├─> Move job to 'active' state
    │   │   ├─> SADD bull:order-execution:active <jobId>
    │   │   ├─> HSET bull:order-execution:<jobId> processedOn Date.now()
    │   │   └─> HINCRBY bull:order-execution:meta waiting -1
    │   │   └─> HINCRBY bull:order-execution:meta active 1
    │   │
    │   ├─> Update rate limiter
    │   │   └─> ZADD bull:order-execution:rate-limit:<workerId> Date.now() <timestamp>
    │   │
    │   ├─> Create Job instance from Redis data
    │   │   └─> new Job(queue, jobId, jobData)
    │   │
    │   ├─> Worker calls processOrder(job)
    │   │   └─> processors/order.processor.ts
    │   │
    │   └─> Job processing begins
    │
    └─> If timeout (no jobs available):
        └─> Worker continues polling (loop)
```

### 4. Order Processing Pipeline

**Location**: `src/processors/order.processor.ts`

```
processOrder(job)
    │
    ├─> [Step 1] Parse user wallet
    │   └─> parseUserWallet(walletPrivateKey, walletKeypair)
    │       └─> Returns Keypair for Solana transaction signing
    │
    ├─> [Step 2] Status: PENDING → ROUTING
    │   ├─> PostgreSQL UPDATE orders SET status = 'routing'
    │   └─> WebSocket broadcast: { type: 'status_update', status: 'routing' }
    │
    ├─> [Step 3] Get best quote from DEX Router
    │   └─> DexRouter.getBestQuote(tokenIn, tokenOut, amountIn)
    │       ├─> Fetch quotes from Raydium (concurrent)
    │       ├─> Fetch quotes from Meteora (concurrent)
    │       └─> Select DEX with best price (highest amountOut)
    │
    ├─> [Step 4] Calculate minimum amount out
    │   └─> minAmountOut = bestQuote.amountOut * (1 - slippageTolerance)
    │
    ├─> [Step 5] Status: ROUTING → BUILDING
    │   ├─> PostgreSQL UPDATE orders SET status = 'building', selected_dex = <dex>
    │   └─> WebSocket broadcast: { type: 'status_update', status: 'building', selectedDex: <dex> }
    │
    ├─> [Step 6] Status: BUILDING → SUBMITTED
    │   ├─> PostgreSQL UPDATE orders SET status = 'submitted'
    │   └─> WebSocket broadcast: { type: 'status_update', status: 'submitted' }
    │
    ├─> [Step 7] Execute swap on selected DEX
    │   └─> DexRouter.executeSwap(tokenIn, tokenOut, amountIn, minAmountOut, dex, userKeypair)
    │       ├─> Provider.executeSwap() called with user's wallet
    │       ├─> Swap transaction built and signed with user keypair
    │       ├─> Transaction submitted to Solana network
    │       └─> Returns: { txHash, executedPrice, amountOut, fee }
    │
    ├─> [Step 8] Generate Solana Explorer link
    │   └─> getSolanaExplorerLink(txHash, cluster)
    │       └─> Returns: https://explorer.solana.com/tx/{txHash}?cluster={cluster}
    │
    ├─> [Step 9] Status: SUBMITTED → CONFIRMED
    │   ├─> PostgreSQL UPDATE orders SET 
    │   │       status = 'confirmed',
    │   │       tx_hash = <txHash>,
    │   │       executed_price = <price>,
    │   │       amount_out = <amountOut>
    │   └─> WebSocket broadcast: {
    │           type: 'confirmation',
    │           status: 'confirmed',
    │           data: { txHash, executedPrice, selectedDex, explorerLink }
    │       }
    │
    └─> [Success] Job completed
        └─> Redis: Job moved to 'completed' state
```

### 5. Error Handling Flow

```
Error occurs in processOrder()
    │
    ├─> Error caught in try-catch block
    ├─> Error logged with orderId and error message
    │
    ├─> Status: CURRENT → FAILED
    │   ├─> PostgreSQL UPDATE orders SET status = 'failed', error = <message>
    │   └─> WebSocket broadcast: {
    │           type: 'error',
    │           status: 'failed',
    │           data: { error: <message> }
    │       }
    │
    ├─> Error re-thrown to trigger BullMQ retry
    │   └─> throw error
    │
    └─> BullMQ retry mechanism triggered
        │
        ├─> If attempts < maxAttempts (3):
        │   ├─> Calculate backoff delay: 2s * (2 ^ attemptNumber)
        │   ├─> Job moved to 'delayed' state
        │   ├─> Wait for backoff delay
        │   └─> Job moved back to 'waiting' state for retry
        │
        └─> If attempts >= maxAttempts (3):
            ├─> Job moved to 'failed' state
            ├─> Worker 'failed' event fired
            └─> Job kept in Redis for 24 hours (removeOnFail.age: 86400)
```

---

## Job Lifecycle

### Job States

A job moves through the following states in Redis:

```
┌─────────┐
│ waiting │  ← New jobs start here (LPUSH to list)
└────┬────┘
     │ Worker picks up job
     ▼
┌─────────┐
│ active  │  ← Currently processing (SADD to set)
└────┬────┘
     │
     ├─> Success
     │   ▼
     │ ┌──────────┐
     │ │completed │  ← Successful jobs (ZSADD to sorted set)
     │ └──────────┘
     │
     └─> Failure (after retries)
         ▼
     ┌────────┐
     │ failed │  ← Failed jobs (ZSADD to sorted set)
     └────────┘
     
     └─> Retry (exponential backoff)
         ▼
     ┌─────────┐
     │ delayed │  ← Jobs waiting for retry (ZSADD with score = timestamp)
     └─────────┘
```

### State Transitions

| From | To | Trigger | Redis Operations |
|------|-----|---------|------------------|
| - | `waiting` | `queue.add()` | 1. `HSET bull:order-execution:<jobId> { data, name, opts, ... }`<br>2. `LPUSH bull:order-execution:waiting <jobId>`<br>3. `HINCRBY bull:order-execution:meta waiting 1` |
| `waiting` | `active` | Worker picks up job | 1. `BLPOP bull:order-execution:waiting` (returns jobId)<br>2. `HGETALL bull:order-execution:<jobId>` (load job data)<br>3. `SADD bull:order-execution:active <jobId>`<br>4. `HSET bull:order-execution:<jobId> processedOn <timestamp>`<br>5. `HINCRBY bull:order-execution:meta waiting -1`<br>6. `HINCRBY bull:order-execution:meta active 1` |
| `active` | `completed` | `processOrder()` succeeds | 1. `SREM bull:order-execution:active <jobId>`<br>2. `ZSADD bull:order-execution:completed <timestamp> <jobId>`<br>3. `HSET bull:order-execution:<jobId> finishedOn <timestamp>`<br>4. `HINCRBY bull:order-execution:meta active -1`<br>5. `HINCRBY bull:order-execution:meta completed 1`<br>6. Schedule cleanup (if `removeOnComplete` conditions met) |
| `active` | `delayed` | `processOrder()` fails (retry) | 1. `HINCRBY bull:order-execution:<jobId> attemptsMade 1`<br>2. Calculate delay: `delay = 2000 * (2 ^ attemptsMade)`<br>3. `futureTimestamp = Date.now() + delay`<br>4. `SREM bull:order-execution:active <jobId>`<br>5. `ZSADD bull:order-execution:delayed <futureTimestamp> <jobId>`<br>6. `HINCRBY bull:order-execution:meta active -1`<br>7. `HINCRBY bull:order-execution:meta delayed 1` |
| `delayed` | `waiting` | Retry delay expires | 1. Worker checks delayed jobs: `ZRANGEBYSCORE bull:order-execution:delayed 0 <currentTimestamp>`<br>2. For each expired job:<br>   - `ZREM bull:order-execution:delayed <jobId>`<br>   - `LPUSH bull:order-execution:waiting <jobId>`<br>   - `HINCRBY bull:order-execution:meta delayed -1`<br>   - `HINCRBY bull:order-execution:meta waiting 1` |
| `active` | `failed` | `processOrder()` fails (max retries) | 1. `SREM bull:order-execution:active <jobId>`<br>2. `ZSADD bull:order-execution:failed <timestamp> <jobId>`<br>3. `HSET bull:order-execution:<jobId> finishedOn <timestamp>, failedReason <error>`<br>4. `HINCRBY bull:order-execution:meta active -1`<br>5. `HINCRBY bull:order-execution:meta failed 1`<br>6. Schedule cleanup (if `removeOnFail.age` condition met) |

---

## Queue Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string (use Memurai on Windows) |
| `QUEUE_CONCURRENCY` | `10` | Maximum concurrent jobs processed by worker |
| `QUEUE_RATE_LIMIT` | `100` | Maximum jobs processed per minute (rate limiting) |

### Configuration Files

**Location**: `src/queue/retry.config.ts`

```typescript
export const retryConfig = {
  attempts: 3,                    // Retry up to 3 times
  backoff: {
    type: 'exponential',          // Exponential backoff
    delay: 2000,                  // Initial delay: 2 seconds
  },
};
```

**Backoff Calculation**:
- Attempt 1: `2s * (2^0) = 2s`
- Attempt 2: `2s * (2^1) = 4s`
- Attempt 3: `2s * (2^2) = 8s`

### Job Cleanup Policy

```typescript
defaultJobOptions: {
  removeOnComplete: {
    age: 3600,      // Keep completed jobs for 1 hour
    count: 1000,    // OR keep last 1000 completed jobs (whichever comes first)
  },
  removeOnFail: {
    age: 86400,     // Keep failed jobs for 24 hours
  },
}
```

**Cleanup Strategy**:
- **Completed jobs**: Automatically removed after 1 hour OR when count exceeds 1000
- **Failed jobs**: Automatically removed after 24 hours
- **Active/Waiting jobs**: Never auto-removed (must be manually cleaned)

---

## Error Handling & Retries

### Retry Mechanism

**Location**: `src/queue/retry.config.ts` + BullMQ default job options

**Retry Flow**:
```
Job fails
    │
    ├─> Error caught in processOrder()
    ├─> Error logged
    ├─> Status updated to FAILED in PostgreSQL
    ├─> WebSocket error broadcast sent
    ├─> Error re-thrown
    │
    ├─> BullMQ checks: attemptsMade < attempts (3)
    │   │
    │   ├─> YES: Retry with exponential backoff
    │   │   ├─> Calculate delay: 2s * (2 ^ attemptsMade)
    │   │   ├─> Job moved to 'delayed' state
    │   │   ├─> Wait for calculated delay
    │   │   ├─> Job moved to 'waiting' state
    │   │   └─> Worker picks up job again
    │   │
    │   └─> NO: Job marked as permanently failed
    │       ├─> Job moved to 'failed' state
    │       ├─> Worker 'failed' event fired
    │       └─> Job kept in Redis for 24 hours
    │
    └─> Order remains in FAILED state in PostgreSQL
```

### Error Types & Handling

| Error Type | Retry? | Max Attempts | Behavior |
|------------|--------|--------------|----------|
| Network error (RPC) | Yes | 3 | Retry with exponential backoff |
| DEX API error | Yes | 3 | Retry with exponential backoff |
| Validation error | No | 1 | Fail immediately (non-retryable) |
| Wallet parse error | No | 1 | Fail immediately (non-retryable) |
| Insufficient funds | No | 1 | Fail immediately (non-retryable) |
| Slippage exceeded | No | 1 | Fail immediately (non-retryable) |
| Transaction timeout | Yes | 3 | Retry with exponential backoff |

**Non-retryable errors** should be caught early and thrown with appropriate error types to prevent unnecessary retries.

### Retry Backoff Example

For a job that fails 3 times:

```
Attempt 1: Immediate
  └─> Fails after 5s
  └─> Wait 2s (2^0 * 2s)

Attempt 2: After 2s delay
  └─> Fails after 5s
  └─> Wait 4s (2^1 * 2s)

Attempt 3: After 4s delay
  └─> Fails after 5s
  └─> Wait 8s (2^2 * 2s)

Attempt 4: After 8s delay
  └─> Fails after 5s
  └─> Max attempts reached → Job permanently failed

Total time: ~24s (5s * 4 attempts + 2s + 4s + 8s delays)
```

---

## Status Updates & WebSocket Integration

### Status Flow

Order status transitions are synchronized between:
1. **PostgreSQL** (persistent storage)
2. **WebSocket** (real-time client updates)

```
PENDING (initial)
    │
    ├─> ROUTING (quote fetching)
    │
    ├─> BUILDING (transaction building)
    │
    ├─> SUBMITTED (transaction submitted)
    │
    ├─> CONFIRMED (transaction confirmed) ✅
    │
    └─> FAILED (error occurred) ❌
```

### WebSocket Integration

**Location**: `src/services/websocket.service.ts` + `src/services/status.service.ts`

**Flow**:
```
processOrder() status update
    │
    ├─> orderService.updateOrderStatus(orderId, status, updates)
    │   └─> PostgreSQL UPDATE
    │
    ├─> statusService.broadcastStatusUpdate(orderId, status, data)
    │   └─> websocketService.sendStatusUpdate(orderId, message)
    │       └─> For each WebSocket connection for this orderId:
    │           └─> socket.send(JSON.stringify({
    │                   type: 'status_update' | 'confirmation' | 'error',
    │                   orderId,
    │                   status,
    │                   data: { ...updates, timestamp }
    │               }))
    │
    └─> Client receives real-time update
```

**WebSocket Message Types**:
- `status_update` - Intermediate status changes (ROUTING, BUILDING, SUBMITTED)
- `confirmation` - Final success status (CONFIRMED) with transaction details
- `error` - Final failure status (FAILED) with error message

**Example Messages**:
```json
// Status Update
{
  "type": "status_update",
  "orderId": "uuid-here",
  "status": "routing",
  "data": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}

// Confirmation
{
  "type": "confirmation",
  "orderId": "uuid-here",
  "status": "confirmed",
  "data": {
    "txHash": "transaction-hash-here",
    "executedPrice": 0.985,
    "selectedDex": "raydium",
    "explorerLink": "https://explorer.solana.com/tx/...?cluster=devnet",
    "timestamp": "2024-01-01T00:00:01.000Z"
  }
}

// Error
{
  "type": "error",
  "orderId": "uuid-here",
  "status": "failed",
  "data": {
    "error": "Slippage tolerance exceeded",
    "timestamp": "2024-01-01T00:00:00.500Z"
  }
}
```

---

## Monitoring & Health Checks

### Queue Health Endpoint

**Location**: `src/routes/health.ts`

**Endpoint**: `GET /health/queue`

**Response**:
```json
{
  "status": "healthy",
  "queue": "order-execution",
  "waiting": 5,
  "active": 2,
  "completed": 150,
  "failed": 3,
  "delayed": 1
}
```

**Redis Operations**:
- `LLEN bull:order-execution:waiting` - Count waiting jobs
- `SCARD bull:order-execution:active` - Count active jobs
- `ZCARD bull:order-execution:completed` - Count completed jobs
- `ZCARD bull:order-execution:failed` - Count failed jobs
- `ZCARD bull:order-execution:delayed` - Count delayed jobs

### Worker Events

**Location**: `src/config/queue.ts`

**Events Logged**:
- `worker.on('completed')` - Job successfully processed
- `worker.on('failed')` - Job failed after all retries
- `worker.on('error')` - Worker-level error (connection issues, etc.)

**Monitoring Points**:
- Job completion rate
- Job failure rate
- Average processing time
- Queue depth (waiting jobs)
- Active workers count

### Redis Connection Monitoring

**Location**: `src/queue/order.queue.ts`

**Events**:
- `redis.on('connect')` - Connection established
- `redis.on('error')` - Connection error

**Health Check**:
```typescript
const redis = getRedis();
await redis.ping(); // Returns 'PONG' if connected
```

---

## Performance Considerations

### Concurrency

- **Default**: 10 concurrent jobs
- **Configuration**: `QUEUE_CONCURRENCY` environment variable
- **Impact**: 
  - Higher concurrency = faster processing but more resource usage
  - Each concurrent job consumes memory and network connections (PostgreSQL, Redis, Solana RPC)
  - Recommended: 5-20 for most use cases

### Rate Limiting

- **Default**: 100 jobs per minute
- **Configuration**: `QUEUE_RATE_LIMIT` environment variable
- **Purpose**: 
  - Prevent overwhelming DEX APIs (Raydium, Meteora)
  - Prevent rate limiting on Solana RPC endpoints
  - Protect against accidental spam
- **Implementation**: 
  - Uses Redis sorted set: `bull:order-execution:rate-limit:<workerId>`
  - Timestamps stored with job processing time
  - Counts jobs processed in last 60 seconds

### Redis Memory

- **Completed Jobs**: Auto-cleanup after 1 hour or 1000 jobs (whichever comes first)
- **Failed Jobs**: Auto-cleanup after 24 hours
- **Active/Waiting Jobs**: Never auto-removed (cleanup manually if needed)
- **Delayed Jobs**: Auto-processed when delay expires

**Memory Estimation**:
- Average job size: ~500-800 bytes (JSON serialized with wallet data)
- Job metadata (hash): ~1-2 KB per job
- 1000 completed jobs: ~1.5-2 MB
- 1000 waiting jobs: ~500 KB (list overhead)
- 100 active jobs: ~200 KB
- Total (with overhead): ~3-5 MB per 1000 jobs

**Redis Memory Management**:
- Use `redis-cli INFO memory` to monitor memory usage
- Monitor queue depth: `/health/queue` endpoint
- Adjust `removeOnComplete` and `removeOnFail` settings as needed

### Scalability

**Horizontal Scaling**:
- Multiple workers can process from the same queue
- Each worker connects to the same Redis instance
- BullMQ handles job distribution automatically (no job conflicts)
- Workers compete for jobs using `BLPOP` (blocking pop from left)

**Worker Deployment Architecture**:
```
┌─────────────────────────────────────────┐
│         HTTP Server Instance            │
│  ┌───────────────────────────────────┐  │
│  │  Fastify Server                   │  │
│  │  - Handles API requests           │  │
│  │  - Adds jobs to queue             │  │
│  └─────────────┬─────────────────────┘  │
└────────────────┼─────────────────────────┘
                 │
                 │ queue.add('execute-order', jobData)
                 │
┌────────────────┼─────────────────────────────────────────┐
│                │          Shared Redis                    │
│                │  ┌───────────────────────────────────┐  │
│                │  │  bull:order-execution:waiting     │  │
│                │  │  [Job1, Job2, Job3, ...]          │  │
│                │  └───────────────────────────────────┘  │
│                │                                         │
└────────────────┼─────────────────────────────────────────┘
                 │
                 │ Workers compete for jobs (BLPOP)
                 │
┌────────────────┼────────────────┐
│                │                │
▼                ▼                ▼
┌────────────┐ ┌────────────┐ ┌────────────┐
│  Worker 1  │ │  Worker 2  │ │  Worker 3  │
│  (W1)      │ │  (W2)      │ │  (W3)      │
│            │ │            │ │            │
│ Concurrency:│ │ Concurrency:│ │ Concurrency:│
│  10 jobs   │ │  10 jobs   │ │  10 jobs   │
│            │ │            │ │            │
│ Total: 30  │ │            │ │            │
│ concurrent │ │            │ │            │
│ jobs       │ │            │ │            │
└────────────┘ └────────────┘ └────────────┘
```

**Scaling Strategy**:
1. **Vertical Scaling**: Increase `QUEUE_CONCURRENCY` (more concurrent jobs per worker)
2. **Horizontal Scaling**: Deploy multiple worker instances (more workers)
3. **Redis Scaling**: Use Redis Cluster for high availability (production)

**Best Practices**:
- Deploy workers separately from HTTP server for better resource isolation
- Use process managers (PM2, systemd) for worker lifecycle management
- Monitor worker health and restart on crashes
- Scale workers based on queue depth and processing time

---

## Troubleshooting

### Common Issues

**1. Jobs stuck in 'waiting' state**
- **Cause**: No worker running
- **Solution**: Ensure `startWorker()` is called in `server.ts`

**2. Jobs stuck in 'active' state**
- **Cause**: Worker crashed while processing job
- **Solution**: Jobs will eventually timeout and be retried (BullMQ handles this)

**3. Redis connection errors**
- **Cause**: Redis/Memurai not running or wrong connection string
- **Solution**: 
  - Check `REDIS_URL` environment variable
  - Verify Redis/Memurai is running: `redis-cli ping` (should return 'PONG')

**4. High memory usage**
- **Cause**: Too many jobs in Redis (not cleaned up)
- **Solution**: 
  - Adjust `removeOnComplete` and `removeOnFail` settings
  - Manually clean old jobs: `redis-cli DEL bull:order-execution:completed`

**5. Jobs failing immediately**
- **Cause**: Non-retryable error (validation, wallet parse, etc.)
- **Solution**: Check order request format and wallet credentials

---

## Best Practices

1. **Always validate before queuing**: Validate order requests before adding to queue to avoid unnecessary retries

2. **Handle non-retryable errors early**: Fail fast for validation/parse errors to avoid retry overhead

3. **Monitor queue depth**: Use `/health/queue` endpoint to monitor queue depth and adjust worker concurrency

4. **Set appropriate rate limits**: Balance between throughput and API rate limits (DEX APIs, Solana RPC)

5. **Clean up old jobs**: Monitor Redis memory and adjust cleanup policies as needed

6. **Log comprehensively**: Include `orderId` and `jobId` in all logs for traceability

7. **WebSocket connection management**: Clients should reconnect if WebSocket connection drops

8. **Graceful shutdown**: Ensure workers finish processing current jobs before shutdown

---

## Complete Control Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    END-TO-END CONTROL FLOW                              │
└─────────────────────────────────────────────────────────────────────────┘

[1] HTTP Request
    │
    POST /api/orders/execute
    {
      tokenIn: "SOL",
      tokenOut: "USDC",
      amountIn: 100,
      walletPrivateKey: "base58-key"
    }
    │
    ▼
[2] Route Handler (routes/orders.ts)
    │
    ├─> Validate request (wallet, tokens, amounts)
    ├─> Parse user wallet → Keypair
    ├─> Create order in PostgreSQL (status: PENDING)
    │   └─> INSERT INTO orders (...) VALUES (...)
    │
    ├─> Add job to BullMQ queue
    │   └─> Queue.add('execute-order', {
    │           orderId, tokenIn, tokenOut, amountIn,
    │           slippageTolerance, walletPrivateKey
    │       })
    │       │
    │       ▼
    │   Redis Operations:
    │   ├─> HSET bull:order-execution:<jobId> { data: {...} }
    │   ├─> LPUSH bull:order-execution:waiting <jobId>
    │   └─> HINCRBY bull:order-execution:meta waiting 1
    │
    └─> Return HTTP 201 { orderId, status: 'pending' }
        │
        ▼
[3] WebSocket Connection (Optional)
    │
    GET /api/orders/:orderId/ws
    │
    ├─> websocketService.addConnection(orderId, socket)
    ├─> Connection stored in memory Map<orderId, socket>
    └─> Send initial status: { type: 'status_update', status: 'pending' }
        │
        ▼
[4] Worker Polls Redis (config/queue.ts)
    │
    Worker continuously running:
    │
    ├─> Check rate limiter (< 100 jobs/min)
    ├─> Check concurrency (< 10 active jobs)
    │
    ├─> BLPOP bull:order-execution:waiting 1
    │   └─> Blocks for up to 1 second, returns [queueName, jobId] or null
    │
    ├─> If jobId received:
    │   ├─> HGETALL bull:order-execution:<jobId> (load job data)
    │   ├─> Deserialize JSON: { orderId, tokenIn, ..., walletPrivateKey }
    │   │
    │   ├─> Move to 'active' state
    │   │   ├─> SADD bull:order-execution:active <jobId>
    │   │   ├─> HSET bull:order-execution:<jobId> processedOn <timestamp>
    │   │   └─> Update meta counters
    │   │
    │   └─> Call processOrder(job)
    │       │
    │       ▼
    └─> If timeout (no jobs):
        └─> Continue polling (loop)
        │
        ▼
[5] Order Processing (processors/order.processor.ts)
    │
    processOrder(job: Job<OrderJobData>)
    │
    ├─> [Step 1] Parse user wallet
    │   └─> parseUserWallet(walletPrivateKey, walletKeypair)
    │       └─> Returns: Keypair { publicKey, secretKey }
    │
    ├─> [Step 2] Status: PENDING → ROUTING
    │   ├─> PostgreSQL: UPDATE orders SET status = 'routing' WHERE order_id = ...
    │   ├─> Redis: Status update persisted
    │   └─> WebSocket: Broadcast { type: 'status_update', status: 'routing' }
    │
    ├─> [Step 3] Get best quote from DEX Router
    │   └─> DexRouter.getBestQuote('SOL', 'USDC', 100)
    │       ├─> Concurrent: Raydium.getQuote(...) [async]
    │       ├─> Concurrent: Meteora.getQuote(...) [async]
    │       └─> Select best: { dex: 'raydium', amountOut: 98.5, price: 0.985, fee: 0.003 }
    │
    ├─> [Step 4] Calculate minimum amount out
    │   └─> minAmountOut = bestQuote.amountOut * (1 - slippageTolerance)
    │       └─> minAmountOut = 98.5 * (1 - 0.01) = 97.515
    │
    ├─> [Step 5] Status: ROUTING → BUILDING
    │   ├─> PostgreSQL: UPDATE orders SET status = 'building', selected_dex = 'raydium'
    │   └─> WebSocket: Broadcast { type: 'status_update', status: 'building', selectedDex: 'raydium' }
    │
    ├─> [Step 6] Status: BUILDING → SUBMITTED
    │   ├─> PostgreSQL: UPDATE orders SET status = 'submitted'
    │   └─> WebSocket: Broadcast { type: 'status_update', status: 'submitted' }
    │
    ├─> [Step 7] Execute swap on selected DEX
    │   └─> DexRouter.executeSwap('SOL', 'USDC', 100, 97.515, 'raydium', userKeypair)
    │       ├─> Provider: RaydiumProvider.executeSwap(...)
    │       ├─> Build swap transaction using user's keypair
    │       ├─> Sign transaction with user's private key
    │       ├─> Submit transaction to Solana network
    │       └─> Returns: { txHash: 'abc123...', executedPrice: 0.985, amountOut: 98.5, fee: 0.3 }
    │
    ├─> [Step 8] Generate Solana Explorer link
    │   └─> getSolanaExplorerLink(txHash, 'devnet')
    │       └─> Returns: 'https://explorer.solana.com/tx/abc123...?cluster=devnet'
    │
    ├─> [Step 9] Status: SUBMITTED → CONFIRMED
    │   ├─> PostgreSQL: UPDATE orders SET
    │   │       status = 'confirmed',
    │   │       tx_hash = 'abc123...',
    │   │       executed_price = 0.985,
    │   │       amount_out = 98.5
    │   │   WHERE order_id = ...
    │   │
    │   └─> WebSocket: Broadcast {
    │           type: 'confirmation',
    │           status: 'confirmed',
    │           data: {
    │               txHash: 'abc123...',
    │               executedPrice: 0.985,
    │               selectedDex: 'raydium',
    │               explorerLink: 'https://explorer.solana.com/tx/abc123...?cluster=devnet',
    │               timestamp: '2024-01-01T00:00:01.000Z'
    │           }
    │       }
    │
    └─> [Success] Job completed
        │
        ▼
        Redis Operations:
        ├─> SREM bull:order-execution:active <jobId>
        ├─> ZSADD bull:order-execution:completed <timestamp> <jobId>
        ├─> HSET bull:order-execution:<jobId> finishedOn <timestamp>
        └─> Update meta counters (active -1, completed +1)
        │
        ▼
        Worker Events:
        ├─> worker.emit('completed', job)
        └─> Logger: 'Job completed', { jobId, orderId }
        │
        ▼
        Cleanup (if needed):
        └─> If completed jobs > 1000 OR age > 3600s:
            └─> HDEL bull:order-execution:<jobId> (remove job data)

[Error Flow] (if any step fails)
    │
    ├─> Error caught in processOrder() try-catch
    ├─> Error logged: { orderId, error: error.message }
    │
    ├─> PostgreSQL: UPDATE orders SET status = 'failed', error = <message>
    ├─> WebSocket: Broadcast { type: 'error', status: 'failed', data: { error } }
    │
    ├─> Error re-thrown: throw error
    │
    ├─> BullMQ checks: attemptsMade < attempts (3)
    │   │
    │   ├─> YES: Retry with exponential backoff
    │   │   ├─> Calculate delay: 2s * (2 ^ attemptsMade)
    │   │   ├─> futureTimestamp = Date.now() + delay
    │   │   ├─> SREM bull:order-execution:active <jobId>
    │   │   ├─> ZSADD bull:order-execution:delayed <futureTimestamp> <jobId>
    │   │   ├─> HINCRBY bull:order-execution:<jobId> attemptsMade 1
    │   │   ├─> Wait for calculated delay
    │   │   ├─> ZREM bull:order-execution:delayed <jobId>
    │   │   └─> LPUSH bull:order-execution:waiting <jobId> (retry)
    │   │
    │   └─> NO: Job permanently failed
    │       ├─> SREM bull:order-execution:active <jobId>
    │       ├─> ZSADD bull:order-execution:failed <timestamp> <jobId>
    │       ├─> HSET bull:order-execution:<jobId> finishedOn <timestamp>, failedReason <error>
    │       ├─> worker.emit('failed', job, error)
    │       └─> Logger: 'Job failed', { jobId, orderId, error, attemptsMade: 3 }
    │
    └─> Order remains in FAILED state in PostgreSQL
```

---

## Redis Key Patterns

### Queue Keys

| Key Pattern | Type | Purpose | Example |
|-------------|------|---------|---------|
| `bull:order-execution:waiting` | List | Jobs waiting to be processed | `LPUSH bull:order-execution:waiting job-1` |
| `bull:order-execution:active` | Set | Jobs currently being processed | `SADD bull:order-execution:active job-1` |
| `bull:order-execution:completed` | Sorted Set | Successfully completed jobs | `ZSADD bull:order-execution:completed <timestamp> job-1` |
| `bull:order-execution:failed` | Sorted Set | Failed jobs | `ZSADD bull:order-execution:failed <timestamp> job-1` |
| `bull:order-execution:delayed` | Sorted Set | Jobs scheduled for retry | `ZSADD bull:order-execution:delayed <futureTimestamp> job-1` |
| `bull:order-execution:meta` | Hash | Queue metadata (counts) | `HGETALL bull:order-execution:meta` |
| `bull:order-execution:<jobId>` | Hash | Individual job data | `HGETALL bull:order-execution:job-123` |
| `bull:order-execution:rate-limit:<workerId>` | Sorted Set | Rate limiter per worker | `ZRANGE bull:order-execution:rate-limit:worker-1 0 -1` |

### Job Data Structure

```typescript
// Redis Hash: bull:order-execution:<jobId>
{
  id: "job-123-uuid",
  name: "execute-order",
  data: JSON.stringify({
    orderId: "order-uuid",
    tokenIn: "SOL",
    tokenOut: "USDC",
    amountIn: 100,
    slippageTolerance: 0.01,
    walletPrivateKey: "base58-encoded-key",
    walletKeypair: null
  }),
  opts: JSON.stringify({
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400 }
  }),
  timestamp: 1704067200000,
  attemptsMade: 0,
  processedOn: 1704067201000,  // Set when worker picks up job
  finishedOn: 1704067205000,   // Set when job completes/fails
  failedReason: null,          // Set if job fails
  ...
}
```

---

## Server Startup & Worker Initialization

### Server Startup Sequence

**Location**: `src/server.ts`

```
Server Startup
    │
    ├─> [Step 1] Initialize Database
    │   └─> initializeDatabase()
    │       ├─> Test PostgreSQL connection (pool.query('SELECT 1'))
    │       └─> Test Redis connection (redis.ping())
    │
    ├─> [Step 2] Start Queue Worker
    │   └─> startWorker()
    │       ├─> Create Worker instance
    │       ├─> Connect to Redis
    │       ├─> Configure concurrency (10 jobs)
    │       ├─> Configure rate limiter (100 jobs/min)
    │       ├─> Register event handlers:
    │       │   ├─> worker.on('completed')
    │       │   ├─> worker.on('failed')
    │       │   └─> worker.on('error')
    │       └─> Worker starts polling Redis for jobs
    │
    ├─> [Step 3] Register Routes
    │   ├─> ordersRoutes (POST /api/orders/execute, GET /api/orders/:orderId, WebSocket)
    │   └─> healthRoutes (GET /health, /health/db, /health/redis, /health/queue)
    │
    ├─> [Step 4] Start HTTP Server
    │   └─> fastify.listen({ port: 3000, host: '0.0.0.0' })
    │
    └─> Server ready to accept requests
```

### Worker Initialization Details

**Location**: `src/config/queue.ts`

```typescript
export function startWorker(): Worker {
  const concurrency = parseInt(process.env.QUEUE_CONCURRENCY || '10', 10);
  const rateLimit = parseInt(process.env.QUEUE_RATE_LIMIT || '100', 10);
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  const workerOptions: WorkerOptions = {
    connection: redisUrl,
    concurrency,              // Process up to 10 jobs concurrently
    limiter: {
      max: rateLimit,         // Max 100 jobs per duration
      duration: 60000,        // Duration: 1 minute
    },
  };

  worker = new Worker('order-execution', processOrder, workerOptions);

  // Event Handlers
  worker.on('completed', (job) => {
    logger.info('Job completed', { jobId: job.id, orderId: job.data.orderId });
  });

  worker.on('failed', (job, error) => {
    logger.error('Job failed', {
      jobId: job?.id,
      orderId: job?.data?.orderId,
      error: error.message,
      attemptsMade: job?.attemptsMade,
    });
  });

  worker.on('error', (error) => {
    logger.error('Worker error', { error });
  });

  return worker;
}
```

**Worker Behavior**:
- **Continuous Polling**: Worker continuously polls Redis for jobs using `BLPOP` (blocking pop)
- **Concurrency Control**: Worker processes up to `concurrency` jobs simultaneously
- **Rate Limiting**: Worker respects rate limiter (max jobs per minute)
- **Event-Driven**: Worker emits events for job completion, failure, and errors

### Graceful Shutdown

**Location**: `src/server.ts`

```
Shutdown Signal (SIGTERM/SIGINT)
    │
    ├─> [Step 1] Close HTTP Server
    │   └─> fastify.close()
    │       └─> Stops accepting new connections
    │
    ├─> [Step 2] Stop Queue Worker
    │   └─> stopWorker()
    │       ├─> worker.close()
    │       ├─> Wait for active jobs to complete (up to timeout)
    │       └─> Close Redis connection
    │
    ├─> [Step 3] Close Database Connections
    │   └─> closeDatabase()
    │       ├─> closePool() - Close PostgreSQL connection pool
    │       └─> closeQueue() - Close Redis connection
    │
    └─> Process exits gracefully
```

**Worker Shutdown Behavior**:
- **Graceful**: Worker waits for active jobs to complete before shutting down
- **Timeout**: If jobs don't complete within timeout, worker force-closes
- **Redis Cleanup**: Active jobs are returned to 'waiting' state if worker crashes

---

## Redis Data Structures Details

### Queue States in Redis

**waiting** (List):
- Type: `LIST`
- Key: `bull:order-execution:waiting`
- Operation: `LPUSH` (add to left), `BLPOP` (pop from left)
- Order: FIFO (First In, First Out)
- Purpose: Jobs waiting to be processed

**active** (Set):
- Type: `SET`
- Key: `bull:order-execution:active`
- Operation: `SADD` (add), `SREM` (remove), `SMEMBERS` (list all)
- Purpose: Jobs currently being processed by workers
- Cleanup: Jobs removed when completed or failed

**completed** (Sorted Set):
- Type: `ZSET` (sorted set)
- Key: `bull:order-execution:completed`
- Score: Timestamp (Unix timestamp in milliseconds)
- Operation: `ZSADD` (add with score), `ZRANGE` (range query), `ZREM` (remove)
- Purpose: Successfully completed jobs
- Cleanup: Auto-removed after 1 hour or when count > 1000

**failed** (Sorted Set):
- Type: `ZSET` (sorted set)
- Key: `bull:order-execution:failed`
- Score: Timestamp (Unix timestamp in milliseconds)
- Operation: `ZSADD` (add with score), `ZRANGE` (range query), `ZREM` (remove)
- Purpose: Failed jobs (after all retries)
- Cleanup: Auto-removed after 24 hours

**delayed** (Sorted Set):
- Type: `ZSET` (sorted set)
- Key: `bull:order-execution:delayed`
- Score: Future timestamp (when job should be retried)
- Operation: `ZSADD` (add with future timestamp), `ZRANGEBYSCORE` (get expired jobs)
- Purpose: Jobs scheduled for retry (exponential backoff)
- Processing: Worker checks for expired jobs periodically

**meta** (Hash):
- Type: `HASH`
- Key: `bull:order-execution:meta`
- Fields: `waiting`, `active`, `completed`, `failed`, `delayed` (counts)
- Operation: `HGETALL` (get all), `HINCRBY` (increment counter)
- Purpose: Queue metadata (job counts per state)

### Job Hash Structure

Each job is stored as a Redis hash at `bull:order-execution:<jobId>`:

```
HSET bull:order-execution:job-123 {
  id: "job-123",
  name: "execute-order",
  data: "{\"orderId\":\"order-uuid\",\"tokenIn\":\"SOL\",...}",
  opts: "{\"attempts\":3,\"backoff\":{...},...}",
  timestamp: 1704067200000,
  attemptsMade: 0,
  processedOn: 1704067201000,    // Set when worker picks up job
  finishedOn: 1704067205000,     // Set when job completes/fails
  failedReason: null,            // Set if job fails
  returnvalue: null,             // Set if job succeeds
  ...
}
```

---

## References

- **BullMQ Documentation**: https://docs.bullmq.io/
- **Redis Documentation**: https://redis.io/docs/
- **ioredis Documentation**: https://github.com/redis/ioredis
- **Memurai (Windows Redis)**: https://www.memurai.com/
- **BullMQ Redis Operations**: https://docs.bullmq.io/guide/connections
- **Redis Data Types**: https://redis.io/docs/data-types/
- **BullMQ Job Lifecycle**: https://docs.bullmq.io/guide/jobs
- **BullMQ Rate Limiting**: https://docs.bullmq.io/guide/rate-limiting
- **BullMQ Retry Strategy**: https://docs.bullmq.io/guide/jobs/retrying-failing-jobs
