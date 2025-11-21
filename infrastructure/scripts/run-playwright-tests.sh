#!/bin/bash
# Run Playwright tests against a deployed site
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

# Run tests via remote Playwright server
echo "Running tests via remote Playwright server..."
cd playwright-server
node run-tests.js --project chromium --workers 4 --deployed

echo "✅ Playwright tests passed for $SITE_NAME"
