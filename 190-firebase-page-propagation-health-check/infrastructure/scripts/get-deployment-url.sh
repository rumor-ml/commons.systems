#!/bin/bash
# Get deployment URL for a service
# Usage: get-deployment-url.sh <service-name> <region> <project-id> [branch]
# Example: get-deployment-url.sh "fellspiral-site" "us-central1" "chalanding" "main"

set -e

SERVICE_NAME="${1}"
REGION="${2}"
PROJECT_ID="${3}"
BRANCH="${4:-main}"

if [ -z "$SERVICE_NAME" ] || [ -z "$REGION" ] || [ -z "$PROJECT_ID" ]; then
  echo "Error: SERVICE_NAME, REGION, and PROJECT_ID are required"
  echo "Usage: $0 <service-name> <region> <project-id> [branch]"
  exit 1
fi

# For main branch, use the production service name
# For feature branches, the service name already includes the branch
if [ "$BRANCH" == "main" ]; then
  # Production deployment
  URL=$(gcloud run services describe "$SERVICE_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format='value(status.url)' 2>/dev/null || echo "")
else
  # Feature branch deployment
  URL=$(gcloud run services describe "$SERVICE_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format='value(status.url)' 2>/dev/null || echo "")
fi

if [ -z "$URL" ]; then
  echo "Error: Could not find deployment for service: $SERVICE_NAME"
  exit 1
fi

echo "$URL"
