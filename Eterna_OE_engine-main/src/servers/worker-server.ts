// Worker Server Entry Point
// Processes BullMQ queue (App Engine Standard requires HTTP server, so health endpoint is enabled)
// Service type: worker

// Load .env file first (before any other imports)
import 'dotenv/config';

// Set service-specific environment variables (will override .env if needed)
// Note: ENABLE_HTTP_SERVER must be 'true' for App Engine Standard (required by platform)
// This is set in worker-app.yaml and should not be overridden here
process.env.SERVICE_TYPE = 'worker';
// ENABLE_HTTP_SERVER is set in app.yaml (required for App Engine Standard)
process.env.ENABLE_WEBSOCKET = 'false';
process.env.ENABLE_WORKER = 'true';
process.env.ENABLE_HEALTH = 'true'; // Enable health endpoint for App Engine Standard requirement

// Import main server after setting env vars and loading .env
import '../server';
