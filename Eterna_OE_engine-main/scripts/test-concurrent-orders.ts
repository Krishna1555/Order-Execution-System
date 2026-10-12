/**
 * Concurrent Orders Test Script
 * 
 * This script tests multiple orders concurrently to verify queue design,
 * concurrency, rate limiting, and WebSocket isolation.
 * 
 * Usage:
 *   tsx scripts/test-concurrent-orders.ts
 * 
 * Or specify number of orders:
 *   tsx scripts/test-concurrent-orders.ts 7
 */

import WebSocket from 'ws';
import axios from 'axios';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const WS_BASE_URL = process.env.WS_BASE_URL || 'ws://localhost:3000';
const DEFAULT_ORDER_COUNT = 5;

interface OrderRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: number;
  slippageTolerance: number;
  orderType: string;
  walletPrivateKey?: string;
  walletKeypair?: number[];
}

interface WebSocketMessage {
  type: 'status_update' | 'error' | 'confirmation';
  orderId: string;
  status: string;
  data?: {
    txHash?: string;
    executedPrice?: number;
    amountOut?: number;
    selectedDex?: string;
    explorerLink?: string;
    error?: string;
    timestamp: string;
  };
}

interface OrderTracker {
  orderId: string;
  createdAt: Date;
  ws?: WebSocket;
  statusHistory: Array<{ timestamp: Date; status: string; data?: any }>;
  finalStatus?: string;
  error?: string;
}

/**
 * Format timestamp with milliseconds
 */
function formatTimestamp(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

/**
 * Create a single order
 */
async function createOrder(walletPrivateKey: string, orderNumber: number, totalOrders: number): Promise<string> {
  const orderRequest: OrderRequest = {
    tokenIn: 'SOL',
    tokenOut: 'USDC',
    amountIn: 0.1, // Small amount for testing
    slippageTolerance: 0.01,
    orderType: 'market',
    walletPrivateKey,
  };

  const startTime = Date.now();
  console.log(`[${formatTimestamp(new Date())}] Order ${orderNumber}/${totalOrders}: Creating...`);

  try {
    const response = await axios.post(`${API_BASE_URL}/api/orders/execute`, orderRequest, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });

    const orderId = response.data.orderId;
    const elapsed = Date.now() - startTime;
    console.log(`[${formatTimestamp(new Date())}] Order ${orderNumber}/${totalOrders}: Created (${elapsed}ms) - ID: ${orderId.substring(0, 8)}...`);

    return orderId;
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    if (axios.isAxiosError(error)) {
      console.error(`[${formatTimestamp(new Date())}] Order ${orderNumber}/${totalOrders}: Failed (${elapsed}ms) - ${error.response?.data?.error || error.message}`);
    } else {
      console.error(`[${formatTimestamp(new Date())}] Order ${orderNumber}/${totalOrders}: Failed (${elapsed}ms) - ${error}`);
    }
    throw error;
  }
}

/**
 * Connect WebSocket for an order
 */
function connectWebSocket(tracker: OrderTracker, orderNumber: number, totalOrders: number): void {
  const wsUrl = `${WS_BASE_URL}/api/orders/${tracker.orderId}/ws`;
  const ws = new WebSocket(wsUrl);

  tracker.ws = ws;

  ws.on('open', () => {
    console.log(`[${formatTimestamp(new Date())}] Order ${orderNumber}/${totalOrders}: WebSocket connected`);
  });

  ws.on('message', (data: WebSocket.Data) => {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      const timestamp = new Date();
      
      // Track status change
      tracker.statusHistory.push({
        timestamp,
        status: message.status,
        data: message.data,
      });

      // Update final status if terminal
      if (message.status === 'confirmed' || message.status === 'failed') {
        tracker.finalStatus = message.status;
        if (message.data?.error) {
          tracker.error = message.data.error;
        }
      }

      // Display update
      const statusLabel = message.status.toUpperCase().padEnd(10);
      const dexInfo = message.data?.selectedDex ? ` DEX: ${message.data.selectedDex}` : '';
      const txInfo = message.data?.txHash ? ` TX: ${message.data.txHash.substring(0, 8)}...` : '';
      console.log(`[${formatTimestamp(timestamp)}] Order ${orderNumber}/${totalOrders}: ${statusLabel}${dexInfo}${txInfo}`);
    } catch (error) {
      console.error(`[${formatTimestamp(new Date())}] Order ${orderNumber}/${totalOrders}: Failed to parse message:`, error);
    }
  });

  ws.on('error', (error: Error) => {
    console.error(`[${formatTimestamp(new Date())}] Order ${orderNumber}/${totalOrders}: WebSocket error: ${error.message}`);
  });

  ws.on('close', (code: number) => {
    console.log(`[${formatTimestamp(new Date())}] Order ${orderNumber}/${totalOrders}: WebSocket closed (code: ${code})`);
  });
}

