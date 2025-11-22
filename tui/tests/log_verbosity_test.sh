#!/usr/bin/env bash

# Log Verbosity E2E Test
# Verifies that no logs are printing repeatedly with updating timestamps

set -euo pipefail

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  TUI Log Verbosity Test                    ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo

# Helper functions
log_test() {
    echo -e "${BLUE}[TEST $((TESTS_RUN + 1))]${NC} $1"
}

pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

# Navigate to TUI directory
cd "$(dirname "$0")/.."

# ============================================================================
# E2E TEST: Verify no repeated logs
# ============================================================================

echo -e "\n${BLUE}═══ Log Verbosity E2E Test ═══${NC}"

# Test: Verify no logs are printed repeatedly with updating timestamps
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify no logs print repeatedly with updating timestamps"

# Clear any previous test logs
rm -f /tmp/tui.log

# Build TUI
echo "Building TUI..."
go build -o tui-test .

# Start TUI in background, capturing logs
# The stub log package writes to /tmp/tui.log
# Use script to provide a pseudo-terminal
echo "Starting TUI for 10 seconds to collect logs..."
timeout 10s script -q -c "./tui-test" /dev/null 2>&1 || true

# Wait for any final log writes
sleep 1

# Check if log file exists
if [ ! -f "/tmp/tui.log" ]; then
    echo "No log file found at /tmp/tui.log"
    fail "Could not find log file"
    exit 1
fi

echo "Found log file: /tmp/tui.log"
echo "Analyzing log patterns..."

# Analyze logs for repeated messages with timestamps within 2 seconds
# Create a simple analysis script
cat > /tmp/analyze_tui_logs.sh <<'EOF'
#!/bin/bash

LOG_FILE="/tmp/tui.log"
REPEATED_COUNT=0

# Get all unique log messages (strip timestamps)
MESSAGES=$(grep -E "^[0-9]{4}/[0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}" "$LOG_FILE" | \
           sed -E 's/^[0-9]{4}\/[0-9]{2}\/[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} //' | \
           sort | uniq -c | sort -rn)

# Check each message that appears more than once
while IFS= read -r line; do
    COUNT=$(echo "$line" | awk '{print $1}')
    MESSAGE=$(echo "$line" | sed -E 's/^[[:space:]]*[0-9]+[[:space:]]*//')

    # Skip if count <= 2 (a couple occurrences is okay)
    if [ "$COUNT" -le 2 ]; then
        continue
    fi

    # Get timestamps for this message
    TIMESTAMPS=$(grep -F "$MESSAGE" "$LOG_FILE" | \
                 grep -oE "^[0-9]{4}/[0-9]{2}/[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}")

    # Check if any two consecutive timestamps are within 2 seconds
    PREV_TS=""
    while IFS= read -r ts; do
        if [ -n "$PREV_TS" ]; then
            # Convert timestamps to seconds since epoch
            PREV_SEC=$(date -d "$PREV_TS" +%s 2>/dev/null || echo "0")
            CURR_SEC=$(date -d "$ts" +%s 2>/dev/null || echo "0")

            if [ "$PREV_SEC" != "0" ] && [ "$CURR_SEC" != "0" ]; then
                DIFF=$((CURR_SEC - PREV_SEC))

                # If difference is 0-2 seconds and we have 3+ occurrences, it's repeating too fast
                if [ "$DIFF" -ge 0 ] && [ "$DIFF" -le 2 ] && [ "$COUNT" -ge 3 ]; then
                    echo "REPEATED EVERY ~${DIFF}s: $MESSAGE (total count: $COUNT)"
                    REPEATED_COUNT=$((REPEATED_COUNT + 1))
                    break
                fi
            fi
        fi
        PREV_TS="$ts"
    done <<< "$TIMESTAMPS"

done <<< "$MESSAGES"

if [ $REPEATED_COUNT -gt 0 ]; then
    echo ""
    echo "Found $REPEATED_COUNT messages printing repeatedly every 1-2 seconds"
    exit 1
fi

echo "No logs printing repeatedly every second"
exit 0
EOF

chmod +x /tmp/analyze_tui_logs.sh

# Run the analysis
ANALYSIS_OUTPUT=$(/tmp/analyze_tui_logs.sh 2>&1)
ANALYSIS_EXIT=$?

echo "$ANALYSIS_OUTPUT"

if [ $ANALYSIS_EXIT -eq 0 ] && echo "$ANALYSIS_OUTPUT" | grep -q "No logs printing repeatedly every second"; then
    pass "No logs are printing repeatedly every second"
else
    fail "Found logs printing repeatedly every second: $ANALYSIS_OUTPUT"
fi

# Cleanup
rm -f tui-test /tmp/analyze_tui_logs.sh

# ============================================================================
# SUMMARY
# ============================================================================

echo
echo -e "${BLUE}═══════════════════════════════════${NC}"
echo -e "${BLUE}         TEST SUMMARY              ${NC}"
echo -e "${BLUE}═══════════════════════════════════${NC}"
echo -e "Total Tests:  $TESTS_RUN"
echo -e "${GREEN}Passed:       $TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "${RED}Failed:       $TESTS_FAILED${NC}"
    exit 1
else
    echo -e "${GREEN}Failed:       0${NC}"
    echo
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
fi
