#!/bin/bash

# GCP App Engine Deployment Script
# Deploys all services sequentially: API, WebSocket, Health, Worker, and dispatch.yaml
# 
# Prerequisites:
# 1. Create secrets in Secret Manager before deployment:
#    gcloud secrets create database-url --data-file=- <<< "postgresql://USER:PASSWORD@/DATABASE?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME"
#    gcloud secrets create redis-url --data-file=- <<< "redis://MEMORYSTORE_PRIVATE_IP:6379"
# 2. Grant App Engine default service account access to secrets:
#    PROJECT_ID=$(gcloud config get-value project)
#    gcloud secrets add-iam-policy-binding database-url --member="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
#    gcloud secrets add-iam-policy-binding redis-url --member="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"

set -e  # Exit on error

echo "Starting GCP App Engine deployment..."

# Check if gcloud CLI is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI is not installed"
    echo "Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n 1 &> /dev/null; then
    echo "Error: Not authenticated with gcloud"
    echo "Please run: gcloud auth login"
    exit 1
fi

# Check if secrets exist (optional check - uncomment if you want to enforce this)
# if ! gcloud secrets describe database-url &> /dev/null; then
#     echo "Warning: Secret 'database-url' not found in Secret Manager"
#     echo "Create it with: gcloud secrets create database-url --data-file=FILE"
# fi
# if ! gcloud secrets describe redis-url &> /dev/null; then
#     echo "Warning: Secret 'redis-url' not found in Secret Manager"
#     echo "Create it with: gcloud secrets create redis-url --data-file=FILE"
# fi

# Build TypeScript first
echo "Building TypeScript..."
npm run build

if [ $? -ne 0 ]; then
    echo "Error: Build failed"
    exit 1
fi

# Deploy services in order
echo ""
echo "Deploying API service (default)..."
gcloud app deploy app.yaml --quiet

if [ $? -ne 0 ]; then
    echo "Error: API service deployment failed"
    exit 1
fi

echo ""
echo "Deploying WebSocket service..."
gcloud app deploy websocket-app.yaml --quiet

if [ $? -ne 0 ]; then
    echo "Error: WebSocket service deployment failed"
    exit 1
fi

echo ""
echo "Deploying Health service..."
gcloud app deploy health-app.yaml --quiet

if [ $? -ne 0 ]; then
    echo "Error: Health service deployment failed"
    exit 1
fi

echo ""
echo "Deploying Worker service..."
gcloud app deploy worker-app.yaml --quiet

if [ $? -ne 0 ]; then
    echo "Error: Worker service deployment failed"
    exit 1
fi

echo ""
echo "Deploying dispatch.yaml..."
gcloud app deploy dispatch.yaml --quiet

if [ $? -ne 0 ]; then
    echo "Error: dispatch.yaml deployment failed"
    exit 1
fi

echo ""
echo "Deployment completed successfully!"
echo ""
echo "Services deployed:"
echo "  - API service (default)"
echo "  - WebSocket service (websocket-service)"
echo "  - Health service (health-service)"
echo "  - Worker service (worker-service)"
echo ""
echo "View your app at: https://$(gcloud config get-value project).appspot.com"
echo ""
echo "To view logs:"
echo "  gcloud app logs tail -s default"
echo "  gcloud app logs tail -s websocket-service"
echo "  gcloud app logs tail -s health-service"
echo "  gcloud app logs tail -s worker-service"
