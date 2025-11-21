#!/bin/bash
# Run Playwright tests locally against remote browsers
# Usage: run-playwright-tests.sh <site-name> <site-url> <playwright-server-url>
# Example: run-playwright-tests.sh "fellspiral" "https://example.com" "https://playwright.example.com"

set -e

SITE_NAME="${1}"
SITE_URL="${2}"
PLAYWRIGHT_SERVER_URL="${3}"

if [ -z "$SITE_NAME" ] || [ -z "$SITE_URL" ] || [ -z "$PLAYWRIGHT_SERVER_URL" ]; then
  echo "Error: SITE_NAME, SITE_URL, and PLAYWRIGHT_SERVER_URL are required"
  echo "Usage: $0 <site-name> <site-url> <playwright-server-url>"
  exit 1
fi

echo "=== Running Playwright tests for $SITE_NAME ==="
echo "Site URL: $SITE_URL"
echo "Playwright Server: $PLAYWRIGHT_SERVER_URL"

# Test Playwright server health
echo "Testing Playwright server health..."
curl -f "${PLAYWRIGHT_SERVER_URL}/health" || {
  echo "❌ Playwright server is not responding"
  exit 1
}
echo "✅ Playwright server is healthy"

# Get WebSocket endpoint from browser server
echo "Getting browser WebSocket endpoint..."
WS_RESPONSE=$(curl -sf "${PLAYWRIGHT_SERVER_URL}/ws")
WS_ENDPOINT=$(echo "$WS_RESPONSE" | jq -r '.wsEndpoint')

if [ -z "$WS_ENDPOINT" ] || [ "$WS_ENDPOINT" = "null" ]; then
  echo "❌ Failed to get WebSocket endpoint"
  echo "Response: $WS_RESPONSE"
  exit 1
fi

echo "✅ Browser WebSocket endpoint: $WS_ENDPOINT"

# Run tests locally, connecting to remote browser
echo "Running tests for $SITE_NAME (tests run locally, browsers run remotely)..."
cd "${SITE_NAME}/tests"

export PW_TEST_CONNECT_WS_ENDPOINT="$WS_ENDPOINT"
export DEPLOYED=true
export DEPLOYED_URL="$SITE_URL"
export CI=true

npx playwright test --project chromium --workers 4

echo "✅ Playwright tests passed for $SITE_NAME"
