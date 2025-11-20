#!/bin/bash
# Simple wrapper script for running Playwright tests via the remote server

set -e

# Check if server URL is set
if [ -z "$PLAYWRIGHT_SERVER_URL" ]; then
  echo "❌ Error: PLAYWRIGHT_SERVER_URL environment variable not set"
  echo ""
  echo "Set it with the deployed Cloud Run URL:"
  echo "  export PLAYWRIGHT_SERVER_URL=https://playwright-server-xxxxx.run.app"
  echo ""
  echo "Or get it from GCP:"
  echo "  gcloud run services describe playwright-server --region us-central1 --format 'value(status.url)'"
  exit 1
fi

# Run the Node.js client script
node "$(dirname "$0")/run-tests.js" "$@"
