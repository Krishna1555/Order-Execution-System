# Deployment Guide

This guide covers deployment procedures for the Order Execution Engine on various platforms.

## Prerequisites

- Node.js 18+ and npm/yarn
- PostgreSQL database (Supabase recommended for local dev, or managed service for production)
- Redis instance (Memurai for Windows local dev, or managed service for production)
- Deployment platform account

## Local Development Setup

For local development on Windows:
- Use **Memurai** (Windows Redis) - runs on `localhost:6379`
- Use **Supabase** (cloud PostgreSQL) - get connection string from project settings
- See [ENV_SETUP.md](ENV_SETUP.md) for detailed setup instructions

## Environment Variables

Required environment variables for production:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@host:5432/dbname
REDIS_URL=redis://host:6379
LOG_LEVEL=info
QUEUE_CONCURRENCY=10
QUEUE_RATE_LIMIT=100
```

## Deployment Options

### Option 1: Google Cloud Platform (GCP) App Engine

GCP App Engine provides managed infrastructure with automatic scaling, Cloud SQL for PostgreSQL, and Cloud Memorystore for Redis. This deployment uses **App Engine Standard environment** with **multiple services** and `dispatch.yaml` routing for endpoint-based traffic distribution.

**Note**: App Engine Standard does NOT natively support WebSockets. The WebSocket service may have limitations. Consider using App Engine Flexible or Cloud Run if full WebSocket support is required.

#### Architecture Overview

The application is split into 4 separate App Engine services:
- **API Service** (default) - Handles POST `/api/orders/execute` and GET `/api/orders/:orderId`
- **WebSocket Service** (websocket-service) - Handles WebSocket `/api/orders/:orderId/ws`
- **Health Service** (health-service) - Handles `/health/*` endpoints for monitoring
- **Worker Service** (worker-service) - Processes BullMQ queue (no HTTP endpoints)

**Cross-Service Communication**: The worker service publishes order status updates to Redis pub/sub, and the WebSocket service subscribes to these updates to broadcast to connected clients.

#### Prerequisites

1. **Google Cloud Account**: Sign up at [cloud.google.com](https://cloud.google.com)
2. **gcloud CLI**: Install from [cloud.google.com/sdk](https://cloud.google.com/sdk/docs/install)
3. **Project Setup**:
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

#### Step 1: Enable Required APIs

```bash
# Enable App Engine API
gcloud services enable appengine.googleapis.com

# Enable Cloud Build API (required for App Engine deployments)
gcloud services enable cloudbuild.googleapis.com

# Enable Cloud SQL Admin API
gcloud services enable sqladmin.googleapis.com

# Enable Cloud Memorystore API
gcloud services enable redis.googleapis.com

# Enable Serverless VPC Access API (for Memorystore private IP)
gcloud services enable vpcaccess.googleapis.com

# Enable Secret Manager API (for secure credential storage)
gcloud services enable secretmanager.googleapis.com
```

**Fix Cloud Build Permissions (if you get "service account does not have access to the bucket" error):**

If you encounter the error: `service account does not have access to the bucket`, grant the App Engine default service account the necessary Cloud Build permissions:

```bash
# Get project ID
PROJECT_ID=$(gcloud config get-value project)

# Grant App Engine default service account access to Cloud Build
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.builder"

# Grant Cloud Build service account access to App Engine
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PROJECT_ID}@cloudbuild.gserviceaccount.com" \
  --role="roles/appengine.deployer"

# Grant Cloud Build service account access to App Engine storage
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PROJECT_ID}@cloudbuild.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

#### Step 2: Create Cloud SQL for PostgreSQL

```bash
# Create Cloud SQL instance (choose region matching your App Engine region)
gcloud sql instances create order-engine-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1

# Create database
gcloud sql databases create order_engine --instance=order-engine-db

# Create user
gcloud sql users create order_engine_user \
  --instance=order-engine-db \
  --password=YOUR_SECURE_PASSWORD

# Get connection name
gcloud sql instances describe order-engine-db --format="value(connectionName)"
# Output: PROJECT_ID:REGION:INSTANCE_NAME
```

**Connection String Format**:
```
postgresql://order_engine_user:YOUR_SECURE_PASSWORD@/order_engine?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
```

#### Step 3: Create Cloud Memorystore for Redis

**Option A: Using DIRECT_PEERING (simpler, recommended for single service)**

```bash
# Create Redis instance with DIRECT_PEERING mode (same region as App Engine)
gcloud redis instances create eterna-oe-engine-redis \
  --project=eterna-oe-engine \
  --tier=basic \
  --size=1 \
  --region=asia-south1 \
  --redis-version=redis_7_2 \
  --network=projects/eterna-oe-engine/global/networks/default \
  --connect-mode=DIRECT_PEERING \
  --display-name="Eterna OE Engine Redis"

# Note: Do NOT use --zone parameter (Memorystore is regional, not zonal)
# Get private IP address
gcloud redis instances describe eterna-oe-engine-redis \
  --project=eterna-oe-engine \
  --region=asia-south1 \
  --format="value(host)"
# Output: 10.x.x.x (private IP)
```

**Option B: Using PRIVATE_SERVICE_ACCESS (better for multiple services)**

```bash
# First, set up Private Service Access (one-time setup per VPC)
gcloud compute addresses create google-managed-services-default \
  --global \
  --purpose=VPC_PEERING \
  --prefix-length=16 \
  --network=default

gcloud services vpc-peerings connect \
  --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-default \
  --network=default

# Then create Redis instance
gcloud redis instances create order-engine-redis \
  --size=1 \
  --region=us-central1 \
  --network=projects/PROJECT_ID/global/networks/default \
  --redis-version=REDIS_6_X \
  --connect-mode=PRIVATE_SERVICE_ACCESS
```

**Cost Note**: Both options have the **same Redis instance cost**. DIRECT_PEERING is simpler for single-service setups, while PRIVATE_SERVICE_ACCESS is better if you plan to use multiple Google services (Cloud SQL, etc.). **Both require VPC Access Connector** for App Engine Flexible (additional ~$7-8/month).

**Redis Connection URL**:
```
redis://10.x.x.x:6379
```

If AUTH is enabled:
```
redis://:PASSWORD@10.x.x.x:6379
```

#### Step 4: Create VPC Connector for Memorystore Access

**Important**: App Engine Flexible requires a VPC Access Connector to access private IP resources (like Memorystore), regardless of whether you use DIRECT_PEERING or PRIVATE_SERVICE_ACCESS mode.

```bash
# Create Serverless VPC Access Connector (same region as App Engine and Redis)
gcloud compute networks vpc-access connectors create eterna-oe-engine-connector \
  --project=eterna-oe-engine \
  --region=asia-south1 \
  --network=default \
  --range=10.8.0.0/28 \
  --min-instances=2 \
  --max-instances=3

# Get connector name
gcloud compute networks vpc-access connectors describe eterna-oe-engine-connector \
  --project=eterna-oe-engine \
  --region=asia-south1 \
  --format="value(name)"
# Output: projects/eterna-oe-engine/locations/asia-south1/connectors/eterna-oe-engine-connector
```

**VPC Connector Cost**: ~$7-8/month minimum (charged per connector, regardless of traffic). This is **required** for App Engine Flexible to access Memorystore private IPs.

#### Step 5: Create App Engine Application

**Important**: App Engine region must match your Redis and VPC connector region to avoid inter-region egress charges.

```bash
# Create App Engine application (first time only, choose region matching Redis)
gcloud app create --project=eterna-oe-engine --region=asia-south1

# Note: If using asia-south1 region, ensure all resources (Redis, VPC Connector, Cloud SQL) are in the same region
```

#### Step 6: Enable Secret Manager API and Create Secrets

**Enable Secret Manager API:**
```bash
gcloud services enable secretmanager.googleapis.com
```

**Create Secrets in Secret Manager:**

Create the `database-url` secret:
```bash
# Create database-url secret
# Replace with your actual Cloud SQL connection string
echo -n "postgresql://order_engine_user:YOUR_SECURE_PASSWORD@/order_engine?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME" | \
  gcloud secrets create database-url --data-file=-
```

Create the `redis-url` secret:
```bash
# Create redis-url secret
# Replace with your actual Memorystore private IP
echo -n "redis://10.x.x.x:6379" | \
  gcloud secrets create redis-url --data-file=-

# If Redis AUTH is enabled:
# echo -n "redis://:PASSWORD@10.x.x.x:6379" | \
#   gcloud secrets create redis-url --data-file=-
```

**Grant App Engine Service Account Access to Secrets:**

```bash
# Get project ID
PROJECT_ID=$(gcloud config get-value project)

# Grant access to database-url secret
gcloud secrets add-iam-policy-binding database-url \
  --member="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Grant access to redis-url secret
gcloud secrets add-iam-policy-binding redis-url \
  --member="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**Note**: Application code automatically fetches secrets from Secret Manager at runtime if not in environment variables (see `src/utils/secrets.ts`). **No credentials are stored in YAML files.**

#### Step 7: Update VPC Connector Name (if needed)

If you created a VPC connector in Step 4, update the connector name in YAML files. Uncomment and update the `vpc_access_connector` section in `app.yaml`, `websocket-app.yaml`, `health-app.yaml`, and `worker-app.yaml`:

```yaml
vpc_access_connector:
  name: projects/PROJECT_ID/locations/REGION/connectors/CONNECTOR_NAME
```

#### Step 8: Run Database Migrations

```bash
# Option A: Run migrations locally (with Cloud SQL Proxy)
# Download Cloud SQL Proxy and connect to your instance
export DATABASE_URL="postgresql://order_engine_user:PASSWORD@127.0.0.1:5432/order_engine"
npm run db:migrate

# Option B: Run migrations in App Engine shell (after deployment)
gcloud app instances ssh INSTANCE_ID --service=default
npm run db:migrate
```

**Note**: For migrations, you can temporarily set `DATABASE_URL` as an environment variable or fetch it from Secret Manager using the same utility (`src/utils/secrets.ts`).

#### Step 9: Deploy Services

**Option A: Deploy all services at once (recommended)**

```bash
# Use the deployment script
bash scripts/deploy-gcp.sh
```

**Option B: Deploy services individually**

```bash
# Build TypeScript first
npm run build

# Deploy API service (default)
gcloud app deploy app.yaml

# Deploy WebSocket service
gcloud app deploy websocket-app.yaml

# Deploy Health service
gcloud app deploy health-app.yaml

# Deploy Worker service
gcloud app deploy worker-app.yaml

# Deploy dispatch.yaml (routing configuration)
gcloud app deploy dispatch.yaml
```

#### Step 10: Verify Deployment

```bash
# Get your app URL
gcloud app browse

# Check service URLs
gcloud app services list

# Test health endpoint
curl https://YOUR_PROJECT_ID.appspot.com/health

# Test API endpoint
curl -X POST https://YOUR_PROJECT_ID.appspot.com/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amountIn": 100,
    "slippageTolerance": 0.01,
    "orderType": "market",
    "walletPrivateKey": "YOUR_BASE58_PRIVATE_KEY"
  }'
```

#### Step 11: View Logs

```bash
# View logs for all services
gcloud app logs tail -s default
gcloud app logs tail -s websocket-service
gcloud app logs tail -s health-service
gcloud app logs tail -s worker-service

# Or view in Cloud Console
# https://console.cloud.google.com/logs/query?project=YOUR_PROJECT_ID
```

#### Service Configuration Details

**API Service** (`app.yaml`):
- Runtime: nodejs22 (Standard environment)
- Automatic scaling: 1-10 instances
- Instance class: F1 (256MB memory, shared CPU)
- Handles: POST `/api/orders/execute`, GET `/api/orders/:orderId`

**WebSocket Service** (`websocket-app.yaml`):
- Runtime: nodejs22 (Standard environment)
- **WARNING**: App Engine Standard does NOT natively support WebSockets
- Automatic scaling: 1-5 instances
- Instance class: F1 (256MB memory, shared CPU)
- Handles: WebSocket `/api/orders/:orderId/ws` (may have limitations)
- Subscribes to Redis pub/sub for order status updates

**Health Service** (`health-app.yaml`):
- Runtime: nodejs22 (Standard environment)
- Automatic scaling: 0-3 instances (can scale to zero)
- Instance class: F1 (256MB memory, shared CPU)
- Handles: `/health/*` endpoints

**Worker Service** (`worker-app.yaml`):
- Basic scaling: 2 instances (fixed)
- Instance class: F2 (512MB memory, shared CPU)
- Processes BullMQ queue
- Publishes order status updates to Redis pub/sub
- **Note**: Standard environment requires HTTP server, so worker exposes health endpoint

#### Dispatch Routing

The `dispatch.yaml` file routes requests to appropriate services:
- `/api/orders/:orderId/ws` → websocket-service
- `/health/*` → health-service
- `/api/orders/*` → default (API service)
- `/*` → default (fallback)

#### Troubleshooting

**Cloud SQL Connection Issues**:
- Verify connection name format: `PROJECT_ID:REGION:INSTANCE_NAME`
- Check Cloud SQL instance is in same region as App Engine
- Verify Unix socket path: `/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME`
- Check Cloud SQL instance has App Engine authorized network

**Memorystore Connection Issues**:
- Verify VPC connector is created and configured
- Check Memorystore private IP is correct
- Verify VPC connector is in same region as App Engine and Memorystore
- Check `vpc_access_connector.name` in app.yaml files matches your connector

**Service Not Receiving Requests**:
- Verify `dispatch.yaml` is deployed: `gcloud app deploy dispatch.yaml`
- Check service names in dispatch.yaml match actual service names
- Verify URL patterns in dispatch.yaml are correct (order matters)
- Check service logs for routing errors

**WebSocket Connection Issues**:
- **IMPORTANT**: App Engine Standard does NOT natively support WebSockets
- Consider using App Engine Flexible or Cloud Run for full WebSocket support
- If using Standard, WebSocket connections may not work properly
- Verify WebSocket service is deployed and running
- Check Redis pub/sub is working (worker publishes, WebSocket subscribes)
- Verify WebSocket service has Redis connection configured
- Consider using HTTP polling or Server-Sent Events (SSE) as alternatives

**Worker Not Processing Jobs**:
- Verify worker service is deployed and running
- Check Redis connection in worker service
- Verify queue concurrency and rate limit settings
- Check worker logs for errors: `gcloud app logs tail -s worker-service`

#### Scaling

**Horizontal Scaling**:
- API, WebSocket, and Health services use automatic scaling (configured in app.yaml)
- Worker service uses basic scaling (2 fixed instances in worker-app.yaml)
- Adjust `min_instances` and `max_instances` in app.yaml files as needed
- Standard environment supports scaling to zero for non-critical services (set `min_instances: 0`)

**Vertical Scaling**:
- Adjust `instance_class` in app.yaml files (F1, F2, F4, F4_HIGHMEM, etc.)
- F1: 256MB memory, F2: 512MB, F4: 1GB, F4_HIGHMEM: 2GB
- Increase `QUEUE_CONCURRENCY` and `QUEUE_RATE_LIMIT` for more throughput
- Scale Cloud SQL and Memorystore instances in GCP Console

#### Security

- **Secrets Management**: All sensitive credentials (DATABASE_URL, REDIS_URL) are stored in Google Cloud Secret Manager, not in YAML files
- **Service Account Access**: App Engine default service account has minimal permissions (roles/secretmanager.secretAccessor) to access secrets
- **Runtime Secret Loading**: Application automatically fetches secrets from Secret Manager at runtime (see `src/utils/secrets.ts`)
- **No Hardcoded Credentials**: YAML files contain no passwords or connection strings with credentials
- **Cloud SQL Private IP**: Configured via Unix socket for secure connections
- **Memorystore Private IP**: Configured via VPC connector for secure connections
- **IAM Best Practices**: Use principle of least privilege for secret access
- **Secret Rotation**: Secrets can be rotated in Secret Manager without redeploying the application
- **Audit Logging**: Enable Secret Manager audit logs to monitor secret access
- Regularly update dependencies and GCP service versions

#### Cost Optimization

**Redis Memorystore Costs:**
- Basic tier, 1 GB size: ~$30-35/month (same for DIRECT_PEERING or PRIVATE_SERVICE_ACCESS)
- **No difference in Redis cost** between connection modes
- Intra-region network traffic: Free
- Inter-region traffic: ~$0.02/GiB (avoid by keeping all resources in same region)

**VPC Access Connector Costs:**
- ~$7-8/month minimum (charged per connector, regardless of traffic)
- **Required** for App Engine Flexible to access Memorystore private IPs (both DIRECT_PEERING and PRIVATE_SERVICE_ACCESS modes)
- Minimum instances: 2 (charged even if not used)

**Additional Optimizations:**
- Use `db-f1-micro` tier for Cloud SQL (development)
- Set `min_num_instances=0` for non-critical App Engine services (API, WebSocket) - instances scale to zero during no traffic
- Keep worker service at `max_instances=2` (basic scaling) for consistent queue processing
- Use `target_cpu_utilization=0.7-0.8` to control scaling aggressiveness
- Set `min_instances=0` for non-critical services (API, WebSocket, Health) - instances scale to zero during no traffic
- Standard environment supports scaling to zero, reducing costs during idle periods
- Use appropriate `instance_class` (F1 for lightweight services, F2 for normal, F4_HIGHMEM for memory-intensive workers)
- Ensure all resources (App Engine, Redis, Cloud SQL, VPC Connector) are in the same region to avoid inter-region egress charges
- **Standard Environment Benefits**: Faster cold starts, automatic scaling to zero, lower base costs, fully managed
- **Standard Environment Limitations**: No native WebSocket support, limited instance classes, requires HTTP server for all services
- Consider using Cloud Run for better cost control, pay-per-use pricing, and full WebSocket support (future migration)

### Option 2: Railway (Recommended)

Railway provides seamless deployment with automatic PostgreSQL and Redis services.

1. **Connect Repository**
   - Sign up at [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository

2. **Add Services**
   - Click "New" → "Database" → "PostgreSQL"
   - Click "New" → "Database" → "Redis"

3. **Configure Environment Variables**
   - Go to your service settings
   - Add environment variables:
     - `DATABASE_URL` (from PostgreSQL service)
     - `REDIS_URL` (from Redis service)
     - `NODE_ENV=production`
     - `PORT=3000`

4. **Deploy**
   - Railway automatically deploys on push to main branch
   - Or manually trigger deployment from dashboard

5. **Run Migrations**
   - Use Railway's CLI or connect to service:
   ```bash
   railway run npm run db:migrate
   ```

### Option 2: Render

Render offers free tier with PostgreSQL and Redis support.

1. **Create Web Service**
   - Sign up at [render.com](https://render.com)
   - Click "New" → "Web Service"
   - Connect your GitHub repository

2. **Configure Build**
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - Environment: `Node`

3. **Add PostgreSQL**
   - Click "New" → "PostgreSQL"
   - Note the connection string

4. **Add Redis**
   - Click "New" → "Redis"
   - Note the connection URL

5. **Set Environment Variables**
   - In your web service settings:
     - `DATABASE_URL` (from PostgreSQL)
     - `REDIS_URL` (from Redis)
     - `NODE_ENV=production`
     - `PORT=3000`

6. **Deploy**
   - Render automatically deploys on push
   - First deployment may take a few minutes

7. **Run Migrations**
   - Use Render shell or SSH:
   ```bash
   npm run db:migrate
   ```

### Option 3: Fly.io

Fly.io provides global deployment with PostgreSQL and Redis.

1. **Install Fly CLI**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Login**
   ```bash
   flyctl auth login
   ```

3. **Initialize**
   ```bash
   flyctl launch
   ```

4. **Create PostgreSQL**
   ```bash
   flyctl postgres create
   ```

5. **Create Redis**
   ```bash
   flyctl redis create
   ```

6. **Set Secrets**
   ```bash
   flyctl secrets set DATABASE_URL=<postgres-url>
   flyctl secrets set REDIS_URL=<redis-url>
   flyctl secrets set NODE_ENV=production
   ```

7. **Deploy**
   ```bash
   flyctl deploy
   ```

8. **Run Migrations**
   ```bash
   flyctl ssh console
   npm run db:migrate
   ```

## Health Checks

After deployment, verify all services:

```bash
# Overall health
curl https://your-domain.com/health

# Database
curl https://your-domain.com/health/db

# Redis
curl https://your-domain.com/health/redis

# Queue
curl https://your-domain.com/health/queue
```

## Monitoring

### Logs

- Railway: View logs in dashboard
- Render: View logs in service dashboard
- Fly.io: `flyctl logs`

### Metrics

Monitor:
- Queue depth (waiting/active jobs)
- Order processing rate
- Error rates
- Database connection pool
- Redis memory usage

## Troubleshooting

### Cloud Build Permission Error

If you encounter this error during deployment:
```
ERROR: (gcloud.app.deploy) Error Response: [13] Failed to create cloud build: ... 
service account does not have access to the bucket "staging.PROJECT_ID.appspot.com"
```

**Solution:**

1. Enable Cloud Build API (if not already enabled):
```bash
gcloud services enable cloudbuild.googleapis.com
```

2. Grant the Compute Engine default service account access to Cloud Build:
```bash
# Get project ID and project number
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe ${PROJECT_ID} --format="value(projectNumber)")

# Grant Compute Engine default service account access to Cloud Build
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.builder"

# Grant App Engine default service account access to Cloud Build
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.builder"

# Grant Cloud Build service account access to App Engine
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/appengine.deployer"

# Grant Cloud Build service account access to App Engine storage
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

**Alternative:** If the above doesn't work, try using your user account for the initial deployment:

```bash
# Deploy using your user account (instead of service account)
gcloud app deploy app.yaml --quiet --no-promote
```

### Database Connection Issues

- Verify `DATABASE_URL` is correct
- Check database firewall rules
- Ensure database is accessible from deployment platform

### Redis Connection Issues

- Verify `REDIS_URL` is correct
- Check Redis authentication
- Ensure Redis is accessible

### Queue Not Processing

- Check worker is running
- Verify Redis connection
- Check queue health endpoint
- Review worker logs

### WebSocket Not Working

- Verify WebSocket upgrade header is sent
- Check reverse proxy configuration (if using)
- Ensure WebSocket connections are not blocked
- **Note**: App Engine Standard does NOT natively support WebSockets. Consider using App Engine Flexible or Cloud Run for full WebSocket support.

## Scaling

### Horizontal Scaling

- Deploy multiple instances behind load balancer
- Ensure Redis is shared across instances
- Use sticky sessions for WebSocket connections (or use Redis pub/sub)

### Vertical Scaling

- Increase `QUEUE_CONCURRENCY` for more parallel processing
- Increase `QUEUE_RATE_LIMIT` for higher throughput
- Scale database and Redis resources

## Backup

### Database

- Set up automated PostgreSQL backups
- Test restore procedures regularly

### Redis

- Configure Redis persistence (RDB or AOF)
- Consider Redis replication for high availability

## Security

- Use environment variables for secrets
- Enable SSL/TLS for all connections
- Restrict database and Redis access
- Use strong passwords
- Regularly update dependencies
- Monitor for security vulnerabilities
