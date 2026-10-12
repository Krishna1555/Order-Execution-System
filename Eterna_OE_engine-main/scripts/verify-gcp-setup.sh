#!/bin/bash
# GCP Deployment Verification Script
# Checks if your GCP setup is ready for deployment

set -e

PROJECT_ID=$(gcloud config get-value project 2>/dev/null || echo "NOT_SET")

echo "========================================="
echo "GCP Deployment Verification"
echo "========================================="
echo "Project ID: ${PROJECT_ID}"
echo ""

# Check if gcloud is authenticated
echo "[1] Checking gcloud authentication..."
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
  echo "  [ERROR] Not authenticated with gcloud. Run: gcloud auth login"
  exit 1
fi
echo "  [OK] Authenticated"

# Check if project is set
if [ "${PROJECT_ID}" = "NOT_SET" ]; then
  echo "  [ERROR] Project ID not set. Run: gcloud config set project YOUR_PROJECT_ID"
  exit 1
fi
echo "  [OK] Project ID set: ${PROJECT_ID}"

# Check required APIs
echo ""
echo "[2] Checking required APIs..."
APIS=(
  "appengine.googleapis.com"
  "cloudbuild.googleapis.com"
  "sqladmin.googleapis.com"
  "redis.googleapis.com"
  "vpcaccess.googleapis.com"
  "secretmanager.googleapis.com"
)

for api in "${APIS[@]}"; do
  if gcloud services list --enabled --filter="name:${api}" --format="value(name)" | grep -q "${api}"; then
    echo "  [OK] ${api}"
  else
    echo "  [WARN] ${api} not enabled. Run: gcloud services enable ${api}"
  fi
done

# Check Secret Manager secrets
echo ""
echo "[3] Checking Secret Manager secrets..."
if gcloud secrets describe database-url --format="value(name)" >/dev/null 2>&1; then
  echo "  [OK] database-url secret exists"
  # Check if it has data
  if gcloud secrets versions access latest --secret=database-url >/dev/null 2>&1; then
    echo "  [OK] database-url secret has data"
  else
    echo "  [WARN] database-url secret exists but has no data"
  fi
else
  echo "  [ERROR] database-url secret not found. Create it first."
fi

if gcloud secrets describe redis-url --format="value(name)" >/dev/null 2>&1; then
  echo "  [OK] redis-url secret exists"
  # Check if it has data
  if gcloud secrets versions access latest --secret=redis-url >/dev/null 2>&1; then
    echo "  [OK] redis-url secret has data"
  else
    echo "  [WARN] redis-url secret exists but has no data"
  fi
else
  echo "  [ERROR] redis-url secret not found. Create it first."
fi

# Check service account permissions
echo ""
echo "[4] Checking service account permissions..."
SERVICE_ACCOUNT="${PROJECT_ID}@appspot.gserviceaccount.com"

if gcloud secrets get-iam-policy database-url --format="value(bindings.members)" 2>/dev/null | grep -q "${SERVICE_ACCOUNT}"; then
  echo "  [OK] Service account has access to database-url"
else
  echo "  [ERROR] Service account does NOT have access to database-url"
  echo "    Run: gcloud secrets add-iam-policy-binding database-url --member=\"serviceAccount:${SERVICE_ACCOUNT}\" --role=\"roles/secretmanager.secretAccessor\""
fi

if gcloud secrets get-iam-policy redis-url --format="value(bindings.members)" 2>/dev/null | grep -q "${SERVICE_ACCOUNT}"; then
  echo "  [OK] Service account has access to redis-url"
else
  echo "  [ERROR] Service account does NOT have access to redis-url"
  echo "    Run: gcloud secrets add-iam-policy-binding redis-url --member=\"serviceAccount:${SERVICE_ACCOUNT}\" --role=\"roles/secretmanager.secretAccessor\""
fi

# Check Cloud SQL
echo ""
echo "[5] Checking Cloud SQL instances..."
if gcloud sql instances list --format="value(name)" | grep -q .; then
  echo "  [OK] Cloud SQL instances found:"
  gcloud sql instances list --format="table(name,region,databaseVersion,state)"
else
  echo "  [WARN] No Cloud SQL instances found"
fi

# Check Redis/Memorystore
echo ""
echo "[6] Checking Redis/Memorystore instances..."
if gcloud redis instances list --format="value(name)" 2>/dev/null | grep -q .; then
  echo "  [OK] Redis instances found:"
  gcloud redis instances list --format="table(name,region,tier,memorySizeGb,host,state)"
else
  echo "  [WARN] No Redis instances found"
fi

# Check VPC Connectors
echo ""
echo "[7] Checking VPC Access Connectors..."
REGIONS=$(gcloud compute networks vpc-access connectors list --format="value(region)" 2>/dev/null | sort -u)
if [ -z "${REGIONS}" ]; then
  echo "  [WARN] No VPC connectors found. If using Memorystore private IP, you need a VPC connector."
else
  echo "  [OK] VPC connectors found in regions:"
  for region in ${REGIONS}; do
    echo "    - ${region}:"
    gcloud compute networks vpc-access connectors list --filter="region:${region}" --format="table(name,region,network,ipCidrRange,state)"
  done
fi

# Check App Engine
echo ""
echo "[8] Checking App Engine application..."
if gcloud app describe --format="value(name)" >/dev/null 2>&1; then
  APP_REGION=$(gcloud app describe --format="value(locationId)")
  echo "  [OK] App Engine application exists"
  echo "    Region: ${APP_REGION}"
else
  echo "  [WARN] App Engine application not created yet"
  echo "    Run: gcloud app create --region=YOUR_REGION"
fi

# Summary
echo ""
echo "========================================="
echo "Summary"
echo "========================================="
echo "If all checks passed [OK], you're ready to deploy!"
echo "If you see [ERROR] or [WARN], fix those issues first."
echo ""
echo "Next steps:"
echo "  1. Fix any [ERROR] items above"
echo "  2. Review [WARN] items and fix if needed"
echo "  3. Run: npm run build"
echo "  4. Run: gcloud app deploy app.yaml websocket-app.yaml health-app.yaml worker-app.yaml dispatch.yaml"
echo ""
