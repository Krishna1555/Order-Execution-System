# GCP Deployment Checklist

This checklist verifies your environment configuration for GCP deployment.

## Important Notes

### `.env` File vs GCP Secrets

**For Local Development:**
- ✅ Keep your `.env` file with local values (DATABASE_URL, REDIS_URL, etc.)
- ✅ `.env` is git-ignored and only used for local testing
- ✅ No changes needed for local development

**For GCP Production:**
- ⚠️ `.env` file is **NOT used** on GCP
- ✅ Secrets (DATABASE_URL, REDIS_URL) must be in **Google Cloud Secret Manager**
- ✅ Application automatically fetches secrets from Secret Manager at runtime
- ✅ Non-sensitive config (LOG_LEVEL, SERVICE_TYPE, etc.) goes in `app.yaml` env_variables

## Pre-Deployment Checklist

### 1. GCP Resources Created

- [ ] **Cloud SQL Instance** created and running
  - Instance name: `order-engine-db` (or your chosen name)
  - Database: `order_engine` created
  - User: `order_engine_user` created
  - Connection name format: `PROJECT_ID:REGION:INSTANCE_NAME`
  
- [ ] **Cloud Memorystore (Redis)** created and running
  - Instance name: `eterna-oe-engine-redis` (or your chosen name)
  - Private IP address obtained (e.g., `10.x.x.x`)
  - Region matches App Engine region
  
- [ ] **VPC Access Connector** created (if using Memorystore private IP)
  - Connector name: `eterna-oe-engine-connector` (or your chosen name)
  - Same region as App Engine and Redis
  - IP range: `10.8.0.0/28` (or your chosen range)

- [ ] **App Engine Application** created
  - Region matches Redis and VPC connector region
  - Project ID: `eterna-oe-engine` (or your actual project ID)

### 2. Secret Manager Setup

**Required Secrets in Secret Manager:**

- [ ] **`database-url`** secret created
  ```bash
  # Format: postgresql://USER:PASSWORD@/DATABASE?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
  echo -n "postgresql://order_engine_user:YOUR_PASSWORD@/order_engine?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME" | \
    gcloud secrets create database-url --data-file=-
  ```

- [ ] **`redis-url`** secret created
  ```bash
  # Format: redis://PRIVATE_IP:6379 (or redis://:PASSWORD@PRIVATE_IP:6379 if AUTH enabled)
  echo -n "redis://10.x.x.x:6379" | \
    gcloud secrets create redis-url --data-file=-
  ```

**Service Account Permissions:**

- [ ] App Engine default service account has access to secrets
  ```bash
  PROJECT_ID=$(gcloud config get-value project)
  
  # Grant access to database-url
  gcloud secrets add-iam-policy-binding database-url \
    --member="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
  
  # Grant access to redis-url
  gcloud secrets add-iam-policy-binding redis-url \
    --member="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
  ```

### 3. App Engine Configuration Files

**Check all YAML files have correct configuration:**

- [ ] **`app.yaml`** (API Service)
  - Runtime: `nodejs22`
  - SERVICE_TYPE: `api`
  - ENABLE_HTTP_SERVER: `true`
  - ENABLE_WEBSOCKET: `false`
  - ENABLE_WORKER: `false`
  - VPC connector commented or uncommented (if needed)

- [ ] **`websocket-app.yaml`** (WebSocket Service)
  - Runtime: `nodejs22`
  - SERVICE_TYPE: `websocket`
  - ENABLE_WEBSOCKET: `true`
  - VPC connector commented or uncommented (if needed)

- [ ] **`health-app.yaml`** (Health Service)
  - Runtime: `nodejs22`
  - SERVICE_TYPE: `health`
  - ENABLE_HEALTH: `true`
  - VPC connector commented or uncommented (if needed)

