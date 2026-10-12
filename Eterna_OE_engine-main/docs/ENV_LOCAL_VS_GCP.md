# Environment Variables: Local vs GCP

Quick reference for environment variables used locally vs on GCP.

## Your Current Configuration

### Local Development (`.env` file)
```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgresql://postgres:User!123@localhost:5432/eterna_order_engine
REDIS_URL=redis://localhost:6379
QUEUE_CONCURRENCY=10
QUEUE_RATE_LIMIT=100

MOCK_DEX_DELAY_MIN=200
MOCK_DEX_DELAY_MAX=300
MOCK_EXECUTION_DELAY_MIN=2000
MOCK_EXECUTION_DELAY_MAX=3000

SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_CLUSTER=mainnet-beta
DEVNET_ENABLED=true
```

### GCP Production (`app.yaml` files)
```yaml
NODE_ENV: 'production'
PORT: '8080'
LOG_LEVEL: 'info'
QUEUE_CONCURRENCY: '10'
QUEUE_RATE_LIMIT: '100'
SOLANA_RPC_URL: 'https://api.devnet.solana.com'
SOLANA_CLUSTER: 'devnet'
DEVNET_ENABLED: 'true'

# Secrets loaded from Secret Manager:
# DATABASE_URL (database-url secret)
# REDIS_URL (redis-url secret)
```

## Configuration Differences

| Variable | Local (`.env`) | GCP (`app.yaml`) | Notes |
|----------|---------------|------------------|-------|
| `NODE_ENV` | `development` | `production` | ✅ OK - Different by design |
| `PORT` | `3000` | `8080` | ✅ OK - App Engine Standard uses 8080 |
| `LOG_LEVEL` | `info` | `info` | ✅ OK - Same |
| `DATABASE_URL` | Local PostgreSQL | Secret Manager | ✅ OK - `.env` not deployed |
| `REDIS_URL` | `localhost:6379` | Secret Manager | ✅ OK - `.env` not deployed |
| `QUEUE_CONCURRENCY` | `10` | `10` | ✅ OK - Same |
| `QUEUE_RATE_LIMIT` | `100` | `100` | ✅ OK - Same |
| `SOLANA_RPC_URL` | `mainnet-beta` | `devnet` | ⚠️ **INCONSISTENT** |
| `SOLANA_CLUSTER` | `mainnet-beta` | `devnet` | ⚠️ **INCONSISTENT** |
| `DEVNET_ENABLED` | `true` | `true` | ✅ OK - Both use real providers |

## What Gets Used Where

### Local Development
- **Uses:** `.env` file
- **Database:** Local PostgreSQL (`localhost:5432`)
- **Redis:** Local Memurai (`localhost:6379`)
- **Solana:** Mainnet-beta (from your `.env`)
- **Purpose:** Local testing with mainnet

### GCP Production
- **Uses:** `app.yaml` env_variables + Secret Manager
- **Database:** Cloud SQL (from `database-url` secret)
- **Redis:** Cloud Memorystore (from `redis-url` secret)
- **Solana:** Devnet (from `app.yaml`)
- **Purpose:** Production deployment on devnet (safer/cheaper for testing)

## Current Status: ⚠️ Configuration Mismatch

**Issue:** Your `.env` is configured for **mainnet-beta**, but your `app.yaml` files are configured for **devnet**.

### Option 1: Keep Current Setup (Recommended for Testing)
- **Local:** Test with mainnet-beta (your `.env`)
- **GCP:** Deploy on devnet (`app.yaml`)
- **Reason:** Safer to test on devnet in production, use mainnet locally

### Option 2: Match Configurations
If you want GCP to also use mainnet-beta, update all `app.yaml` files:

```yaml
# In app.yaml, websocket-app.yaml, health-app.yaml, worker-app.yaml
env_variables:
  # ... other vars ...
  SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com'
  SOLANA_CLUSTER: 'mainnet-beta'
  DEVNET_ENABLED: 'true'
```

**⚠️ Warning:** Using mainnet-beta on GCP means:
- Real money transactions
- Higher RPC costs (if using paid endpoints)
- Need funded wallets
- Make sure you understand the risks

## What `DEVNET_ENABLED` Actually Means

**Common Misconception:** `DEVNET_ENABLED=true` does NOT mean "use devnet cluster"

**Actual Meaning:**
- `DEVNET_ENABLED=true` → Use **real DEX providers** (Raydium/Meteora) instead of mocks
- `DEVNET_ENABLED=false` → Use **mock providers** (simulated responses)

**Cluster Selection:**
- `SOLANA_CLUSTER` controls which Solana cluster (devnet/mainnet-beta/testnet)
- `SOLANA_RPC_URL` is the RPC endpoint

**Your Current Setup:**
- Local: `DEVNET_ENABLED=true` + `mainnet-beta` = Real providers on mainnet
- GCP: `DEVNET_ENABLED=true` + `devnet` = Real providers on devnet

Both use real providers, just different clusters.

## Variables NOT Used in Production

These variables in your `.env` are only for local development:
- `MOCK_DEX_DELAY_MIN` - Only used when `DEVNET_ENABLED=false`
- `MOCK_DEX_DELAY_MAX` - Only used when `DEVNET_ENABLED=false`
- `MOCK_EXECUTION_DELAY_MIN` - Only used when `DEVNET_ENABLED=false`
- `MOCK_EXECUTION_DELAY_MAX` - Only used when `DEVNET_ENABLED=false`

Since both local and GCP have `DEVNET_ENABLED=true`, these mock delay variables are ignored.

## Summary

### ✅ Your `.env` is OK for Local Development
- Keep it as-is for local testing
- It won't be deployed to GCP (it's git-ignored)

### ⚠️ Configuration Mismatch (Local vs GCP)
- **Local:** Mainnet-beta cluster
- **GCP:** Devnet cluster

**Decision needed:**
1. **Keep mismatch** → Test mainnet locally, deploy devnet on GCP (safer)
2. **Match to mainnet** → Update `app.yaml` files to use mainnet-beta
3. **Match to devnet** → Update `.env` to use devnet (if you want consistency)

### ✅ GCP Setup is Correct
- Secrets will be loaded from Secret Manager
- Environment variables are set in `app.yaml`
- Worker service has correct queue configuration
- BullMQ will work with Cloud Memorystore

## Recommended Action

For your first GCP deployment, I recommend **keeping the current setup**:
- Deploy on **devnet** (as configured in `app.yaml`)
- This is safer and cheaper for initial testing
- You can always update `app.yaml` later to switch to mainnet-beta

If you want to use mainnet-beta on GCP, let me know and I'll update all the `app.yaml` files.
