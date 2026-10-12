# Using .env File for GCP Deployment

This document explains how to use a `.env` file for GCP deployment instead of Secret Manager.

## Overview

**Secret Manager is deprecated** - the application now uses a `.env` file that is included in the deployment package.

## Setup

### 1. Create .env File

Create a `.env` file in the project root with your actual connection strings:

```env
NODE_ENV=production
PORT=8080
LOG_LEVEL=info

# Cloud SQL Connection String (App Engine Standard format)
# Format: postgresql://USER:PASSWORD@/DATABASE?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
DATABASE_URL=postgresql://order_engine_user:YOUR_PASSWORD@/order_engine?host=/cloudsql/eterna-oe-engine-483916:asia-south1:order-engine-db

# Cloud Memorystore Connection String
# Format: redis://PRIVATE_IP:6379 or redis://:PASSWORD@PRIVATE_IP:6379
REDIS_URL=redis://10.x.x.x:6379

# Queue Configuration
QUEUE_CONCURRENCY=10
QUEUE_RATE_LIMIT=100

# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_CLUSTER=mainnet-beta
DEVNET_ENABLED=true
```

### 2. Ensure .env is Included in Deployment

The `.env` file is:
- ✅ **NOT** in `.gcloudignore` (will be included in deployment)
- ⚠️ **IS** in `.gitignore` (won't be committed to git, which is correct for secrets)

**Important:** Make sure your `.env` file exists in the project root before running `gcloud app deploy`.

### 3. How It Works

1. **Local Development:** `.env` file is loaded by `dotenv.config()` when running locally
2. **GCP Deployment:** `.env` file is included in the deployment package (not ignored by `.gcloudignore`)
3. **Runtime:** `dotenv.config()` is called in each server entry point (`src/servers/*.ts`) before any other imports
4. **Priority:** Environment variables from `app.yaml` env_variables override `.env` values (useful for service-specific config like `SERVICE_TYPE`)

### 4. Server Entry Points

All server entry points (`src/servers/*.ts`) now:
1. Import `dotenv/config` **first** (loads .env file)
2. Set service-specific environment variables
3. Import the main server

Example:
```typescript
// Load .env file first
import 'dotenv/config';

// Set service-specific env vars (override .env if needed)
process.env.SERVICE_TYPE = 'api';
// ...

// Import main server
import '../server';
```

### 5. What Goes in .env vs app.yaml

**In .env file (sensitive secrets):**
- `DATABASE_URL` - Cloud SQL connection string
- `REDIS_URL` - Cloud Memorystore connection string

**In app.yaml env_variables (non-sensitive, service-specific):**
- `SERVICE_TYPE` - Service type (api, websocket, health, worker)
- `ENABLE_HTTP_SERVER`, `ENABLE_WEBSOCKET`, etc. - Feature flags
- `NODE_ENV`, `PORT`, `LOG_LEVEL` - Runtime configuration
- `QUEUE_CONCURRENCY`, `QUEUE_RATE_LIMIT` - Queue settings
- `SOLANA_RPC_URL`, `SOLANA_CLUSTER`, `DEVNET_ENABLED` - Solana config (can be overridden by .env)

**Note:** If a variable exists in both `.env` and `app.yaml`, the `app.yaml` value takes precedence.

## Cloud SQL Connection String Format

For App Engine Standard, use Unix socket format:

```
postgresql://USER:PASSWORD@/DATABASE?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
```

Example:
```
postgresql://order_engine_user:MySecurePass123@/order_engine?host=/cloudsql/eterna-oe-engine-483916:asia-south1:order-engine-db
```

**Get Connection Name:**
```bash
gcloud sql instances describe INSTANCE_NAME --format="value(connectionName)"
```

## Cloud Memorystore Connection String Format

For Memorystore with private IP:

```
redis://PRIVATE_IP:6379
```

If AUTH is enabled:

```
redis://:PASSWORD@PRIVATE_IP:6379
```

**Get Redis Private IP:**
```bash
gcloud redis instances describe INSTANCE_NAME \
  --region=REGION \
  --format="value(host)"
```

## Deployment Checklist

Before deploying:

- [ ] Create `.env` file in project root with actual Cloud SQL and Redis connection strings
- [ ] Verify `.env` file is NOT in `.gcloudignore` (it's not by default)
- [ ] Test that `.env` file exists: `ls .env` (on Linux/Mac) or `Test-Path .env` (on Windows)
- [ ] Build the application: `npm run build`
- [ ] Verify `dist/` folder contains compiled code
- [ ] Deploy: `gcloud app deploy app.yaml websocket-app.yaml health-app.yaml worker-app.yaml dispatch.yaml`

## Troubleshooting

### Issue: "DATABASE_URL environment variable is not set"

**Solution:**
1. Verify `.env` file exists in project root
2. Check that `.env` file contains `DATABASE_URL=...`
3. Verify `.env` file is not empty
4. Check that `dotenv/config` is imported in server entry points

### Issue: Still connecting to localhost:5432

**Solution:**
1. Verify `.env` file has the correct Cloud SQL connection string (not localhost)
2. Check that connection string uses Unix socket format: `host=/cloudsql/...`
3. Verify connection name format: `PROJECT_ID:REGION:INSTANCE_NAME`

### Issue: .env file not included in deployment

**Solution:**
1. Check `.gcloudignore` - `.env` should NOT be listed
2. Verify `.env` file exists before running `gcloud app deploy`
3. Test deployment locally: `gcloud app deploy --dry-run` (if available)

## Security Considerations

**⚠️ Important Security Note:**

Using `.env` file for deployment means:
- Secrets are stored in plaintext in the deployment package
- `.env` file is included in the deployed code (accessible to anyone with deployment access)
- This is **less secure** than Secret Manager

**Recommendations:**
- Only use this approach for development/testing environments
- For production, consider using Secret Manager or environment variables in `app.yaml` with proper IAM controls
- Never commit `.env` file to git (it's already in `.gitignore`)
- Use least-privilege IAM policies for deployment access

## Migration from Secret Manager

If you were using Secret Manager before:

1. **Remove secrets from Secret Manager** (optional - they won't be used anymore)
2. **Create `.env` file** with the same values
3. **Ensure `.env` file is included** in deployment (verify it's not in `.gcloudignore`)
4. **Deploy** - the application will now use `.env` file instead of Secret Manager

The code automatically falls back to environment variables, so no code changes are needed beyond ensuring `.env` is loaded first.
