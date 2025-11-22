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

# Test Playwright server health with retry logic
echo "Testing Playwright server health..."
MAX_RETRIES=5
RETRY_DELAY=2

for i in $(seq 1 $MAX_RETRIES); do
  if curl -f "${PLAYWRIGHT_SERVER_URL}/health"; then
    echo "✅ Playwright server is healthy"
    break
  else
    EXIT_CODE=$?
    if [ $i -lt $MAX_RETRIES ]; then
      echo "⚠️  Health check failed (attempt $i/$MAX_RETRIES), retrying in ${RETRY_DELAY}s..."
      sleep $RETRY_DELAY
      RETRY_DELAY=$((RETRY_DELAY * 2))  # Exponential backoff
    else
      echo "❌ Playwright server is not responding after $MAX_RETRIES attempts"
      exit 1
    fi
  fi
done

# Get OIDC token for authentication
echo "Getting authentication token..."

# When using Workload Identity Federation, we need to get the currently authenticated account
CURRENT_ACCOUNT=$(gcloud config get-value account 2>/dev/null)
echo "Current GCP account: $CURRENT_ACCOUNT"

# For Workload Identity Federation, create an ID token using the Service Account Credentials API
# This requires the service account to have the roles/iam.serviceAccountTokenCreator role
echo "Creating ID token via Service Account Credentials API..."

# Use curl to call the Service Account Credentials API
SA_EMAIL="$CURRENT_ACCOUNT"
ACCESS_TOKEN=$(gcloud auth print-access-token 2>&1)

if [ $? -ne 0 ] || [ -z "$ACCESS_TOKEN" ]; then
  echo "❌ Failed to get access token"
  echo "Error: $ACCESS_TOKEN"
  gcloud auth list
  exit 1
fi

# Call the generateIdToken API
OIDC_TOKEN_RESPONSE=$(curl -s -X POST \
  "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SA_EMAIL}:generateIdToken" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"audience\": \"${PLAYWRIGHT_SERVER_URL}\", \"includeEmail\": true}")

# Extract token from response
OIDC_TOKEN=$(echo "$OIDC_TOKEN_RESPONSE" | jq -r '.token // empty')

if [ -z "$OIDC_TOKEN" ] || [ "$OIDC_TOKEN" = "null" ]; then
  echo "❌ Failed to create ID token"
  echo "Response: $OIDC_TOKEN_RESPONSE"
  exit 1
fi

echo "✅ Authentication token obtained"

# Get authenticated browser endpoint from server with retry logic
echo "Getting browser server endpoint..."
MAX_RETRIES=5
RETRY_DELAY=2

for i in $(seq 1 $MAX_RETRIES); do
  BROWSER_RESPONSE=$(curl -sf \
    -H "Authorization: Bearer $OIDC_TOKEN" \
    "${PLAYWRIGHT_SERVER_URL}/api/browser-endpoint")

  if [ $? -eq 0 ]; then
    WS_ENDPOINT=$(echo "$BROWSER_RESPONSE" | jq -r '.wsEndpoint')

    if [ -n "$WS_ENDPOINT" ] && [ "$WS_ENDPOINT" != "null" ]; then
      echo "✅ Browser endpoint: $WS_ENDPOINT"
      break
    else
      echo "❌ Failed to parse browser endpoint"
      echo "Response: $BROWSER_RESPONSE"
      exit 1
    fi
  else
    if [ $i -lt $MAX_RETRIES ]; then
      echo "⚠️  Failed to get browser endpoint (attempt $i/$MAX_RETRIES), retrying in ${RETRY_DELAY}s..."
      sleep $RETRY_DELAY
      RETRY_DELAY=$((RETRY_DELAY * 2))  # Exponential backoff
    else
      echo "❌ Failed to get browser endpoint after $MAX_RETRIES attempts"
      echo "Last response: $BROWSER_RESPONSE"
      exit 1
    fi
  fi
done

# Run tests locally, connecting to remote browser via Playwright's browser server
echo "Running tests for $SITE_NAME (tests run locally, browsers run remotely via Playwright browser server)..."
cd "${SITE_NAME}/tests"

export PLAYWRIGHT_WS_ENDPOINT="$WS_ENDPOINT"
export DEPLOYED=true
export DEPLOYED_URL="$SITE_URL"
export CI=true

# Run tests
npx playwright test --project chromium

echo "✅ Playwright tests passed for $SITE_NAME"
