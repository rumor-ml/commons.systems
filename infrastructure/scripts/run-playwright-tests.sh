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

# Get OIDC token for authentication
echo "Getting authentication token..."

# When using Workload Identity Federation, we need to get the currently authenticated account
CURRENT_ACCOUNT=$(gcloud config get-value account 2>/dev/null)
echo "Current GCP account: $CURRENT_ACCOUNT"

# Get identity token for the Playwright server audience
# For Workload Identity Federation, don't specify audience - let the server validate
OIDC_TOKEN=$(gcloud auth print-identity-token 2>&1)

# Check if command failed
if [ $? -ne 0 ]; then
  echo "❌ Failed to get OIDC token"
  echo "Error: $OIDC_TOKEN"
  echo "Attempting to print more debug info..."
  gcloud auth list
  exit 1
fi

if [ -z "$OIDC_TOKEN" ]; then
  echo "❌ OIDC token is empty"
  exit 1
fi

echo "✅ Authentication token obtained"

# Get authenticated CDP endpoint from proxy
echo "Getting authenticated CDP endpoint..."
CDP_RESPONSE=$(curl -sf \
  -H "Authorization: Bearer $OIDC_TOKEN" \
  "${PLAYWRIGHT_SERVER_URL}/api/cdp-endpoint")

if [ $? -ne 0 ]; then
  echo "❌ Failed to get CDP endpoint"
  echo "Response: $CDP_RESPONSE"
  exit 1
fi

CDP_URL=$(echo "$CDP_RESPONSE" | jq -r '.cdpUrl')
SESSION_ID=$(echo "$CDP_RESPONSE" | jq -r '.sessionId')

if [ -z "$CDP_URL" ] || [ "$CDP_URL" = "null" ]; then
  echo "❌ Failed to parse CDP URL"
  echo "Response: $CDP_RESPONSE"
  exit 1
fi

echo "✅ CDP endpoint: $CDP_URL"
echo "✅ Session ID: $SESSION_ID (expires in 10 minutes)"

# Run tests locally, connecting to remote browser via CDP
echo "Running tests for $SITE_NAME (tests run locally, browsers run remotely via secure CDP proxy)..."
cd "${SITE_NAME}/tests"

export PLAYWRIGHT_CDP_URL="$CDP_URL"
export DEPLOYED=true
export DEPLOYED_URL="$SITE_URL"
export CI=true

npx playwright test --project chromium --workers 4

echo "✅ Playwright tests passed for $SITE_NAME"
