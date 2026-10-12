// API Server Entry Point
// Handles POST /api/orders/execute and GET /api/orders/:orderId
// Service type: api

// Load .env file first (before any other imports)
import 'dotenv/config';

// Set service-specific environment variables (will override .env if needed)
process.env.SERVICE_TYPE = 'api';
process.env.ENABLE_HTTP_SERVER = 'true';
process.env.ENABLE_WEBSOCKET = 'false';
process.env.ENABLE_WORKER = 'false';
process.env.ENABLE_HEALTH = 'false';

// Import main server after setting env vars and loading .env
import '../server';
