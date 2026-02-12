#!/usr/bin/env bash
# Inject Firebase web app configuration into site
# Usage: inject-firebase-config.sh <site-name>

# TODO(#434): Improve error handling in Firebase deployment infrastructure scripts
# TODO(#1960): Extract target file path into variable and reduce duplicate echo statements
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

# Validate all extracted configuration values
MISSING_FIELDS=()

if [ -z "$API_KEY" ] || [ "$API_KEY" = "null" ]; then
  MISSING_FIELDS+=("apiKey")
fi

if [ -z "$AUTH_DOMAIN" ] || [ "$AUTH_DOMAIN" = "null" ]; then
  MISSING_FIELDS+=("authDomain")
fi

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "null" ]; then
  MISSING_FIELDS+=("projectId")
fi

if [ -z "$STORAGE_BUCKET" ] || [ "$STORAGE_BUCKET" = "null" ]; then
  MISSING_FIELDS+=("storageBucket")
fi

if [ -z "$MESSAGING_SENDER_ID" ] || [ "$MESSAGING_SENDER_ID" = "null" ]; then
  MISSING_FIELDS+=("messagingSenderId")
fi

if [ -z "$APP_ID" ] || [ "$APP_ID" = "null" ]; then
  MISSING_FIELDS+=("appId")
fi

if [ ${#MISSING_FIELDS[@]} -gt 0 ]; then
  echo "❌ Failed to extract required Firebase configuration fields: ${MISSING_FIELDS[*]}"
  echo "Response: $CONFIG_RESPONSE"
  exit 1
fi

# Override storage bucket for sites that use rml-media
# videobrowser and print both use the rml-media bucket with shared storage rules
if [ "$SITE_NAME" = "videobrowser" ] || [ "$SITE_NAME" = "print" ]; then
  STORAGE_BUCKET="rml-media"
  echo "  Using rml-media bucket for $SITE_NAME"
fi

echo "✅ Retrieved Firebase configuration"
echo "  API Key: ${API_KEY:0:20}..."
echo "  Project ID: $PROJECT_ID"
echo "  Auth Domain: $AUTH_DOMAIN"

# Inject Firebase config based on app type
CONFIG_FILE="${SITE_NAME}/site/src/firebase-config.js"
ENV_FILE="${SITE_NAME}/site/.env"
ENV_EXAMPLE_FILE="${SITE_NAME}/site/.env.example"

# Helper function to validate file was written successfully
validate_file_written() {
  local file="$1"
  if [ ! -f "$file" ] || [ ! -s "$file" ]; then
    echo "❌ Failed to write Firebase configuration to $file"
    exit 1
  fi
}

# Pattern 1: Apps using firebase-config.js (legacy)
if [ -f "$CONFIG_FILE" ]; then
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

  validate_file_written "$CONFIG_FILE"
  TARGET_FILE="$CONFIG_FILE"

# Pattern 2: Apps using Vite .env files (e.g., budget)
elif [ -f "$ENV_EXAMPLE_FILE" ]; then
  cat > "$ENV_FILE" << EOF
# Firebase Configuration
# Auto-generated during CI/CD deployment

VITE_FIREBASE_API_KEY=${API_KEY}
VITE_FIREBASE_AUTH_DOMAIN=${AUTH_DOMAIN}
VITE_FIREBASE_PROJECT_ID=${PROJECT_ID}
VITE_FIREBASE_STORAGE_BUCKET=${STORAGE_BUCKET}
VITE_FIREBASE_MESSAGING_SENDER_ID=${MESSAGING_SENDER_ID}
VITE_FIREBASE_APP_ID=${APP_ID}
EOF

  validate_file_written "$ENV_FILE"
  TARGET_FILE="$ENV_FILE"

else
  echo "⚠️  No firebase-config.js or .env.example found in ${SITE_NAME}/site"
  echo "⚠️  Skipping Firebase config injection (app doesn't use Firebase SDK)"
  exit 0
fi

echo "✅ Firebase configuration injected into $TARGET_FILE"
