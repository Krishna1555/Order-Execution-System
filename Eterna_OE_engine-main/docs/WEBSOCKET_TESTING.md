# WebSocket Testing Guide

This guide explains how to test WebSocket connections for real-time order status updates.

## Overview

The Order Execution Engine provides WebSocket endpoints for real-time order status updates. After creating an order via HTTP API, you can connect to a WebSocket endpoint to receive live status updates as the order progresses through its lifecycle.

## WebSocket Endpoint

```
ws://localhost:3000/api/orders/:orderId/ws
```

Replace `:orderId` with the actual order ID returned from the `POST /api/orders/execute` endpoint.

## Order Status Lifecycle

Orders progress through the following statuses:

1. **pending** - Order received and queued
2. **routing** - Comparing DEX prices (Raydium vs Meteora)
3. **building** - Creating swap transaction
4. **submitted** - Transaction sent to network
5. **confirmed** - Transaction confirmed on blockchain ✅
6. **failed** - Order execution failed ❌

## Testing Methods

### Method 1: HTML Test Page (Easiest)

1. Open `scripts/test-websocket.html` in your web browser
2. Enter your wallet private key (base58 format)
3. Enter the amount (e.g., 0.1 SOL)
4. Click "Create Order & Connect"
5. Watch real-time status updates appear

**Features:**
- Visual status indicators
- Color-coded messages by status
- Transaction hash and explorer links
- Connection status indicator

### Method 2: Node.js Test Script

1. Install dependencies (if not already installed):
   ```bash
   npm install --save-dev ws @types/ws
   ```

2. Set your wallet private key:
   ```bash
   # Windows PowerShell
   $env:WALLET_PRIVATE_KEY="your-base58-private-key-here"
   
   # Linux/Mac
   export WALLET_PRIVATE_KEY="your-base58-private-key-here"
   ```

3. Run the test script:
   ```bash
   # Create new order and connect
   tsx scripts/test-websocket.ts
   
   # Or connect to existing order
   tsx scripts/test-websocket.ts <order-id>
   ```

**Features:**
- Command-line interface
- Detailed status updates
- Automatic order creation
- Support for existing orders

### Method 3: JavaScript/TypeScript Code

```typescript
import WebSocket from 'ws';

// 1. Create order via HTTP API
const response = await fetch('http://localhost:3000/api/orders/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tokenIn: 'SOL',
    tokenOut: 'USDC',
    amountIn: 0.1,
    slippageTolerance: 0.01,
    orderType: 'market',
    walletPrivateKey: 'your-base58-private-key'
  })
});

const { orderId } = await response.json();

// 2. Connect to WebSocket
const ws = new WebSocket(`ws://localhost:3000/api/orders/${orderId}/ws`);

ws.on('open', () => {
  console.log('✅ WebSocket connected');
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('Status update:', message);
  
  // Handle different message types
  switch (message.type) {
    case 'status_update':
      console.log(`Status: ${message.status}`);
      break;
    case 'confirmation':
      console.log(`✅ Order confirmed! TX: ${message.data.txHash}`);
      break;
    case 'error':
      console.error(`❌ Error: ${message.data.error}`);
      break;
  }
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

ws.on('close', () => {
  console.log('WebSocket disconnected');
});
```

### Method 4: Browser Console

Open browser developer console and run:

```javascript
// 1. Create order
const response = await fetch('http://localhost:3000/api/orders/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tokenIn: 'SOL',
    tokenOut: 'USDC',
    amountIn: 0.1,
    slippageTolerance: 0.01,
    orderType: 'market',
    walletPrivateKey: 'your-base58-private-key'
  })
});

const { orderId } = await response.json();
console.log('Order ID:', orderId);

// 2. Connect WebSocket
const ws = new WebSocket(`ws://localhost:3000/api/orders/${orderId}/ws`);

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('📨 Update:', message);
};

