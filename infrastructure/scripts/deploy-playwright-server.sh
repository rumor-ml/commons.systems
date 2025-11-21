#!/bin/bash
# Deploy Playwright server to Cloud Run
# Usage: deploy-playwright-server.sh <commit-sha>
# Example: deploy-playwright-server.sh "abc123"

set -e

COMMIT_SHA="${1}"
REGION="${GCP_REGION:-us-central1}"
PROJECT_ID="${GCP_PROJECT_ID:-chalanding}"
SERVICE_NAME="playwright-server"
REGISTRY="${REGION}-docker.pkg.dev"

if [ -z "$COMMIT_SHA" ]; then
  echo "Error: COMMIT_SHA is required"
  echo "Usage: $0 <commit-sha>"
  exit 1
fi

echo "=== Deploying Playwright Server ==="
echo "Commit: $COMMIT_SHA"
echo "Service: $SERVICE_NAME"

# Build Docker image
IMAGE_TAG="${REGISTRY}/${PROJECT_ID}/${SERVICE_NAME}/${SERVICE_NAME}:${COMMIT_SHA}"
IMAGE_LATEST="${REGISTRY}/${PROJECT_ID}/${SERVICE_NAME}/${SERVICE_NAME}:latest"

echo "Building Docker image: $IMAGE_TAG"
docker build \
  -t "$IMAGE_TAG" \
  -t "$IMAGE_LATEST" \
  -f playwright-server/Dockerfile \
  .

echo "Pushing Docker image"
docker push "$IMAGE_TAG"
docker push "$IMAGE_LATEST"

# Deploy to Cloud Run
echo "Deploying to Cloud Run: $SERVICE_NAME"
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE_LATEST" \
  --platform=managed \
  --region="$REGION" \
  --allow-unauthenticated \
  --service-account="${SERVICE_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --timeout=900 \
  --cpu=1 \
  --memory=4Gi \
  --min-instances=0 \
  --max-instances=1 \
  --concurrency=5 \
  --set-env-vars=NODE_ENV=production

# Get service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --platform=managed \
  --region="$REGION" \
  --format='value(status.url)')

echo "✅ Playwright server deployed successfully!"
echo "Service URL: $SERVICE_URL"
echo "$SERVICE_URL" > /tmp/playwright-server-url.txt
