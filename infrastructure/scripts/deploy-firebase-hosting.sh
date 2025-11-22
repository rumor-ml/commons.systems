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

# Map site names to Firebase site IDs (some sites have different IDs due to reservation)
case "$SITE_NAME" in
  videobrowser)
    FIREBASE_SITE_ID="videobrowser-7696a"
    ;;
  *)
    FIREBASE_SITE_ID="$SITE_NAME"
    ;;
esac

echo "========================================="
echo "Firebase Hosting Deployment"
echo "========================================="
echo "Site: $SITE_NAME"
echo "Branch: $BRANCH_NAME"
echo "Commit: $COMMIT_SHA"
echo "========================================="
echo ""

# Inject Firebase configuration
echo "🔐 Injecting Firebase configuration..."
"$(dirname "$0")/inject-firebase-config.sh" "$SITE_NAME"
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
    --only hosting:${FIREBASE_SITE_ID} \
    --project chalanding \
    --message "Deploy ${SITE_NAME} from ${BRANCH_NAME}@${COMMIT_SHA:0:7}"

  # Get production URL
  DEPLOYMENT_URL="https://${FIREBASE_SITE_ID}.web.app"

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
  echo "Running: firebase hosting:channel:deploy ${CHANNEL_NAME} --only ${FIREBASE_SITE_ID}"
  echo "Debug: Site ID = ${FIREBASE_SITE_ID}, Channel = ${CHANNEL_NAME}"
  echo "Debug: Listing available sites first..."
  firebase hosting:sites:list --project chalanding 2>&1 || echo "Failed to list sites"

  # Run Firebase deployment and capture output to variable
  echo "Debug: Starting Firebase deployment..."
  DEPLOY_OUTPUT=$(firebase hosting:channel:deploy "$CHANNEL_NAME" \
    --only ${FIREBASE_SITE_ID} \
    --project chalanding \
    --expires 7d \
    --json 2>&1) || FIREBASE_EXIT_CODE=$?

  if [ -n "$FIREBASE_EXIT_CODE" ] && [ $FIREBASE_EXIT_CODE -ne 0 ]; then
    echo "❌ Firebase deployment failed with exit code: $FIREBASE_EXIT_CODE"
    echo "Output from Firebase CLI:"
    echo "$DEPLOY_OUTPUT"
    exit 1
  fi

  # Save output for URL extraction
  echo "$DEPLOY_OUTPUT" > /tmp/firebase-deploy-output.json

  # Extract URL from JSON output
  DEPLOYMENT_URL=$(echo "$DEPLOY_OUTPUT" | jq -r ".result.${FIREBASE_SITE_ID}.url // empty" 2>/dev/null)

  if [ -z "$DEPLOYMENT_URL" ]; then
    # Try alternative JSON path
    DEPLOYMENT_URL=$(cat /tmp/firebase-deploy-output.json | grep -o '"url":"[^"]*"' | cut -d'"' -f4 | head -1)
  fi

  if [ -z "$DEPLOYMENT_URL" ]; then
    # Fallback: construct URL manually
    DEPLOYMENT_URL="https://${FIREBASE_SITE_ID}--${CHANNEL_NAME}.web.app"
    echo "⚠️  Could not extract URL from Firebase output, using constructed URL"
  fi

  echo ""
  echo "✅ Preview deployment complete!"
  echo "🔍 Preview URL: ${DEPLOYMENT_URL}"
  echo "⏰ Expires: 7 days from now"

  # Verify the deployment is accessible
  echo ""
  echo "🔍 Verifying deployment..."
  sleep 5  # Give Firebase a moment to propagate

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${DEPLOYMENT_URL}" || echo "000")
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "304" ]; then
    echo "✅ Deployment verified (HTTP ${HTTP_CODE})"
  else
    echo "⚠️  Warning: Deployment may not be ready yet (HTTP ${HTTP_CODE})"
    echo "   URL: ${DEPLOYMENT_URL}"
    echo "   This may indicate DNS propagation delay or deployment issues"
  fi
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