ws.onopen = () => console.log('✅ Connected');
ws.onerror = (error) => console.error('❌ Error:', error);
ws.onclose = () => console.log('🔌 Disconnected');
```

## WebSocket Message Format

### Status Update Message

```json
{
  "type": "status_update",
  "orderId": "uuid-here",
  "status": "routing",
  "data": {
    "selectedDex": "raydium",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Confirmation Message

```json
{
  "type": "confirmation",
  "orderId": "uuid-here",
  "status": "confirmed",
  "data": {
    "txHash": "transaction-hash-here",
    "executedPrice": 0.985,
    "amountOut": 0.985,
    "selectedDex": "raydium",
    "explorerLink": "https://solscan.io/tx/...",
    "timestamp": "2024-01-01T00:00:01.000Z"
  }
}
```

### Error Message

```json
{
  "type": "error",
  "orderId": "uuid-here",
  "status": "failed",
  "data": {
    "error": "Error message here",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

## Testing Checklist

- [ ] Server is running (`npm run dev`)
- [ ] WebSocket endpoint is accessible
- [ ] Can create order via HTTP API
- [ ] Can connect to WebSocket with order ID
- [ ] Receives initial "pending" status
- [ ] Receives "routing" status update
- [ ] Receives "building" status update
- [ ] Receives "submitted" status update
- [ ] Receives "confirmed" or "failed" final status
- [ ] Confirmed orders include transaction hash
- [ ] Confirmed orders include explorer link
- [ ] WebSocket closes gracefully on completion
- [ ] Error handling works correctly

## Troubleshooting

### WebSocket Connection Fails

1. **Check server is running:**
   ```bash
   curl http://localhost:3000/health
   ```

2. **Verify WebSocket is enabled:**
   - Check server logs for "WebSocket support enabled"
   - Ensure `ENABLE_WEBSOCKET=true` in environment

3. **Check CORS settings** (if testing from browser):
   - WebSocket connections don't use CORS, but ensure server allows connections

### No Status Updates Received

1. **Check order is actually processing:**
   ```bash
   curl http://localhost:3000/api/orders/:orderId
   ```

2. **Verify Redis is running** (required for cross-service communication):
   ```bash
   redis-cli ping
   ```

3. **Check server logs** for WebSocket connection and status broadcasts

### Connection Drops Immediately

1. **Check order ID is valid:**
   - Order must exist in database
   - Order ID format must be correct UUID

2. **Check WebSocket service initialization:**
   - Look for "Redis pub/sub subscriber initialized" in logs
   - Verify Redis connection is working

## Integration Tests

Run the WebSocket integration tests:

```bash
npm run test:integration -- websocket
```

Or run all integration tests:

```bash
npm run test:integration
```

## Example Test Flow

1. **Start server:**
   ```bash
   npm run dev
   ```

2. **Open test page:**
   - Open `scripts/test-websocket.html` in browser
   - Or run `tsx scripts/test-websocket.ts`

3. **Create order:**
   - Enter wallet private key
   - Enter amount (e.g., 0.1 SOL)
   - Click "Create Order & Connect"

4. **Observe updates:**
   - Watch status progress: pending → routing → building → submitted → confirmed
   - Check transaction hash appears on confirmation
   - Verify explorer link works

5. **Verify on blockchain:**
   - Click explorer link or visit Solscan
   - Confirm transaction appears on-chain

## Concurrent Orders Testing

To test multiple orders concurrently and verify queue design:

### Test Script: Concurrent Orders

1. Set your wallet private key:
   ```bash
   # Windows PowerShell
   $env:WALLET_PRIVATE_KEY="your-base58-private-key-here"
   
   # Linux/Mac
   export WALLET_PRIVATE_KEY="your-base58-private-key-here"
   ```

2. Run the concurrent orders test:
   ```bash
   # Test with 5 orders (default)
   tsx scripts/test-concurrent-orders.ts
   
   # Or specify number of orders (1-20)
   tsx scripts/test-concurrent-orders.ts 7
   ```

**Features:**
- Creates multiple orders concurrently
- Connects WebSocket to each order simultaneously
- Tracks status progression for all orders
- Shows real-time updates with timestamps (including milliseconds)
- Calculates concurrent processing statistics
- Generates summary report with timeline analysis

**What to Verify:**
- ✅ Orders are created concurrently (should see multiple "Order X/Y: Creating..." messages)
- ✅ Queue processes multiple orders simultaneously (check "Maximum concurrent processing" in summary)
- ✅ Rate limiting works (100 orders/minute configured)
- ✅ WebSocket isolation (each order gets its own status updates)
- ✅ Order progression (pending → routing → building → submitted → confirmed/failed)
- ✅ No order interference (orders complete independently)

**Expected Output:**
- Concurrent order creation timestamps
- Real-time status updates for all orders
- Summary showing:
  - Final status distribution
  - Order timeline for each order
  - Status progression for each order
  - Maximum concurrent processing count
  - Duration for each order

## Next Steps

After testing WebSocket connections:

1. ✅ Verify all status updates are received
2. ✅ Test error scenarios (insufficient funds, invalid orders)
3. ✅ Test multiple concurrent connections (use concurrent orders test)
4. ✅ Verify transaction hashes are correct
5. ✅ Test with both Raydium and Meteora executions
6. ✅ Verify queue concurrency and rate limiting
