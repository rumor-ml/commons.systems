#!/bin/bash
# Deploy Playwright server to Cloud Run
# Usage: deploy-playwright-server.sh <commit-sha> [branch-name]
# Example: deploy-playwright-server.sh "abc123" "main"
# Example: deploy-playwright-server.sh "abc123" "feature/my-feature"

set -e

COMMIT_SHA="${1}"
BRANCH_NAME="${2:-main}"
REGION="${GCP_REGION:-us-central1}"
PROJECT_ID="${GCP_PROJECT_ID:-chalanding}"
REGISTRY="${REGION}-docker.pkg.dev"

# Determine service name based on branch
# Main branch uses "playwright-server", feature branches use "playwright-server-<sanitized-branch>"
if [ "$BRANCH_NAME" = "main" ]; then
  SERVICE_NAME="playwright-server"
else
  # Sanitize branch name for Cloud Run (lowercase, replace / and _ with -, max 63 chars)
  SANITIZED_BRANCH=$(echo "$BRANCH_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[/_]/-/g' | cut -c1-40)
  SERVICE_NAME="playwright-server-${SANITIZED_BRANCH}"
fi

if [ -z "$COMMIT_SHA" ]; then
  echo "Error: COMMIT_SHA is required"
  echo "Usage: $0 <commit-sha> [branch-name]"
  exit 1
fi

echo "=== Deploying Playwright Server ==="
echo "Branch: $BRANCH_NAME"
echo "Commit: $COMMIT_SHA"
echo "Service: $SERVICE_NAME"

# Build Docker image
# Use shared repository "playwright-server" for all branches
REPO_NAME="playwright-server"
IMAGE_TAG="${REGISTRY}/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:${COMMIT_SHA}"
IMAGE_LATEST="${REGISTRY}/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:latest"

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

# Use the main playwright-server service account for all deployments
SERVICE_ACCOUNT="playwright-server@${PROJECT_ID}.iam.gserviceaccount.com"

# First deployment to get the URL
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE_LATEST" \
  --platform=managed \
  --region="$REGION" \
  --allow-unauthenticated \
  --service-account="$SERVICE_ACCOUNT" \
  --timeout=900 \
  --cpu=1 \
  --memory=4Gi \
  --min-instances=0 \
  --max-instances=1 \
  --concurrency=80 \
  --set-env-vars=NODE_ENV=production,GCP_PROJECT_ID="$PROJECT_ID"

# Get service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --platform=managed \
  --region="$REGION" \
  --format='value(status.url)')

echo "Service URL: $SERVICE_URL"

# Update deployment with PLAYWRIGHT_SERVER_URL for OIDC token validation
echo "Updating service with PLAYWRIGHT_SERVER_URL environment variable..."
gcloud run services update "$SERVICE_NAME" \
  --platform=managed \
  --region="$REGION" \
  --set-env-vars=NODE_ENV=production,GCP_PROJECT_ID="$PROJECT_ID",PLAYWRIGHT_SERVER_URL="$SERVICE_URL"

echo "✅ Playwright server deployed successfully!"
echo "Service: $SERVICE_NAME"
echo "URL: $SERVICE_URL"
echo "$SERVICE_URL" > /tmp/playwright-server-url.txt
