# GCP Environment Configuration Verification

Quick guide to verify your environment is ready for GCP deployment.

## Important: `.env` File vs GCP Secrets

### For Local Development (Your `.env` File)

**✅ Your `.env` file is fine for local development.** Keep it as-is for local testing.

**Typical `.env` for local development:**
```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Local PostgreSQL
DATABASE_URL=postgresql://postgres:password@localhost:5432/eterna_order_engine

# Local Redis/Memurai
REDIS_URL=redis://localhost:6379

# Queue Configuration
QUEUE_CONCURRENCY=10
QUEUE_RATE_LIMIT=100

# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_CLUSTER=mainnet-beta
DEVNET_ENABLED=true
```

**Note:** `.env` file is git-ignored and **not deployed to GCP**.

### For GCP Production (Secret Manager)

**⚠️ Your `.env` file is NOT used on GCP.** The application uses Secret Manager for sensitive credentials.

**Required Secrets in Google Cloud Secret Manager:**

1. **`database-url`** - Cloud SQL connection string
   ```
   postgresql://USER:PASSWORD@/DATABASE?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
   ```

2. **`redis-url`** - Memorystore connection string
   ```
   redis://PRIVATE_IP:6379
   ```

**Non-sensitive config goes in `app.yaml` env_variables:**
- NODE_ENV
- PORT (8080 for App Engine)
- LOG_LEVEL
- SERVICE_TYPE
- ENABLE_HTTP_SERVER, ENABLE_WEBSOCKET, etc.
- QUEUE_CONCURRENCY, QUEUE_RATE_LIMIT
- SOLANA_RPC_URL, SOLANA_CLUSTER, DEVNET_ENABLED

## Quick Verification Checklist

### 1. Check if Secrets Exist in Secret Manager

```bash
# List all secrets
gcloud secrets list

# Should show:
# database-url
# redis-url
```

### 2. Verify Secret Values

```bash
# Check database-url secret (this will display the value)
gcloud secrets versions access latest --secret=database-url

# Check redis-url secret (this will display the value)
gcloud secrets versions access latest --secret=redis-url
```

**Expected formats:**
- `database-url`: `postgresql://user:pass@/db?host=/cloudsql/PROJECT:REGION:INSTANCE`
- `redis-url`: `redis://10.x.x.x:6379` (or `redis://:PASSWORD@10.x.x.x:6379` if AUTH enabled)

### 3. Verify Service Account Permissions

```bash
PROJECT_ID=$(gcloud config get-value project)

# Check database-url permissions
gcloud secrets get-iam-policy database-url | grep ${PROJECT_ID}@appspot

# Check redis-url permissions
gcloud secrets get-iam-policy redis-url | grep ${PROJECT_ID}@appspot
```

**Should show:**
- `serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com` with role `roles/secretmanager.secretAccessor`

### 4. Check VPC Connector (if using Memorystore private IP)

**If using Memorystore with private IP, you MUST have a VPC connector:**

```bash
# List VPC connectors
gcloud compute networks vpc-access connectors list --region=asia-south1

# Get connector name
gcloud compute networks vpc-access connectors describe CONNECTOR_NAME \
  --region=asia-south1 \
  --format="value(name)"
```

**If VPC connector exists:**
- Uncomment `vpc_access_connector` section in ALL 4 app.yaml files:
  - `app.yaml`
  - `websocket-app.yaml`
  - `health-app.yaml`
  - `worker-app.yaml`
- Update with actual connector name: `projects/PROJECT_ID/locations/REGION/connectors/CONNECTOR_NAME`

**If no VPC connector:**
- You'll need to create one OR use Redis with public IP (not recommended for production)

## Common Issues

### Issue: "Secret not found" or "Permission denied"

**Solution:**
1. Create secrets if missing:
   ```bash
   echo -n "YOUR_CONNECTION_STRING" | gcloud secrets create database-url --data-file=-
   echo -n "YOUR_REDIS_URL" | gcloud secrets create redis-url --data-file=-
   ```

2. Grant service account access:
   ```bash
   PROJECT_ID=$(gcloud config get-value project)
   gcloud secrets add-iam-policy-binding database-url \
     --member="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   
   gcloud secrets add-iam-policy-binding redis-url \
     --member="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```

### Issue: VPC connector not configured

**Solution:**
1. Create VPC connector:
   ```bash
   gcloud compute networks vpc-access connectors create eterna-oe-engine-connector \
     --project=eterna-oe-engine \
     --region=asia-south1 \
     --network=default \
     --range=10.8.0.0/28 \
     --min-instances=2 \
     --max-instances=3
   ```

2. Update all app.yaml files (uncomment and update):
   ```yaml
   vpc_access_connector:
     name: projects/eterna-oe-engine/locations/asia-south1/connectors/eterna-oe-engine-connector
     egress_setting: all-traffic
   ```

## Pre-Deployment Checklist

- [ ] Secrets created in Secret Manager (`database-url`, `redis-url`)
- [ ] Service account has Secret Manager permissions
- [ ] VPC connector created (if using Memorystore private IP)
- [ ] VPC connector name updated in all 4 app.yaml files (if using Memorystore)
- [ ] Cloud SQL instance created and connection name obtained
- [ ] Redis/Memorystore instance created and private IP obtained
- [ ] App Engine application created in correct region
- [ ] All APIs enabled (App Engine, Cloud Build, Cloud SQL, Redis, VPC Access, Secret Manager)
- [ ] `npm run build` completes successfully
- [ ] All app.yaml files have correct configuration
- [ ] `dispatch.yaml` has correct routing rules

## Quick Verification Script

Run the verification script (if on Linux/Mac/WSL):
```bash
bash scripts/verify-gcp-setup.sh
```

Or manually check each item from the checklist above.

## Your Current Setup

**For local development:**
- ✅ Keep your `.env` file as-is for local testing
- ✅ Your `.env` file won't be deployed to GCP (it's git-ignored)

**For GCP deployment:**
- ⚠️ Make sure secrets are in Secret Manager (not just in `.env`)
- ⚠️ Verify VPC connector is created and configured if using Memorystore
- ⚠️ Check all app.yaml files have correct configuration

## Next Steps

1. **Verify secrets exist:**
   ```bash
   gcloud secrets list
   gcloud secrets versions access latest --secret=database-url
   gcloud secrets versions access latest --secret=redis-url
   ```

2. **Check VPC connector (if needed):**
   ```bash
   gcloud compute networks vpc-access connectors list --region=asia-south1
   ```

3. **If VPC connector exists, update app.yaml files:**
   - Uncomment `vpc_access_connector` section in all 4 files
   - Update with actual connector name

4. **Build and deploy:**
   ```bash
   npm run build
   gcloud app deploy app.yaml websocket-app.yaml health-app.yaml worker-app.yaml dispatch.yaml
   ```
