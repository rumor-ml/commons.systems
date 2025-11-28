#!/bin/bash
# Wait for a service to be healthy with exponential backoff and content validation
#
# Usage:
#   health-check.sh <url> [options]
#     --max-wait <seconds>   Max total wait time (default: 60)
#     --content <pattern>    Grep pattern to validate in response body
#     --exponential          Use exponential backoff (1s, 2s, 4s, 8s...)
#     --verbose              Show detailed timing info
#
# Examples:
#   health-check.sh "https://example.com" --max-wait 60
#   health-check.sh "https://example.com" --exponential --content "</html>"

set -e

# Parse arguments
URL=""
MAX_WAIT=60
CONTENT_PATTERN=""
EXPONENTIAL=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --max-wait)
      MAX_WAIT="$2"
      shift 2
      ;;
    --content)
      CONTENT_PATTERN="$2"
      shift 2
      ;;
    --exponential)
      EXPONENTIAL=true
      shift
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    -*)
      echo "Error: Unknown option $1"
      exit 1
      ;;
    *)
      if [ -z "$URL" ]; then
        URL="$1"
      fi
      shift
      ;;
  esac
done

if [ -z "$URL" ]; then
  echo "Error: URL is required"
  echo "Usage: $0 <url> --exponential --max-wait 60 --content '</html>'"
  exit 1
fi

check_url() {
  local response
  local http_code

  # Fetch response with HTTP code and timeouts
  # --connect-timeout: max time for connection establishment
  # --max-time: max time for entire operation
  response=$(curl -sf --connect-timeout 10 --max-time 30 -w "\n%{http_code}" "$URL" 2>/dev/null) || return 1
  http_code=$(echo "$response" | tail -n1)
  response=$(echo "$response" | sed '$d')

  # Check HTTP status
  if [ "$http_code" != "200" ] && [ "$http_code" != "304" ]; then
    [ "$VERBOSE" = true ] && echo "  HTTP status: $http_code (expected 200 or 304)"
    return 1
  fi

  # Check content pattern if specified
  if [ -n "$CONTENT_PATTERN" ]; then
    if ! echo "$response" | grep -q "$CONTENT_PATTERN"; then
      [ "$VERBOSE" = true ] && echo "  Content pattern '$CONTENT_PATTERN' not found"
      return 1
    fi
  fi

  return 0
}

echo "Waiting for service to be ready: $URL"
if [ "$EXPONENTIAL" = true ]; then
  echo "Mode: Exponential backoff (1s, 2s, 4s, 8s...), max wait: ${MAX_WAIT}s"
else
  echo "Mode: Fixed 1s interval, max wait: ${MAX_WAIT}s"
fi
[ -n "$CONTENT_PATTERN" ] && echo "Content validation: '$CONTENT_PATTERN'"

START_TIME=$(date +%s)
DELAY=1
ATTEMPT=1

while true; do
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))

  if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
    echo ""
    echo "❌ Service not ready after ${ELAPSED}s (timeout: ${MAX_WAIT}s)"
    echo "   URL: $URL"
    [ -n "$CONTENT_PATTERN" ] && echo "   Expected content: '$CONTENT_PATTERN'"
    echo ""
    echo "Last response details:"
    LAST_HTTP_CODE=$(curl -sf -w "%{http_code}" "$URL" 2>/dev/null || echo "Connection failed")
    echo "   HTTP Code: $LAST_HTTP_CODE"
    exit 1
  fi

  TIMESTAMP=$(date '+%H:%M:%S')
  [ "$VERBOSE" = true ] && echo "[$TIMESTAMP] Attempt $ATTEMPT (elapsed: ${ELAPSED}s)..."

  if check_url; then
    echo ""
    echo "✅ Service is ready after ${ELAPSED}s!"
    [ "$VERBOSE" = true ] && echo "   Attempts: $ATTEMPT"
    exit 0
  fi

  # Show progress (non-verbose)
  [ "$VERBOSE" = false ] && echo "Waiting... (${ELAPSED}s/${MAX_WAIT}s)"

  # Calculate next delay
  REMAINING=$((MAX_WAIT - ELAPSED))
  if [ "$DELAY" -gt "$REMAINING" ]; then
    DELAY="$REMAINING"
  fi

  if [ "$DELAY" -le 0 ]; then
    break
  fi

  sleep "$DELAY"

  # Exponential backoff: double the delay (cap at 16s for reasonable granularity)
  if [ "$EXPONENTIAL" = true ] && [ "$DELAY" -lt 16 ]; then
    DELAY=$((DELAY * 2))
  fi

  ATTEMPT=$((ATTEMPT + 1))
done

echo "❌ Service is not responding after ${MAX_WAIT}s"
exit 1
