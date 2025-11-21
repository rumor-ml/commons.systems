#!/bin/bash
#
# Verify Firebase Initialization Status
#

set -e

PROJECT_ID="${1:-chalanding}"

echo "Checking Firebase initialization for project: $PROJECT_ID"
echo ""

# Try to get Firebase project info
RESPONSE=$(curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID" -w "\n%{http_code}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Firebase IS initialized on this project!"
    echo ""
    echo "Project details:"
    echo "$BODY" | jq -r '{projectId, displayName, state}'
    echo ""

    # Try to list web apps
    echo "Checking for Firebase web apps..."
    APPS_RESPONSE=$(curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
      "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID/webApps")

    APP_COUNT=$(echo "$APPS_RESPONSE" | jq -r '.apps | length')
    if [ "$APP_COUNT" = "null" ] || [ "$APP_COUNT" = "0" ]; then
        echo "⚠️  No web apps found - workflow will create one automatically"
    else
        echo "✅ Found $APP_COUNT web app(s)"
        echo "$APPS_RESPONSE" | jq -r '.apps[] | "  - \(.displayName) (\(.appId))"'
    fi
else
    echo "❌ Firebase is NOT initialized on this project"
    echo ""
    echo "HTTP Status: $HTTP_CODE"
    echo "Response: $BODY" | jq '.' 2>/dev/null || echo "$BODY"
    echo ""
    echo "You need to initialize Firebase. Choose one option:"
    echo ""
    echo "Option 1: Initialize via Firebase Console"
    echo "  1. Go to: https://console.firebase.google.com/"
    echo "  2. Click 'Create a project' or 'Add project'"
    echo "  3. Select your existing GCP project '$PROJECT_ID' from the dropdown"
    echo "  4. Complete the setup wizard"
    echo ""
    echo "Option 2: Initialize programmatically (if you have permissions)"
    echo "  Run: curl -X POST -H \"Authorization: Bearer \$(gcloud auth print-access-token)\" \\"
    echo "    \"https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID:addFirebase\""
    echo ""
    exit 1
fi
