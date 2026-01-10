#!/bin/bash
# Inject Firebase web app configuration into site
# Usage: inject-firebase-config.sh <site-name>

# TODO(#434): Improve error handling in Firebase deployment infrastructure scripts
set -e

SITE_NAME="${1}"

if [ -z "$SITE_NAME" ]; then
  echo "Error: SITE_NAME is required"
  echo "Usage: $0 <site-name>"
  exit 1
fi

echo "=== Injecting Firebase configuration for $SITE_NAME ==="

# Get Firebase web app config
# First, list web apps to find the app ID
WEB_APPS=$(curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://firebase.googleapis.com/v1beta1/projects/chalanding/webApps")

# Check if any web apps exist
APP_COUNT=$(echo "$WEB_APPS" | jq -r '.apps | length // 0')

if [ "$APP_COUNT" -eq 0 ]; then
  echo "⚠️  No Firebase web app found. Creating one..."

  # Create a new web app
  CREATE_RESPONSE=$(curl -s -X POST \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "Content-Type: application/json" \
    -d "{\"displayName\": \"Fellspiral Web App\"}" \
    "https://firebase.googleapis.com/v1beta1/projects/chalanding/webApps")

  # Extract the app name (format: projects/{project}/webApps/{appId})
  APP_NAME=$(echo "$CREATE_RESPONSE" | jq -r '.name')

  if [ -z "$APP_NAME" ] || [ "$APP_NAME" = "null" ]; then
    echo "❌ Failed to create web app"
    echo "Response: $CREATE_RESPONSE"
    exit 1
  fi

  echo "✅ Created web app: $APP_NAME"

  # Wait for the app to be ready with exponential backoff
  echo "⏳ Waiting for web app to be ready..."
  MAX_WAIT=15
  DELAY=1
  START_TIME=$(date +%s)

  while true; do
    ELAPSED=$(($(date +%s) - START_TIME))
    if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
      echo "❌ Web app not ready after ${MAX_WAIT}s"
      exit 1
    fi

    # Try to fetch the config - if it works, the app is ready
    TEST_CONFIG=$(curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
      "https://firebase.googleapis.com/v1beta1/${APP_NAME}/config" 2>/dev/null || echo "{}")
    TEST_API_KEY=$(echo "$TEST_CONFIG" | jq -r '.apiKey // empty')

    if [ -n "$TEST_API_KEY" ]; then
      echo "✅ Web app is ready (${ELAPSED}s)"
      break
    fi

    echo "  Waiting for web app... (${ELAPSED}s/${MAX_WAIT}s)"
    sleep "$DELAY"

    # Exponential backoff (cap at 4s)
    if [ "$DELAY" -lt 4 ]; then
      DELAY=$((DELAY * 2))
    fi
  done
else
  # Use the first web app
  APP_NAME=$(echo "$WEB_APPS" | jq -r '.apps[0].name')
  echo "✅ Found existing web app: $APP_NAME"
fi

# Get the web app configuration
CONFIG_RESPONSE=$(curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://firebase.googleapis.com/v1beta1/${APP_NAME}/config")

# Extract configuration values
API_KEY=$(echo "$CONFIG_RESPONSE" | jq -r '.apiKey')
AUTH_DOMAIN=$(echo "$CONFIG_RESPONSE" | jq -r '.authDomain')
PROJECT_ID=$(echo "$CONFIG_RESPONSE" | jq -r '.projectId')
STORAGE_BUCKET=$(echo "$CONFIG_RESPONSE" | jq -r '.storageBucket')
MESSAGING_SENDER_ID=$(echo "$CONFIG_RESPONSE" | jq -r '.messagingSenderId')
APP_ID=$(echo "$CONFIG_RESPONSE" | jq -r '.appId')

# Override storage bucket for sites that use rml-media
# videobrowser and print both use the rml-media bucket with shared storage rules
if [ "$SITE_NAME" = "videobrowser" ] || [ "$SITE_NAME" = "print" ]; then
  STORAGE_BUCKET="rml-media"
  echo "  Using rml-media bucket for $SITE_NAME"
fi

# Validate we got the config
if [ -z "$API_KEY" ] || [ "$API_KEY" = "null" ]; then
  echo "❌ Failed to get Firebase configuration"
  echo "Response: $CONFIG_RESPONSE"
  exit 1
fi

echo "✅ Retrieved Firebase configuration"
echo "  API Key: ${API_KEY:0:20}..."
echo "  Project ID: $PROJECT_ID"
echo "  Auth Domain: $AUTH_DOMAIN"

# Update the firebase-config.js file
CONFIG_FILE="${SITE_NAME}/site/src/firebase-config.js"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "⚠️  Configuration file not found: $CONFIG_FILE"
  echo "⚠️  Skipping Firebase config injection (app doesn't use Firebase SDK)"
  exit 0
fi

# Create the new configuration
cat > "$CONFIG_FILE" << EOF
/**
 * Firebase Configuration for ${SITE_NAME^}
 *
 * This configuration is safe to expose publicly as it only identifies
 * the Firebase project. Access control is managed via Firestore security
 * rules (firestore.rules).
 *
 * Auto-generated during CI/CD deployment
 */

export const firebaseConfig = {
  apiKey: "${API_KEY}",
  authDomain: "${AUTH_DOMAIN}",
  projectId: "${PROJECT_ID}",
  storageBucket: "${STORAGE_BUCKET}",
  messagingSenderId: "${MESSAGING_SENDER_ID}",
  appId: "${APP_ID}"
};
EOF

echo "✅ Firebase configuration injected into $CONFIG_FILE"