- [ ] **`worker-app.yaml`** (Worker Service)
  - Runtime: `nodejs22`
  - SERVICE_TYPE: `worker`
  - ENABLE_WORKER: `true`
  - QUEUE_CONCURRENCY: `10`
  - QUEUE_RATE_LIMIT: `100`
  - VPC connector commented or uncommented (if needed)

- [ ] **`dispatch.yaml`** (Routing Configuration)
  - WebSocket routes to `websocket-service`
  - Health routes to `health-service`
  - API routes to `default` service

### 4. VPC Connector Configuration

**If using Memorystore with private IP (DIRECT_PEERING or PRIVATE_SERVICE_ACCESS):**

- [ ] VPC connector created in same region as App Engine and Redis
- [ ] VPC connector name obtained: `projects/PROJECT_ID/locations/REGION/connectors/CONNECTOR_NAME`
- [ ] **Uncomment and update** `vpc_access_connector` section in ALL app.yaml files:
  - `app.yaml`
  - `websocket-app.yaml`
  - `health-app.yaml`
  - `worker-app.yaml`

**If NOT using Memorystore (or using public IP - not recommended):**
- [ ] Leave VPC connector commented out
- [ ] Use Redis public IP (if available) or different Redis solution

### 5. Environment Variables Configuration

**What Goes in `app.yaml` env_variables (Non-Sensitive):**
```yaml
env_variables:
  SERVICE_TYPE: 'api'
  ENABLE_HTTP_SERVER: 'true'
  ENABLE_WEBSOCKET: 'false'
  ENABLE_WORKER: 'false'
  ENABLE_HEALTH: 'false'
  NODE_ENV: 'production'
  PORT: '8080'
  LOG_LEVEL: 'info'
  QUEUE_CONCURRENCY: '10'
  QUEUE_RATE_LIMIT: '100'
  SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com'  # or devnet
  SOLANA_CLUSTER: 'mainnet-beta'  # or 'devnet'
  DEVNET_ENABLED: 'true'  # or 'false'
```

**What Goes in Secret Manager (Sensitive):**
- `database-url` - Cloud SQL connection string
- `redis-url` - Memorystore connection string

**What Does NOT Go in app.yaml:**
- ❌ DATABASE_URL (use Secret Manager)
- ❌ REDIS_URL (use Secret Manager)
- ❌ Passwords or private keys
- ❌ Any sensitive credentials

### 6. Cloud SQL Connection String Format

**For App Engine Standard (Unix Socket):**
```
postgresql://USER:PASSWORD@/DATABASE?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
```

Example:
```
postgresql://order_engine_user:MySecurePass123@/order_engine?host=/cloudsql/eterna-oe-engine:asia-south1:order-engine-db
```

**Get Connection Name:**
```bash
gcloud sql instances describe INSTANCE_NAME --format="value(connectionName)"
```

### 7. Redis Connection String Format

**For Memorystore (Private IP):**
```
redis://PRIVATE_IP:6379
```

Example:
```
redis://10.1.2.3:6379
```

**If AUTH is enabled:**
```
redis://:PASSWORD@PRIVATE_IP:6379
```

**Get Redis Private IP:**
```bash
gcloud redis instances describe INSTANCE_NAME \
  --region=REGION \
  --format="value(host)"
```

### 8. Build and Deploy Verification

**Before Deploying:**
- [ ] Run `npm run build` successfully (no TypeScript errors)
- [ ] All `app.yaml` files have correct service names
- [ ] `dispatch.yaml` routes are correct
- [ ] VPC connector name is correct (if uncommented)
- [ ] Secrets exist in Secret Manager and are accessible
- [ ] Service account has Secret Manager permissions

**Deploy Commands:**
```bash
# Build first
npm run build

# Deploy services (in order)
gcloud app deploy app.yaml
gcloud app deploy websocket-app.yaml
gcloud app deploy health-app.yaml
gcloud app deploy worker-app.yaml
gcloud app deploy dispatch.yaml
```

## Common Issues and Fixes

### Issue: "Secret not found" error

