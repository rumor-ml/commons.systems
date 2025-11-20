#!/bin/bash
# Helper script to run Playwright tests against the deployed server
# This script automatically retrieves the server URL from Cloud Run

set -e

echo "🎭 Playwright Remote Test Runner"
echo "================================"
echo ""

# Check if gcloud is available
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI not found"
    echo ""
    echo "Please install gcloud or manually set the server URL:"
    echo "  export PLAYWRIGHT_SERVER_URL=https://playwright-server-xxxxx.run.app"
    echo "  ./playwright-server/run-tests.sh $@"
    echo ""
    echo "To get the URL from GCP:"
    echo "  gcloud run services describe playwright-server --region us-central1 --format 'value(status.url)'"
    exit 1
fi

# Get the server URL from Cloud Run
echo "📡 Retrieving Playwright server URL from Cloud Run..."
PLAYWRIGHT_SERVER_URL=$(gcloud run services describe playwright-server \
    --platform managed \
    --region us-central1 \
    --format 'value(status.url)' 2>&1)

if [ $? -ne 0 ]; then
    echo "❌ Failed to get server URL from Cloud Run"
    echo ""
    echo "$PLAYWRIGHT_SERVER_URL"
    echo ""
    echo "Make sure you're authenticated:"
    echo "  gcloud auth login"
    echo "  gcloud config set project chalanding"
    exit 1
fi

echo "✅ Server URL: $PLAYWRIGHT_SERVER_URL"
echo ""

# Test server health
echo "🏥 Checking server health..."
if ! curl -sf "$PLAYWRIGHT_SERVER_URL/health" > /dev/null; then
    echo "❌ Server is not responding or unhealthy"
    echo ""
    echo "Check the Cloud Run service status:"
    echo "  gcloud run services describe playwright-server --region us-central1"
    exit 1
fi

echo "✅ Server is healthy"
echo ""

# Run the tests
echo "🚀 Running tests..."
echo ""
export PLAYWRIGHT_SERVER_URL
cd playwright-server
node run-tests.js "$@"