/**
 * Create multiple orders concurrently
 */
async function createConcurrentOrders(walletPrivateKey: string, orderCount: number): Promise<OrderTracker[]> {
  console.log(`\nCreating ${orderCount} orders concurrently...\n`);

  const createPromises = Array.from({ length: orderCount }, (_, i) => 
    createOrder(walletPrivateKey, i + 1, orderCount)
  );

  const orderIds = await Promise.all(createPromises);

  const trackers: OrderTracker[] = orderIds.map((orderId, index) => ({
    orderId,
    createdAt: new Date(),
    statusHistory: [{ timestamp: new Date(), status: 'created' }],
  }));

  console.log(`\n[${formatTimestamp(new Date())}] All ${orderCount} orders created successfully\n`);
  return trackers;
}

/**
 * Connect WebSockets for all orders
 */
function connectAllWebSockets(trackers: OrderTracker[]): void {
  console.log(`Connecting WebSockets for ${trackers.length} orders...\n`);
  console.log('─'.repeat(80));
  console.log('Status Updates:');
  console.log('─'.repeat(80) + '\n');

  trackers.forEach((tracker, index) => {
    connectWebSocket(tracker, index + 1, trackers.length);
  });
}

/**
 * Wait for all orders to complete or timeout
 */
async function waitForCompletion(trackers: OrderTracker[], timeoutMs: number = 300000): Promise<void> {
  const startTime = Date.now();
  const checkInterval = 1000; // Check every second

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const allComplete = trackers.every(t => 
        t.finalStatus === 'confirmed' || t.finalStatus === 'failed'
      );

      const elapsed = Date.now() - startTime;

      if (allComplete) {
        clearInterval(interval);
        console.log(`\n[${formatTimestamp(new Date())}] All orders completed in ${elapsed}ms\n`);
        resolve();
      } else if (elapsed >= timeoutMs) {
        clearInterval(interval);
        console.log(`\n[${formatTimestamp(new Date())}] Timeout after ${timeoutMs}ms (${elapsed}ms elapsed)\n`);
        resolve();
      }
    }, checkInterval);
  });
}

/**
 * Print summary statistics
 */
