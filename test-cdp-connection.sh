#!/bin/bash
# Test CDP connection to playwright-server
set -e

PLAYWRIGHT_SERVER_URL="https://playwright-server-4yac44qrwa-uc.a.run.app"

echo "=== Testing CDP Connection ==="
echo "Playwright Server: $PLAYWRIGHT_SERVER_URL"
echo ""

# Test 1: Health check
echo "[1/4] Testing health endpoint..."
HEALTH=$(curl -sf "$PLAYWRIGHT_SERVER_URL/health" | jq -r '.status + " - v" + .version + " - Browser: " + (.browserActive|tostring)')
if [ $? -eq 0 ]; then
  echo "✅ $HEALTH"
else
  echo "❌ Health check failed"
  exit 1
fi

# Test 2: Get access token (requires GCP credentials)
echo ""
echo "[2/4] Getting authentication token..."
if [ -z "$GOOGLE_APPLICATION_CREDENTIALS_JSON" ]; then
  echo "⚠️  GOOGLE_APPLICATION_CREDENTIALS_JSON not set (OK for local testing)"
  echo "   This test requires CI environment"
  exit 0
fi

CURRENT_ACCOUNT=$(gcloud config get-value account 2>/dev/null)
echo "   GCP Account: $CURRENT_ACCOUNT"

ACCESS_TOKEN=$(gcloud auth print-access-token 2>&1)
if [ $? -ne 0 ]; then
  echo "❌ Failed to get access token"
  exit 1
fi

# Test 3: Get OIDC token
echo ""
echo "[3/4] Creating ID token..."
OIDC_TOKEN_RESPONSE=$(curl -s -X POST \
  "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${CURRENT_ACCOUNT}:generateIdToken" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"audience\": \"${PLAYWRIGHT_SERVER_URL}\", \"includeEmail\": true}")

OIDC_TOKEN=$(echo "$OIDC_TOKEN_RESPONSE" | jq -r '.token // empty')
if [ -z "$OIDC_TOKEN" ] || [ "$OIDC_TOKEN" = "null" ]; then
  echo "❌ Failed to create ID token"
  echo "   Response: $OIDC_TOKEN_RESPONSE"
  exit 1
fi
echo "✅ ID token obtained"

# Test 4: Get CDP endpoint
echo ""
echo "[4/4] Getting CDP endpoint..."
CDP_RESPONSE=$(curl -sf \
  -H "Authorization: Bearer $OIDC_TOKEN" \
  "${PLAYWRIGHT_SERVER_URL}/api/cdp-endpoint")

if [ $? -ne 0 ]; then
  echo "❌ Failed to get CDP endpoint"
  echo "   Response: $CDP_RESPONSE"
  exit 1
fi

CDP_URL=$(echo "$CDP_RESPONSE" | jq -r '.cdpUrl')
SESSION_ID=$(echo "$CDP_RESPONSE" | jq -r '.sessionId')

echo "✅ CDP URL: $CDP_URL"
echo "✅ Session ID: $SESSION_ID"

echo ""
echo "=== All Connection Tests Passed ✅ ==="