**Fix:**
1. Verify secret exists: `gcloud secrets list`
2. Verify secret has data: `gcloud secrets versions access latest --secret=database-url`
3. Verify service account has access: `gcloud secrets get-iam-policy database-url`

### Issue: "Cannot connect to Redis" error

**Fix:**
1. Verify Redis is running: `gcloud redis instances describe INSTANCE_NAME --region=REGION`
2. Verify VPC connector is created and uncommented in app.yaml
3. Verify Redis private IP is correct in `redis-url` secret
4. Check App Engine and Redis are in same region

### Issue: "Cannot connect to Cloud SQL" error

**Fix:**
1. Verify Cloud SQL instance is running
2. Verify connection string format is correct (includes `/cloudsql/` path)
3. Verify Cloud SQL Admin API is enabled
4. For App Engine Standard, ensure using Unix socket format (`/cloudsql/...`)
5. Check service account has Cloud SQL Client role if needed

### Issue: VPC connector not working

**Fix:**
1. Verify VPC connector is in same region as App Engine
2. Verify IP range doesn't conflict with other resources
3. Verify VPC connector is uncommented in app.yaml files
4. Check connector status: `gcloud compute networks vpc-access connectors describe CONNECTOR_NAME --region=REGION`

## Verification Commands

**Check Secrets:**
```bash
# List all secrets
gcloud secrets list

# Verify secret exists and has data
gcloud secrets versions access latest --secret=database-url
gcloud secrets versions access latest --secret=redis-url

# Check IAM permissions
gcloud secrets get-iam-policy database-url
gcloud secrets get-iam-policy redis-url
```

**Check Cloud SQL:**
```bash
# List instances
gcloud sql instances list

# Get connection name
gcloud sql instances describe INSTANCE_NAME --format="value(connectionName)"

# Test connection (with Cloud SQL Proxy)
cloud-sql-proxy PROJECT_ID:REGION:INSTANCE_NAME
```

**Check Redis:**
```bash
# List instances
gcloud redis instances list --region=REGION

# Get private IP
gcloud redis instances describe INSTANCE_NAME --region=REGION --format="value(host)"
```

**Check VPC Connector:**
```bash
# List connectors
gcloud compute networks vpc-access connectors list --region=REGION

# Get connector name
gcloud compute networks vpc-access connectors describe CONNECTOR_NAME --region=REGION --format="value(name)"
```

## Your Current Configuration Status

**To verify your setup, run these checks:**

1. **Check if secrets exist:**
   ```bash
   gcloud secrets list
   ```
   Should show: `database-url`, `redis-url`

2. **Check if secrets are accessible:**
   ```bash
   PROJECT_ID=$(gcloud config get-value project)
   gcloud secrets versions access latest --secret=database-url
   gcloud secrets versions access latest --secret=redis-url
   ```

3. **Check service account permissions:**
   ```bash
   PROJECT_ID=$(gcloud config get-value project)
   gcloud secrets get-iam-policy database-url | grep ${PROJECT_ID}@appspot
   gcloud secrets get-iam-policy redis-url | grep ${PROJECT_ID}@appspot
   ```

4. **Check VPC connector (if using Memorystore private IP):**
   ```bash
   gcloud compute networks vpc-access connectors list --region=asia-south1
   ```

5. **Check app.yaml files for VPC connector:**
   - If VPC connector exists, uncomment and update `vpc_access_connector` in all 4 app.yaml files
   - If no VPC connector, leave it commented (but this will cause Redis connection issues)

## Next Steps

Once all checkboxes are complete:

1. ✅ Build the application: `npm run build`
2. ✅ Deploy services: `gcloud app deploy app.yaml websocket-app.yaml health-app.yaml worker-app.yaml dispatch.yaml`
3. ✅ Verify deployment: `gcloud app services list`
4. ✅ Check logs: `gcloud app logs tail -s default`
5. ✅ Test endpoints: `curl https://YOUR_PROJECT.appspot.com/health`
