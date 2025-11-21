#!/bin/bash
# Debug script for videobrowser deployment issues
set -e

PROJECT_ID="${GCP_PROJECT_ID:-chalanding}"
BUCKET_NAME="rml-media"
VIDEO_PREFIX="video/"
REGION="us-central1"
SERVICE_NAME="videobrowser-site"

echo "========================================"
echo "Video Browser Diagnostic Tool"
echo "========================================"
echo ""

# Get access token
source "$(dirname "$0")/get_gcp_token.sh" 2>/dev/null
if [ -z "$GCP_ACCESS_TOKEN" ]; then
    echo "❌ Failed to get GCP access token"
    exit 1
fi

echo "✓ GCP authentication successful"
echo ""

# Check if videobrowser service exists
echo "[1/6] Checking Cloud Run service..."
SERVICE_RESPONSE=$(curl -s -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
    "https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/services/$SERVICE_NAME" 2>&1)

if echo "$SERVICE_RESPONSE" | grep -q "\"error\""; then
    echo "❌ Service '$SERVICE_NAME' not found in region $REGION"
    echo "   Make sure the service has been deployed"
    exit 1
fi

SERVICE_URL=$(echo "$SERVICE_RESPONSE" | python3 -c "import sys, json; data = json.load(sys.stdin); print(data.get('uri', 'N/A'))" 2>/dev/null || echo "N/A")
echo "✓ Service URL: $SERVICE_URL"
echo ""

# Check if rml-media bucket exists
echo "[2/6] Checking GCS bucket '$BUCKET_NAME'..."
BUCKET_RESPONSE=$(curl -s -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
    "https://storage.googleapis.com/storage/v1/b/$BUCKET_NAME?project=$PROJECT_ID")

if echo "$BUCKET_RESPONSE" | grep -q "\"error\""; then
    echo "❌ Bucket '$BUCKET_NAME' not found"
    echo "   Error: $(echo "$BUCKET_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('error', {}).get('message', 'Unknown error'))")"
    exit 1
fi

echo "✓ Bucket '$BUCKET_NAME' exists"
echo ""

# List videos in bucket
echo "[3/6] Checking for videos in '$VIDEO_PREFIX'..."
OBJECTS_RESPONSE=$(curl -s -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
    "https://storage.googleapis.com/storage/v1/b/$BUCKET_NAME/o?prefix=$VIDEO_PREFIX&delimiter=/")

if echo "$OBJECTS_RESPONSE" | grep -q "\"error\""; then
    echo "❌ Failed to list objects in bucket"
    echo "   Error: $(echo "$OBJECTS_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('error', {}).get('message', 'Unknown error'))")"
    exit 1
fi

# Count video files
VIDEO_COUNT=$(echo "$OBJECTS_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('items', [])
video_exts = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v']
videos = [item for item in items if any(item.get('name', '').lower().endswith(ext) for ext in video_exts)]
print(len(videos))
")

if [ "$VIDEO_COUNT" -eq 0 ]; then
    echo "⚠️  No videos found in 'gs://$BUCKET_NAME/$VIDEO_PREFIX'"
    echo ""
    echo "   Available objects:"
    echo "$OBJECTS_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('items', [])
if not items:
    print('     (none)')
else:
    for item in items[:10]:
        print(f'     - {item.get(\"name\", \"?\")}')
    if len(items) > 10:
        print(f'     ... and {len(items) - 10} more')
"
    echo ""
    echo "👉 Upload videos to gs://$BUCKET_NAME/$VIDEO_PREFIX to see them in the browser"
else
    echo "✓ Found $VIDEO_COUNT video file(s)"
    echo ""
    echo "   Videos:"
    echo "$OBJECTS_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('items', [])
video_exts = ['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.m4v']
videos = [item for item in items if any(item.get('name', '').lower().endswith(ext) for ext in video_exts)]
for video in videos[:10]:
    size_mb = int(video.get('size', 0)) / (1024 * 1024)
    print(f'     - {video.get(\"name\", \"?\")} ({size_mb:.1f} MB)')
if len(videos) > 10:
    print(f'     ... and {len(videos) - 10} more')
"
fi
echo ""

# Check Firebase Storage rules
echo "[4/6] Checking Firebase Storage rules..."
RULESETS_RESPONSE=$(curl -s -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    "https://firebaserules.googleapis.com/v1/projects/$PROJECT_ID/releases")

if echo "$RULESETS_RESPONSE" | grep -q "\"error\""; then
    echo "⚠️  Could not fetch Firebase rules (Firebase may not be initialized)"
    echo "   Error: $(echo "$RULESETS_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('error', {}).get('message', 'Unknown error'))" 2>/dev/null || echo "Unknown")"
