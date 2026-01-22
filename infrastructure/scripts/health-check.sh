#!/usr/bin/env bash
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
  local curl_output
  local time_namelookup
  local time_connect
  local time_starttransfer
  local time_total

  # Fetch response with HTTP code, timing metrics, and headers
  # --connect-timeout: max time for connection establishment
  # --max-time: max time for entire operation
  # -w format includes timing data: DNS lookup, TCP connect, TTFB, total
  curl_output=$(curl -sf --connect-timeout 10 --max-time 30 \
    -w "\n%{http_code}\n%{time_namelookup}\n%{time_connect}\n%{time_starttransfer}\n%{time_total}" \
    -D /dev/stderr \
    "$URL" 2>&1) || {
    [ "$VERBOSE" = true ] && echo "  ⚠️  curl failed (connection error or timeout)"
    return 1
  }

  # Parse curl output
  # curl appends 5 lines: http_code, time_namelookup, time_connect, time_starttransfer, time_total
  response=$(echo "$curl_output" | head -n -5)
  http_code=$(echo "$curl_output" | tail -n 5 | head -n 1)
  time_namelookup=$(echo "$curl_output" | tail -n 4 | head -n 1)
  time_connect=$(echo "$curl_output" | tail -n 3 | head -n 1)
  time_starttransfer=$(echo "$curl_output" | tail -n 2 | head -n 1)
  time_total=$(echo "$curl_output" | tail -n 1)

  # Log timing metrics in verbose mode
  if [ "$VERBOSE" = true ]; then
    echo "  📊 Timing: DNS=${time_namelookup}s, Connect=${time_connect}s, TTFB=${time_starttransfer}s, Total=${time_total}s"
  fi

  # Check HTTP status
  if [ "$http_code" != "200" ] && [ "$http_code" != "304" ]; then
    [ "$VERBOSE" = true ] && echo "  ❌ HTTP status: $http_code (expected 200 or 304)"
    return 1
  fi

  # Check content pattern if specified
  if [ -n "$CONTENT_PATTERN" ]; then
    if ! echo "$response" | grep -q "$CONTENT_PATTERN"; then
      [ "$VERBOSE" = true ] && echo "  ❌ Content pattern '$CONTENT_PATTERN' not found"
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

    # Capture detailed diagnostics on final attempt
    DIAGNOSTIC_OUTPUT=$(curl -svf --connect-timeout 10 --max-time 30 \
      -w "\nHTTP_CODE: %{http_code}\nDNS_TIME: %{time_namelookup}s\nCONNECT_TIME: %{time_connect}s\nTTFB: %{time_starttransfer}s\nTOTAL_TIME: %{time_total}s" \
      "$URL" 2>&1 || echo "Connection failed")

    echo "$DIAGNOSTIC_OUTPUT" | grep -E "(HTTP_CODE|DNS_TIME|CONNECT_TIME|TTFB|TOTAL_TIME|< HTTP/|< [Cc]ache-|Connection failed)" | sed 's/^/   /'
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
