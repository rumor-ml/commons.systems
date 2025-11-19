#!/bin/bash
set -euo pipefail

# Fellspiral Deployment Script
# Deploys the static site to GCP Cloud Storage

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT="${ENVIRONMENT:-production}"
DRY_RUN="${DRY_RUN:-false}"

# Load configuration
if [ -f "$SCRIPT_DIR/.env" ]; then
  source "$SCRIPT_DIR/.env"
fi

# Check required variables
if [ -z "${GCP_PROJECT_ID:-}" ]; then
  echo -e "${RED}Error: GCP_PROJECT_ID not set${NC}"
  echo "Set it in infrastructure/scripts/.env or as an environment variable"
  exit 1
fi

if [ -z "${BUCKET_NAME:-}" ]; then
  BUCKET_NAME="${GCP_PROJECT_ID}-fellspiral-site"
fi

echo -e "${GREEN}Fellspiral Deployment${NC}"
echo "Environment: $ENVIRONMENT"
echo "Project: $GCP_PROJECT_ID"
echo "Bucket: $BUCKET_NAME"
echo ""

# Build the site
echo -e "${YELLOW}Building site...${NC}"
cd "$PROJECT_ROOT/fellspiral/site"
npm install
npm run build

# Check if build was successful
if [ ! -d "dist" ]; then
  echo -e "${RED}Error: Build failed - dist directory not found${NC}"
  exit 1
fi

echo -e "${GREEN}Build successful!${NC}"

# Deploy to GCS
if [ "$DRY_RUN" = "true" ]; then
  echo -e "${YELLOW}DRY RUN: Would deploy to gs://${BUCKET_NAME}${NC}"
  echo "Files to deploy:"
  find dist -type f
else
  echo -e "${YELLOW}Deploying to GCS...${NC}"

  # Sync files to bucket
  gsutil -m rsync -r -d \
    -x ".*\.map$" \
    dist/ "gs://${BUCKET_NAME}/"

  # Set cache control headers
  echo -e "${YELLOW}Setting cache headers...${NC}"

  # HTML files - no cache
  gsutil -m setmeta -h "Cache-Control:no-cache,max-age=0" \
    "gs://${BUCKET_NAME}/**/*.html"

  # CSS/JS files - long cache (with versioning)
  gsutil -m setmeta -h "Cache-Control:public,max-age=31536000,immutable" \
    "gs://${BUCKET_NAME}/**/*.css"

  gsutil -m setmeta -h "Cache-Control:public,max-age=31536000,immutable" \
    "gs://${BUCKET_NAME}/**/*.js"

  # Images - long cache
  gsutil -m setmeta -h "Cache-Control:public,max-age=31536000" \
    "gs://${BUCKET_NAME}/**/*.{png,jpg,jpeg,gif,svg,webp,ico}"

  echo -e "${GREEN}Deployment successful!${NC}"
  echo ""
  echo "Site URL: http://${BUCKET_NAME}.storage.googleapis.com"

  if [ -n "${SITE_IP:-}" ]; then
    echo "Load Balancer URL: http://${SITE_IP}"
  fi
fi

# Invalidate CDN cache (if CDN is configured)
if [ -n "${CDN_ENABLED:-}" ] && [ "$CDN_ENABLED" = "true" ] && [ "$DRY_RUN" != "true" ]; then
  echo -e "${YELLOW}Invalidating CDN cache...${NC}"
  gcloud compute url-maps invalidate-cdn-cache fellspiral-url-map \
    --path "/*" \
    --project "$GCP_PROJECT_ID" \
    --async
  echo -e "${GREEN}Cache invalidation initiated${NC}"
fi

echo ""
echo -e "${GREEN}Done!${NC}"