else
    STORAGE_RELEASE=$(echo "$RULESETS_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
releases = data.get('releases', [])
storage_releases = [r for r in releases if 'firebase.storage' in r.get('name', '')]
if storage_releases:
    print(storage_releases[0].get('name', 'N/A'))
else:
    print('')
" 2>/dev/null)

    if [ -n "$STORAGE_RELEASE" ]; then
        echo "✓ Firebase Storage rules are deployed"
    else
        echo "⚠️  No Firebase Storage rules found - deploy may be needed"
    fi
fi
echo ""

# Check Firebase Web App configuration
echo "[5/6] Checking Firebase Web App configuration..."
APPS_RESPONSE=$(curl -s -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
    -H "x-goog-user-project: $PROJECT_ID" \
    "https://firebase.googleapis.com/v1beta1/projects/$PROJECT_ID/webApps")

if echo "$APPS_RESPONSE" | grep -q "\"error\""; then
    echo "⚠️  Could not fetch Firebase web apps"
else
    APP_COUNT=$(echo "$APPS_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('apps', [])))")
    if [ "$APP_COUNT" -gt 0 ]; then
        echo "✓ Found $APP_COUNT Firebase web app(s)"
    else
        echo "⚠️  No Firebase web apps found - may need to run deployment workflow"
    fi
fi
echo ""

# Check Cloud Run logs for errors
echo "[6/6] Checking recent Cloud Run logs..."
LOGS_RESPONSE=$(curl -s -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -X POST "https://logging.googleapis.com/v2/entries:list" \
    -d "{
        \"resourceNames\": [\"projects/$PROJECT_ID\"],
        \"filter\": \"resource.type=\\\"cloud_run_revision\\\" AND resource.labels.service_name=\\\"$SERVICE_NAME\\\" AND severity>=WARNING\",
        \"orderBy\": \"timestamp desc\",
        \"pageSize\": 10
    }")

ERROR_COUNT=$(echo "$LOGS_RESPONSE" | python3 -c "import sys, json; print(len(json.load(sys.stdin).get('entries', [])))" 2>/dev/null || echo "0")

if [ "$ERROR_COUNT" -gt 0 ]; then
    echo "⚠️  Found $ERROR_COUNT recent warning/error log entries:"
    echo ""
    echo "$LOGS_RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for entry in data.get('entries', [])[:5]:
    severity = entry.get('severity', 'UNKNOWN')
    timestamp = entry.get('timestamp', 'N/A')
    text = entry.get('textPayload', entry.get('jsonPayload', {}).get('message', 'N/A'))
    print(f'   [{severity}] {timestamp}')
    print(f'   {text}')
    print()
" 2>/dev/null || echo "   (Could not parse logs)"
else
    echo "✓ No recent errors in Cloud Run logs"
fi
echo ""

# Summary
echo "========================================"
echo "Summary"
echo "========================================"
echo ""
echo "Service URL: $SERVICE_URL"
echo "Videos found: $VIDEO_COUNT"
echo ""

if [ "$VIDEO_COUNT" -eq 0 ]; then
    echo "🔍 LIKELY ISSUE: No videos in the bucket"
    echo ""
    echo "   To add videos, run:"
    echo "   gsutil cp your-video.mp4 gs://$BUCKET_NAME/$VIDEO_PREFIX"
    echo ""
    echo "   Or use the GCP Console:"
    echo "   https://console.cloud.google.com/storage/browser/$BUCKET_NAME/$VIDEO_PREFIX?project=$PROJECT_ID"
else
    echo "✓ Videos are present in the bucket"
    echo ""
    echo "   If the browser still shows 0 videos:"
    echo "   1. Open browser console at $SERVICE_URL"
    echo "   2. Check for Firebase errors"
    echo "   3. Verify the Firebase API key is correctly injected"
    echo "   4. Check CORS/network errors"
fi

echo ""
echo "For more details, visit the deployed site:"
echo "$SERVICE_URL"
