/**
 * Helper script to generate a test wallet keypair for testing
 * Usage: npx tsx scripts/generate-test-wallet.ts
 */

import { Keypair } from '@solana/web3.js';
import * as bs58 from 'bs58';

// Generate a new keypair
const keypair = Keypair.generate();

// Encode the secret key to base58
const walletPrivateKey = bs58.encode(keypair.secretKey);

// Encode the keypair as JSON array (alternative format)
const walletKeypair = Array.from(keypair.secretKey);

console.log('\n=== Test Wallet Generated ===\n');
console.log('Public Key:', keypair.publicKey.toBase58());
console.log('\nBase58 Private Key (walletPrivateKey):');
console.log(walletPrivateKey);
console.log('\nJSON Array (walletKeypair):');
console.log(JSON.stringify(walletKeypair));
console.log('\n=== PowerShell Test Request ===\n');
console.log('$body = @{');
console.log('    tokenIn = "SOL"');
console.log('    tokenOut = "USDC"');
console.log('    amountIn = 1');
console.log('    slippageTolerance = 0.01');
console.log('    orderType = "market"');
console.log(`    walletPrivateKey = "${walletPrivateKey}"`);
console.log('} | ConvertTo-Json');
console.log('\n$response = Invoke-RestMethod -Uri "http://localhost:3000/api/orders/execute" -Method POST -Body $body -ContentType "application/json"');
console.log('\n=== For Mock Execution ===\n');
console.log('Note: For mock execution (DEVNET_ENABLED=false), this key is only used for validation.');
console.log('The actual swap is simulated and does not require real SOL in the wallet.\n');
