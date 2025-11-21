#!/bin/bash
# Wait for a service to be healthy
# Usage: health-check.sh <url> [max-attempts] [interval]
# Example: health-check.sh "https://example.com/health" 30 5

set -e

URL="${1}"
MAX_ATTEMPTS="${2:-30}"
INTERVAL="${3:-5}"

if [ -z "$URL" ]; then
  echo "Error: URL is required"
  echo "Usage: $0 <url> [max-attempts] [interval]"
  exit 1
fi

echo "Waiting for service to be ready: $URL"
echo "Max attempts: $MAX_ATTEMPTS, Interval: ${INTERVAL}s"

for i in $(seq 1 "$MAX_ATTEMPTS"); do
  if curl -sf "$URL" > /dev/null 2>&1; then
    echo "✅ Service is ready after $((i*INTERVAL)) seconds!"
    exit 0
  fi
  echo "Waiting for service... ($i/$MAX_ATTEMPTS)"
  sleep "$INTERVAL"
done

echo "❌ Service is not responding after $((MAX_ATTEMPTS*INTERVAL)) seconds"
exit 1
