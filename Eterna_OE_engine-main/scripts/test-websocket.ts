/**
 * WebSocket Test Script
 * 
 * This script tests the WebSocket connection for order status updates.
 * 
 * Usage:
 *   tsx scripts/test-websocket.ts
 * 
 * Or with a specific order ID:
 *   tsx scripts/test-websocket.ts <orderId>
 * 
 * If no orderId is provided, it will create a new order first.
 */

import WebSocket from 'ws';
import axios from 'axios';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const WS_BASE_URL = process.env.WS_BASE_URL || 'ws://localhost:3000';

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

/**
 * Create a new order via HTTP API
 */
async function createOrder(walletPrivateKey: string): Promise<string> {
  const orderRequest: OrderRequest = {
    tokenIn: 'SOL',
    tokenOut: 'USDC',
    amountIn: 0.1, // Small amount for testing
    slippageTolerance: 0.01,
    orderType: 'market',
    walletPrivateKey,
  };

  console.log('Creating order...');
  console.log('Request:', JSON.stringify({ ...orderRequest, walletPrivateKey: '***' }, null, 2));

  try {
    const response = await axios.post(`${API_BASE_URL}/api/orders/execute`, orderRequest, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });

    const orderId = response.data.orderId;
    console.log(`\n[OK] Order created successfully!`);
    console.log(`   Order ID: ${orderId}`);
    console.log(`   Status: ${response.data.status}`);
    console.log(`   Message: ${response.data.message}\n`);

    return orderId;
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error('[ERROR] Failed to create order:');
      console.error(`   Status: ${error.response?.status}`);
      console.error(`   Error: ${error.response?.data?.error || error.message}`);
      if (error.response?.data) {
        console.error(`   Details:`, JSON.stringify(error.response.data, null, 2));
      }
    } else {
      console.error('[ERROR] Failed to create order:', error);
    }
    process.exit(1);
  }
}

/**
 * Connect to WebSocket and listen for status updates
 */
function connectWebSocket(orderId: string): void {
  const wsUrl = `${WS_BASE_URL}/api/orders/${orderId}/ws`;
  console.log(`Connecting to WebSocket: ${wsUrl}\n`);

  const ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.log('[OK] WebSocket connection established\n');
    console.log('Waiting for status updates...\n');
    console.log('─'.repeat(60));
  });

  ws.on('message', (data: WebSocket.Data) => {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      displayStatusUpdate(message);
    } catch (error) {
      console.error('[ERROR] Failed to parse WebSocket message:', error);
      console.error('Raw message:', data.toString());
    }
  });

  ws.on('error', (error: Error) => {
    console.error('[ERROR] WebSocket error:', error.message);
  });

  ws.on('close', (code: number, reason: Buffer) => {
    console.log('\n' + '─'.repeat(60));
    console.log(`\n[CLOSED] WebSocket connection closed`);
    console.log(`   Code: ${code}`);
    if (reason.length > 0) {
      console.log(`   Reason: ${reason.toString()}`);
    }
    console.log('\nTest completed.\n');
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n[SHUTDOWN] Shutting down...');
    ws.close();
    process.exit(0);
  });
}

/**
 * Display formatted status update
 */
function displayStatusUpdate(message: WebSocketMessage): void {
  // Format timestamp with milliseconds for better differentiation
  const formatTimestamp = (date: Date): string => {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  };
  
  const timestamp = message.data?.timestamp 
    ? formatTimestamp(new Date(message.data.timestamp))
    : formatTimestamp(new Date());

  console.log(`\n[${timestamp}] ${message.type.toUpperCase()}`);
  console.log(`   Order ID: ${message.orderId}`);
  console.log(`   Status: ${message.status}`);

  if (message.data) {
    if (message.data.selectedDex) {
      console.log(`   Selected DEX: ${message.data.selectedDex}`);
    }
    if (message.data.amountOut !== undefined) {
      console.log(`   Amount Out: ${message.data.amountOut}`);
    }
    if (message.data.executedPrice !== undefined) {
      console.log(`   Executed Price: ${message.data.executedPrice}`);
    }
    if (message.data.txHash) {
      console.log(`   Transaction Hash: ${message.data.txHash}`);
    }
    if (message.data.explorerLink) {
      console.log(`   Explorer: ${message.data.explorerLink}`);
    }
    if (message.data.error) {
      console.log(`   Error: ${message.data.error}`);
    }
  }

  // Show status with plain text indicator
  const statusLabels: Record<string, string> = {
    pending: '[PENDING]',
    routing: '[ROUTING]',
    building: '[BUILDING]',
    submitted: '[SUBMITTED]',
    confirmed: '[CONFIRMED]',
    failed: '[FAILED]',
  };

  const statusLabel = statusLabels[message.status] || '[UNKNOWN]';
  console.log(`   ${statusLabel} Status: ${message.status.toUpperCase()}`);

  if (message.status === 'confirmed' || message.status === 'failed') {
    console.log('\n' + '─'.repeat(60));
    console.log(`\n${message.status === 'confirmed' ? '[CONFIRMED]' : '[FAILED]'} Order ${message.status.toUpperCase()}`);
    if (message.status === 'confirmed' && message.data?.txHash) {
      console.log(`\n   View transaction: ${message.data.explorerLink || `https://solscan.io/tx/${message.data.txHash}`}`);
    }
  }
}

/**
 * Get order status via HTTP (fallback)
 */
async function getOrderStatus(orderId: string): Promise<void> {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/orders/${orderId}`);
    console.log('\n[HTTP] Current Order Status:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      console.error(`\n[ERROR] Failed to get order status: ${error.response?.data?.error || error.message}`);
    } else {
      console.error(`\n[ERROR] Failed to get order status:`, error);
    }
  }
}

/**
 * Main function
 */
async function main() {
  console.log('WebSocket Test Script');
  console.log('═'.repeat(60));
  console.log(`API URL: ${API_BASE_URL}`);
  console.log(`WS URL: ${WS_BASE_URL}`);
  console.log('═'.repeat(60) + '\n');

  const args = process.argv.slice(2);
  let orderId: string;

  if (args.length > 0) {
    // Use provided order ID
    orderId = args[0];
    console.log(`Using existing order ID: ${orderId}\n`);
    
    // Get current status first
    await getOrderStatus(orderId);
  } else {
    // Create new order
    const walletPrivateKey = process.env.WALLET_PRIVATE_KEY;
    if (!walletPrivateKey) {
      console.error('[ERROR] WALLET_PRIVATE_KEY environment variable is required');
      console.error('\nUsage:');
      console.error('  WALLET_PRIVATE_KEY=your-key tsx scripts/test-websocket.ts');
      console.error('  OR');
      console.error('  tsx scripts/test-websocket.ts <existing-order-id>');
      process.exit(1);
    }

    orderId = await createOrder(walletPrivateKey);
  }

  // Connect to WebSocket
  connectWebSocket(orderId);

  // Keep process alive
  // The WebSocket connection will keep it alive, or we can add a timeout
  console.log('\nTip: Press Ctrl+C to exit\n');
}

// Run the script
main().catch((error) => {
  console.error('[ERROR] Fatal error:', error);
  process.exit(1);
});
