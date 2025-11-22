#!/bin/bash
# Deploy a site to Cloud Run
# Usage: deploy-site.sh <site-name> <branch> <commit-sha>
# Example: deploy-site.sh "fellspiral" "main" "abc123"
# Example: deploy-site.sh "videobrowser" "feature/my-feature" "abc123"

set -e

SITE_NAME="${1}"
BRANCH="${2}"
COMMIT_SHA="${3}"
REGION="${GCP_REGION:-us-central1}"
PROJECT_ID="${GCP_PROJECT_ID:-chalanding}"

if [ -z "$SITE_NAME" ] || [ -z "$BRANCH" ] || [ -z "$COMMIT_SHA" ]; then
  echo "Error: SITE_NAME, BRANCH, and COMMIT_SHA are required"
  echo "Usage: $0 <site-name> <branch> <commit-sha>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Determine if this is a production or preview deployment
if [ "$BRANCH" == "main" ]; then
  IS_PRODUCTION=true
  SERVICE_NAME="${SITE_NAME}-site"
  ARTIFACT_REGISTRY_REPO="${SITE_NAME}-production"
  ENV_TYPE="production"
else
  IS_PRODUCTION=false
  # Generate service name from branch
  SANITIZED_BRANCH=$("$SCRIPT_DIR/sanitize-branch-name.sh" "$BRANCH" "$SITE_NAME")
  SERVICE_NAME="$SANITIZED_BRANCH"
  ARTIFACT_REGISTRY_REPO="${SITE_NAME}-previews"
  ENV_TYPE="preview"
fi

echo "=== Deploying $SITE_NAME ==="
echo "Branch: $BRANCH"
echo "Service: $SERVICE_NAME"
echo "Environment: $ENV_TYPE"
echo "Registry: $ARTIFACT_REGISTRY_REPO"

# Create Artifact Registry repository if not exists
if ! gcloud artifacts repositories describe "$ARTIFACT_REGISTRY_REPO" \
  --location="$REGION" \
  --project="$PROJECT_ID" 2>/dev/null; then
  echo "Creating Artifact Registry repository: $ARTIFACT_REGISTRY_REPO"
  gcloud artifacts repositories create "$ARTIFACT_REGISTRY_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="${SITE_NAME} ${ENV_TYPE} images" \
    --project="$PROJECT_ID"
else
  echo "Artifact Registry repository already exists: $ARTIFACT_REGISTRY_REPO"
fi

# Build image names
IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY_REPO}/${SERVICE_NAME}:${COMMIT_SHA}"
IMAGE_LATEST="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY_REPO}/${SERVICE_NAME}:latest"

# Build and push Docker image
echo "Building Docker image: $IMAGE_NAME"

if [ "$IS_PRODUCTION" == "true" ]; then
  # Production: simpler build
  # Build from repo root with Dockerfile in site directory to access workspace deps
  docker build \
    -f "${SITE_NAME}/site/Dockerfile" \
    -t "$IMAGE_NAME" \
    -t "$IMAGE_LATEST" \
    --build-arg SITE_DIR="${SITE_NAME}/site" \
    .
else
  # Preview: use cache
  CACHE_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REGISTRY_REPO}/cache:latest"
  docker build \
    -f "${SITE_NAME}/site/Dockerfile" \
    --cache-from="$CACHE_IMAGE" \
    --build-arg BUILDKIT_INLINE_CACHE=1 \
    --build-arg SITE_DIR="${SITE_NAME}/site" \
    -t "$IMAGE_NAME" \
    -t "$IMAGE_LATEST" \
    .
  # Push cache image (don't fail if this fails)
  docker push "$CACHE_IMAGE" || true
fi

echo "Pushing Docker image: $IMAGE_NAME"
docker push "$IMAGE_NAME"
docker push "$IMAGE_LATEST"

# Prepare labels
if [ "$IS_PRODUCTION" == "true" ]; then
  LABELS="environment=production,commit=${COMMIT_SHA}"
else
  # Sanitize branch name for label
  LABEL_SAFE_BRANCH=$(echo "$BRANCH" | tr '[:upper:]' '[:lower:]' | tr '/' '-' | sed 's/[^a-z0-9_-]//g' | cut -c1-63)
  LABELS="preview=true,site=${SITE_NAME},branch=${LABEL_SAFE_BRANCH},commit=${COMMIT_SHA}"
fi

# Deploy to Cloud Run
echo "Deploying to Cloud Run: $SERVICE_NAME"
gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE_NAME" \
  --platform=managed \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --allow-unauthenticated \
  --cpu=1 \
  --memory=512Mi \
  --min-instances=0 \
  --max-instances=$([ "$IS_PRODUCTION" == "true" ] && echo "10" || echo "1") \
  --timeout=300 \
  --port=8080 \
  --set-env-vars="ENVIRONMENT=${ENV_TYPE},COMMIT_SHA=${COMMIT_SHA}$([ "$IS_PRODUCTION" == "false" ] && echo ",BRANCH_NAME=${BRANCH}")" \
  --labels="$LABELS" \
  --quiet

# Get and return service URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format='value(status.url)')

echo "✅ Deployment successful!"
echo "Service URL: $SERVICE_URL"
echo "$SERVICE_URL" > /tmp/deployment-url.txt
