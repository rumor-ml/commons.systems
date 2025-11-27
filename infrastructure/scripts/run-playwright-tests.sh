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
if ! HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 --max-time 30 "$SITE_URL" 2>&1); then
  echo "❌ Network error reaching $SITE_URL"
  echo "   Possible causes: DNS failure, connection timeout, SSL error, or network unreachable"
  exit 1
fi
if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "304" ]; then
  if [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
    echo "❌ Site returned redirect (HTTP $HTTP_CODE). Expected direct response: $SITE_URL"
  elif [ "$HTTP_CODE" -ge "400" ] && [ "$HTTP_CODE" -lt "500" ]; then
    echo "❌ Client error (HTTP $HTTP_CODE): $SITE_URL"
  elif [ "$HTTP_CODE" -ge "500" ]; then
    echo "❌ Server error (HTTP $HTTP_CODE): $SITE_URL"
  else
    echo "❌ Unexpected response (HTTP $HTTP_CODE): $SITE_URL"
  fi
  exit 1
fi
echo "✅ Site accessible"

# --- Run tests ---
echo "Running tests..."
TEST_DIR="${SITE_NAME}/tests"
if [ ! -d "$TEST_DIR" ]; then
  echo "❌ Test directory not found: $TEST_DIR"
  echo "   Valid sites: fellspiral, videobrowser, audiobrowser, print, printsync"
  exit 1
fi
cd "$TEST_DIR"

if DEPLOYED=true DEPLOYED_URL="$SITE_URL" CI=true npx playwright test --project chromium; then
  echo "✅ Tests passed: $SITE_NAME"
else
  TEST_EXIT_CODE=$?
  echo "❌ Playwright tests failed for $SITE_NAME (exit code: $TEST_EXIT_CODE)"
  exit $TEST_EXIT_CODE
fi
