#!/bin/bash
# Deploy site to Firebase Hosting
# Supports both production and preview channel deployments
#
# Usage:
#   ./deploy-firebase-hosting.sh <site-name> <branch-name> [commit-sha]
#
# Examples:
#   ./deploy-firebase-hosting.sh fellspiral main abc123
#   ./deploy-firebase-hosting.sh videobrowser feature-auth xyz789

set -e

SITE_NAME="${1}"
BRANCH_NAME="${2}"
COMMIT_SHA="${3:-$(git rev-parse HEAD)}"

if [ -z "$SITE_NAME" ] || [ -z "$BRANCH_NAME" ]; then
  echo "Usage: $0 <site-name> <branch-name> [commit-sha]"
  echo "Example: $0 fellspiral main abc123"
  exit 1
fi

echo "========================================="
echo "Firebase Hosting Deployment"
echo "========================================="
echo "Site: $SITE_NAME"
echo "Branch: $BRANCH_NAME"
echo "Commit: $COMMIT_SHA"
echo "========================================="
echo ""

# Build the site
echo "📦 Building ${SITE_NAME}..."
npm run build --workspace="${SITE_NAME}/site"

# Check if build succeeded
if [ ! -d "${SITE_NAME}/site/dist" ]; then
  echo "❌ Build failed: dist directory not found"
  exit 1
fi

echo "✅ Build complete"
echo ""

# Determine deployment type (production vs preview)
if [ "$BRANCH_NAME" = "main" ]; then
  # Production deployment
  echo "🚀 Deploying to production..."

  firebase deploy \
    --only hosting:${SITE_NAME} \
    --project chalanding \
    --message "Deploy ${SITE_NAME} from ${BRANCH_NAME}@${COMMIT_SHA:0:7}"

  # Get production URL
  DEPLOYMENT_URL="https://${SITE_NAME}.web.app"

  echo ""
  echo "✅ Production deployment complete!"
  echo "🌐 URL: ${DEPLOYMENT_URL}"

else
  # Preview channel deployment
  echo "🔍 Deploying to preview channel..."

  # Sanitize branch name for channel name (lowercase, alphanumeric, hyphens only, max 63 chars)
  # Firebase channel names: lowercase letters, numbers, hyphens (no consecutive hyphens)
  CHANNEL_NAME=$(echo "$BRANCH_NAME" | \
    tr '[:upper:]' '[:lower:]' | \
    sed 's/[^a-z0-9-]/-/g' | \
    sed 's/-\+/-/g' | \
    sed 's/^-//' | \
    sed 's/-$//' | \
    cut -c1-63)

  echo "Preview channel: ${CHANNEL_NAME}"

  # Deploy to preview channel (creates if doesn't exist, expires after 7 days by default)
  firebase hosting:channel:deploy "$CHANNEL_NAME" \
    --only ${SITE_NAME} \
    --project chalanding \
    --expires 7d \
    --json > /tmp/firebase-deploy-output.json

  # Extract URL from JSON output
  DEPLOYMENT_URL=$(cat /tmp/firebase-deploy-output.json | grep -o '"url":"[^"]*"' | cut -d'"' -f4 | head -1)

  if [ -z "$DEPLOYMENT_URL" ]; then
    # Fallback: construct URL manually
    DEPLOYMENT_URL="https://${CHANNEL_NAME}--${SITE_NAME}.web.app"
  fi

  echo ""
  echo "✅ Preview deployment complete!"
  echo "🔍 Preview URL: ${DEPLOYMENT_URL}"
  echo "⏰ Expires: 7 days from now"
fi

# Save deployment URL for GitHub Actions
echo "$DEPLOYMENT_URL" > /tmp/deployment-url.txt

echo ""
echo "========================================="
echo "Deployment Summary"
echo "========================================="
echo "Site: $SITE_NAME"
echo "Type: $([ "$BRANCH_NAME" = "main" ] && echo "Production" || echo "Preview")"
echo "URL: $DEPLOYMENT_URL"
echo "========================================="
