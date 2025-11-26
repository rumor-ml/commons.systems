#!/bin/bash
# Run Playwright E2E tests against deployed site using remote browser server
# Usage: run-playwright-tests.sh <site-name> <site-url> <playwright-server-url>
#
# This script handles the Workload Identity Federation token exchange needed in CI
# to authenticate with the Playwright browser server.

set -e

SITE_NAME="${1}"
SITE_URL="${2}"
PLAYWRIGHT_SERVER_URL="${3}"

if [ -z "$SITE_NAME" ] || [ -z "$SITE_URL" ] || [ -z "$PLAYWRIGHT_SERVER_URL" ]; then
  echo "Usage: $0 <site-name> <site-url> <playwright-server-url>"
  exit 1
fi

echo "=== Playwright E2E Tests: $SITE_NAME ==="
echo "Site: $SITE_URL"
echo "Browser Server: $PLAYWRIGHT_SERVER_URL"

# --- Verify site is accessible ---
echo "Checking site availability..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SITE_URL" || echo "000")
if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "304" ]; then
  echo "❌ Site not accessible (HTTP $HTTP_CODE): $SITE_URL"
  exit 1
fi
echo "✅ Site accessible"

# --- Get OIDC token via WIF (Workload Identity Federation) ---
# This uses the IAM Credentials API to generate an ID token for the service account
echo "Getting OIDC token..."
SA_EMAIL=$(gcloud config get-value account 2>/dev/null)
ACCESS_TOKEN=$(gcloud auth print-access-token)

OIDC_RESPONSE=$(curl -s -X POST \
  "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SA_EMAIL}:generateIdToken" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"audience\": \"${PLAYWRIGHT_SERVER_URL}\", \"includeEmail\": true}")

OIDC_TOKEN=$(echo "$OIDC_RESPONSE" | jq -r '.token // empty')
if [ -z "$OIDC_TOKEN" ] || [ "$OIDC_TOKEN" = "null" ]; then
  echo "❌ Failed to get OIDC token"
  echo "$OIDC_RESPONSE"
  exit 1
fi
echo "✅ OIDC token obtained"

# --- Get browser WebSocket endpoint (with retry for Cloud Run cold start) ---
echo "Getting browser endpoint..."
MAX_RETRIES=5
RETRY_DELAY=2

for attempt in $(seq 1 $MAX_RETRIES); do
  HTTP_STATUS=$(curl -s -o /tmp/browser-response.txt -w "%{http_code}" \
    -H "Authorization: Bearer $OIDC_TOKEN" \
    --max-time 30 \
    "${PLAYWRIGHT_SERVER_URL}/api/browser-endpoint")

  if [ "$HTTP_STATUS" = "200" ]; then
    BROWSER_RESPONSE=$(cat /tmp/browser-response.txt)
    break
  elif [ "$HTTP_STATUS" = "429" ]; then
    if [ $attempt -lt $MAX_RETRIES ]; then
      echo "⏳ Server cold start (HTTP 429), retrying in ${RETRY_DELAY}s... (attempt $attempt/$MAX_RETRIES)"
      sleep $RETRY_DELAY
      RETRY_DELAY=$((RETRY_DELAY * 2))
    else
      echo "❌ Failed to get browser endpoint after $MAX_RETRIES attempts (HTTP 429 - Cloud Run cold start)"
      echo "   Check Cloud Run scaling settings: maxScale/minScale"
      exit 1
    fi
  else
    echo "❌ Failed to get browser endpoint (HTTP $HTTP_STATUS)"
    cat /tmp/browser-response.txt 2>/dev/null
    exit 1
  fi
done

WS_ENDPOINT=$(echo "$BROWSER_RESPONSE" | jq -r '.wsEndpoint')
if [ -z "$WS_ENDPOINT" ] || [ "$WS_ENDPOINT" = "null" ]; then
  echo "❌ Failed to parse browser endpoint from response"
  echo "$BROWSER_RESPONSE"
  exit 1
fi
echo "✅ Browser endpoint: $WS_ENDPOINT"

# --- Run tests ---
echo "Running tests..."
cd "${SITE_NAME}/tests"

PLAYWRIGHT_WS_ENDPOINT="$WS_ENDPOINT" \
DEPLOYED=true \
DEPLOYED_URL="$SITE_URL" \
CI=true \
npx playwright test --project chromium

echo "✅ Tests passed: $SITE_NAME"