function printSummary(trackers: OrderTracker[]): void {
  console.log('═'.repeat(80));
  console.log('CONCURRENT ORDERS TEST SUMMARY');
  console.log('═'.repeat(80));
  console.log(`Total Orders: ${trackers.length}\n`);

  const statusCounts: Record<string, number> = {};
  trackers.forEach(tracker => {
    const status = tracker.finalStatus || 'pending';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  console.log('Final Status Distribution:');
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`  ${status.toUpperCase().padEnd(12)}: ${count}`);
  });
  console.log();

  console.log('Order Timeline:');
  trackers.forEach((tracker, index) => {
    const orderNum = index + 1;
    const orderIdShort = tracker.orderId.substring(0, 8);
    const duration = tracker.statusHistory.length > 0
      ? tracker.statusHistory[tracker.statusHistory.length - 1].timestamp.getTime() - tracker.createdAt.getTime()
      : 0;
    const statusCount = tracker.statusHistory.length;
    const finalStatus = tracker.finalStatus || 'pending';
    
    console.log(`\n  Order ${orderNum} (${orderIdShort}...):`);
    console.log(`    Created:     ${formatTimestamp(tracker.createdAt)}`);
    console.log(`    Final Status: ${finalStatus.toUpperCase()}`);
    console.log(`    Status Changes: ${statusCount}`);
    console.log(`    Duration: ${duration}ms`);
    
    if (tracker.statusHistory.length > 0) {
      console.log(`    Status Progression:`);
      tracker.statusHistory.forEach((entry, idx) => {
        const elapsed = entry.timestamp.getTime() - tracker.createdAt.getTime();
        console.log(`      ${idx + 1}. ${formatTimestamp(entry.timestamp)} (+${elapsed}ms): ${entry.status.toUpperCase()}`);
      });
    }

    if (tracker.error) {
      console.log(`    Error: ${tracker.error}`);
    }
  });

  // Calculate concurrent processing stats
  const allStatusChanges = trackers.flatMap(t => 
    t.statusHistory.map(h => ({ time: h.timestamp, order: t.orderId }))
  ).sort((a, b) => a.time.getTime() - b.time.getTime());

  let maxConcurrent = 0;
  let currentActive = 0;

  allStatusChanges.forEach(change => {
    // Count how many orders were in non-terminal states at this time
    const activeAtTime = trackers.filter(t => {
      const lastStatus = t.statusHistory[t.statusHistory.length - 1]?.status || 'created';
      return lastStatus !== 'confirmed' && lastStatus !== 'failed' &&
             (t.createdAt.getTime() <= change.time.getTime());
    }).length;
    
    if (activeAtTime > maxConcurrent) {
      maxConcurrent = activeAtTime;
    }
  });

  console.log(`\nConcurrency Analysis:`);
  console.log(`  Maximum concurrent processing: ${maxConcurrent} orders`);
  console.log(`  Expected (queue concurrency): 10 workers`);
  
  // Check queue statistics
  console.log(`\n─`.repeat(80));
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const orderCount = args.length > 0 ? parseInt(args[0], 10) : DEFAULT_ORDER_COUNT;

  if (isNaN(orderCount) || orderCount < 1 || orderCount > 20) {
    console.error('[ERROR] Invalid order count. Must be between 1 and 20.');
    process.exit(1);
  }

  console.log('Concurrent Orders Test Script');
  console.log('═'.repeat(80));
  console.log(`API URL: ${API_BASE_URL}`);
  console.log(`WS URL: ${WS_BASE_URL}`);
  console.log(`Order Count: ${orderCount}`);
  console.log('═'.repeat(80) + '\n');

  const walletPrivateKey = process.env.WALLET_PRIVATE_KEY;
  if (!walletPrivateKey) {
    console.error('[ERROR] WALLET_PRIVATE_KEY environment variable is required');
    console.error('\nUsage:');
    console.error('  WALLET_PRIVATE_KEY=your-key tsx scripts/test-concurrent-orders.ts [count]');
    console.error('  Example: WALLET_PRIVATE_KEY=your-key tsx scripts/test-concurrent-orders.ts 7');
    process.exit(1);
  }

  try {
    // Step 1: Create all orders concurrently
    const trackers = await createConcurrentOrders(walletPrivateKey, orderCount);

    // Step 2: Connect WebSockets for all orders
    connectAllWebSockets(trackers);

    // Step 3: Wait for all orders to complete (5 minute timeout)
    await waitForCompletion(trackers, 300000);

    // Step 4: Print summary
    printSummary(trackers);

    // Step 5: Close all WebSocket connections
    trackers.forEach(tracker => {
      if (tracker.ws && tracker.ws.readyState === 1) { // 1 = OPEN
        tracker.ws.close();
      }
    });

    console.log('\nTest completed.\n');
    process.exit(0);
  } catch (error) {
    console.error('[ERROR] Fatal error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n[SHUTDOWN] Test interrupted by user');
  process.exit(0);
});

// Run the script
main().catch((error) => {
  console.error('[ERROR] Fatal error:', error);
  process.exit(1);
});
