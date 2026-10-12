// WebSocket Server Entry Point
// Handles WebSocket /api/orders/:orderId/ws
// Service type: websocket

// Load .env file first (before any other imports)
import 'dotenv/config';

// Set service-specific environment variables (will override .env if needed)
process.env.SERVICE_TYPE = 'websocket';
process.env.ENABLE_HTTP_SERVER = 'true';
process.env.ENABLE_WEBSOCKET = 'true';
process.env.ENABLE_WORKER = 'false';
process.env.ENABLE_HEALTH = 'false';

// Import main server after setting env vars and loading .env
import '../server';
