#!/usr/bin/env bash
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
  print)
    FIREBASE_SITE_ID="print-dfb47"
    ;;
  budget)
    FIREBASE_SITE_ID="budget-81cb7"
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

# Log Firebase CLI version for diagnostics
FIREBASE_VERSION=$(firebase --version 2>/dev/null || echo "unknown")
echo "Firebase CLI: $FIREBASE_VERSION"

# Warn if using known buggy version
if [[ "$FIREBASE_VERSION" == *"13.32.0"* ]]; then
  echo "⚠️  WARNING: firebase-tools 13.32.0 has known 404 deployment bugs"
  echo "   See: https://github.com/firebase/firebase-tools/issues/8274"
fi

echo "========================================="
echo ""

# Inject Firebase configuration
echo "🔐 Injecting Firebase configuration..."
"$(dirname "$0")/inject-firebase-config.sh" "$SITE_NAME"
echo ""

# Build the site
echo "📦 Building ${SITE_NAME}..."
pnpm --dir "${SITE_NAME}/site" build

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

  # Deploy only hosting (storage rules are deployed separately in the workflow)
  firebase deploy \
    --only hosting:${FIREBASE_SITE_ID} \
    --project chalanding \
    --message "Deploy ${SITE_NAME} from ${BRANCH_NAME}@${COMMIT_SHA:0:7}"

  # Get production URL
  DEPLOYMENT_URL="https://${FIREBASE_SITE_ID}.web.app"

  # Save deployment URL for GitHub Actions
  echo "$DEPLOYMENT_URL" > /tmp/deployment-url.txt

  echo ""
  echo "✅ Production deployment complete!"
  echo "🌐 URL: ${DEPLOYMENT_URL}"

else
  # Preview channel deployment
  echo "🔍 Deploying to preview channel..."

  # Clean up stale channels first to avoid quota errors
  echo "🧹 Running cleanup to avoid quota issues..."
  "$(dirname "$0")/cleanup-stale-channels.sh" "$SITE_NAME" "$BRANCH_NAME" || {
    echo "⚠️  Cleanup failed but continuing with deployment"
  }

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

  # Note: Storage rules are deployed separately in the Main/PR Pipeline workflow
  # for sites that need them (videobrowser, print)

  # Deploy to preview channel (creates if doesn't exist, expires after 7 days by default)
  echo "Running: firebase hosting:channel:deploy ${CHANNEL_NAME} --only ${FIREBASE_SITE_ID}"
  echo "Debug: Site ID = ${FIREBASE_SITE_ID}, Channel = ${CHANNEL_NAME}"

  # Retry deployment up to 3 times on health check failure
  MAX_ATTEMPTS=3
  ATTEMPT=1
  DEPLOYMENT_SUCCESS=false

  while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    echo ""
    echo "🔄 Deployment attempt $ATTEMPT of $MAX_ATTEMPTS..."

    # Run Firebase deployment with error handling
    echo "::group::Firebase Deployment Output (Attempt $ATTEMPT)"
    set +e  # Disable exit on error to capture exit code
    firebase hosting:channel:deploy "$CHANNEL_NAME" \
      --only ${FIREBASE_SITE_ID} \
      --project chalanding \
      --expires 7d \
      2>&1 | tee /tmp/firebase-deploy-output.txt
    FIREBASE_EXIT_CODE=${PIPESTATUS[0]}
    set -e  # Re-enable exit on error
    echo "::endgroup::"

    # Check Firebase CLI exit code first
    if [ $FIREBASE_EXIT_CODE -ne 0 ]; then
      echo "::error::Firebase CLI exited with code $FIREBASE_EXIT_CODE"
      echo "Firebase output:"
      cat /tmp/firebase-deploy-output.txt

      # Provide specific error context based on common failure patterns
      if grep -qi "permission denied\|unauthorized" /tmp/firebase-deploy-output.txt; then
        echo "::error::Authentication failure - check FIREBASE_TOKEN or credentials"
      elif grep -qi "quota exceeded\|rate limit" /tmp/firebase-deploy-output.txt; then
        echo "::error::Rate limit or quota exceeded"
      elif grep -qi "not found\|does not exist" /tmp/firebase-deploy-output.txt; then
        echo "::error::Site or project not found - check FIREBASE_SITE_ID: ${FIREBASE_SITE_ID}"
      fi
      exit 1
    fi

    # Check if deployment was successful by looking for success indicators
    if grep -q "Channel URL" /tmp/firebase-deploy-output.txt; then
      # Extract URL from output like: "Channel URL (site): https://site--channel.web.app [expires ...]"
      DEPLOYMENT_URL=$(grep "Channel URL" /tmp/firebase-deploy-output.txt | grep -oE 'https://[^ \[]+' | head -1)
    else
      echo "::error::Firebase deployment succeeded but output format unexpected"
      echo "Expected 'Channel URL' in output but not found"
      echo "Firebase output:"
      cat /tmp/firebase-deploy-output.txt
      exit 1
    fi

    if [ -z "$DEPLOYMENT_URL" ]; then
      echo "❌ CRITICAL: Could not extract deployment URL from Firebase output"
      echo "This indicates deployment may have failed or CLI format changed."
      echo "Firebase output:"
      cat /tmp/firebase-deploy-output.txt
      exit 1
    fi

    echo ""
    echo "✅ Preview deployment complete!"
    echo "🔍 Preview URL: ${DEPLOYMENT_URL}"
    echo "⏰ Expires: 7 days from now"

    # Save deployment URL immediately for GitHub Actions retry workflow
    # This must happen BEFORE health checks so retry workflow has the URL even if checks fail
    echo "$DEPLOYMENT_URL" > /tmp/deployment-url.txt
    echo "📝 Saved deployment URL to /tmp/deployment-url.txt for retry workflow"

    # Verify the deployment is accessible with exponential backoff
    echo ""
    echo "🔍 Verifying deployment readiness..."

    SCRIPT_DIR="$(dirname "$0")"
    set +e  # Disable exit on error to capture health check result
    "$SCRIPT_DIR/health-check.sh" "${DEPLOYMENT_URL}" \
      --exponential \
      --max-wait 200 \
      --content "</html>" \
      --verbose
    HEALTH_CHECK_EXIT_CODE=$?
    set -e  # Re-enable exit on error

    if [ $HEALTH_CHECK_EXIT_CODE -eq 0 ]; then
      DEPLOYMENT_SUCCESS=true
      break
    else
      echo ""
      echo "⚠️  Health check failed on attempt $ATTEMPT"

      if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
        echo "🔄 Retrying deployment..."
        ATTEMPT=$((ATTEMPT + 1))
      else
        echo "❌ All $MAX_ATTEMPTS deployment attempts failed"
        exit 1
      fi
    fi
  done

  if [ "$DEPLOYMENT_SUCCESS" = false ]; then
    echo "❌ Deployment failed after $MAX_ATTEMPTS attempts"
    exit 1
  fi
fi

# Note: Deployment URL is saved earlier in both production and preview paths
# to ensure retry workflow has access to it even if health checks fail

echo ""
echo "========================================="
echo "Deployment Summary"
echo "========================================="
echo "Site: $SITE_NAME"
echo "Type: $([ "$BRANCH_NAME" = "main" ] && echo "Production" || echo "Preview")"
echo "URL: $DEPLOYMENT_URL"
echo "========================================="
