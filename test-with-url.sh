#!/bin/bash
# Run tests with manually provided server URL
# Usage: ./test-with-url.sh <SERVER_URL> [options]
#
# Example:
#   ./test-with-url.sh https://playwright-server-abc123.run.app --project chromium
#   ./test-with-url.sh https://playwright-server-abc123.run.app --grep "homepage"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <SERVER_URL> [test-options]"
    echo ""
    echo "Example:"
    echo "  $0 https://playwright-server-abc123.run.app --project chromium"
    echo "  $0 https://playwright-server-abc123.run.app --grep 'homepage'"
    echo "  $0 https://playwright-server-abc123.run.app --test-file homepage.spec.js"
    echo ""
    echo "Available test options:"
    echo "  --project <name>      Browser project (chromium, firefox, webkit)"
    echo "  --grep <pattern>      Test name pattern to run"
    echo "  --test-file <path>    Specific test file to run"
    echo "  --headed              Run in headed mode"
    echo "  --workers <n>         Number of parallel workers"
    echo "  --deployed            Test deployed site instead of local"
    exit 1
fi

SERVER_URL=$1
shift  # Remove first argument, keep the rest as test options

echo "🎭 Running Playwright tests"
echo "📍 Server: $SERVER_URL"
echo ""

# Test server health
echo "🏥 Checking server health..."
if ! curl -sf "$SERVER_URL/health" > /dev/null; then
    echo "❌ Server is not responding at $SERVER_URL"
    echo ""
    echo "Please verify:"
    echo "  1. The URL is correct"
    echo "  2. The server is deployed and running"
    echo "  3. You can access the URL from your network"
    exit 1
fi

echo "✅ Server is healthy"
echo ""

# Run the tests
echo "🚀 Running tests..."
echo ""
export PLAYWRIGHT_SERVER_URL="$SERVER_URL"
cd playwright-server
node run-tests.js "$@"
