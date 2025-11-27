#!/bin/bash
# Run Playwright E2E tests against deployed site
# Usage: run-playwright-tests.sh <site-name> <site-url>

set -e

SITE_NAME="${1}"
SITE_URL="${2}"

if [ -z "$SITE_NAME" ] || [ -z "$SITE_URL" ]; then
  echo "Usage: $0 <site-name> <site-url>"
  exit 1
fi

echo "=== Playwright E2E Tests: $SITE_NAME ==="
echo "Site: $SITE_URL"

# --- Verify site is accessible ---
echo "Checking site availability..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SITE_URL" || echo "000")
if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "304" ]; then
  echo "❌ Site not accessible (HTTP $HTTP_CODE): $SITE_URL"
  exit 1
fi
echo "✅ Site accessible"

# --- Run tests ---
echo "Running tests..."
cd "${SITE_NAME}/tests"

DEPLOYED=true \
DEPLOYED_URL="$SITE_URL" \
CI=true \
npx playwright test --project chromium

echo "✅ Tests passed: $SITE_NAME"
