#!/usr/bin/env bash

# Log Display E2E Test
# Verifies that log timestamps don't update on repeated polls

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
echo -e "${GREEN}║  TUI Log Display Test                      ║${NC}"
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
# E2E TEST: Verify log timestamps don't update on repeated polls
# ============================================================================

echo -e "\n${BLUE}═══ Log Display E2E Test ═══${NC}"

# Test: Verify log timestamps don't change on repeated GetRecent() calls
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify log timestamps remain stable across multiple polls"

# Build test program
cat > /tmp/test_log_display.go <<'EOF'
package main

import (
	"fmt"
	"time"

	"github.com/rumor-ml/log/pkg/log"
)

func main() {
	logger := log.Get()

	// Get logs twice with a delay
	logs1 := logger.GetRecent(10)
	time.Sleep(3 * time.Second)
	logs2 := logger.GetRecent(10)

	// Compare timestamps
	if len(logs1) != len(logs2) {
		fmt.Printf("ERROR: Different number of logs (%d vs %d)\n", len(logs1), len(logs2))
		return
	}

	timestampsChanged := false
	for i := 0; i < len(logs1) && i < len(logs2); i++ {
		if logs1[i].Message == logs2[i].Message {
			if !logs1[i].Time.Equal(logs2[i].Time) {
				fmt.Printf("TIMESTAMP_CHANGED: Message '%s' timestamp changed from %v to %v\n",
					logs1[i].Message, logs1[i].Time, logs2[i].Time)
				timestampsChanged = true
			}
		}
	}

	if timestampsChanged {
		fmt.Println("ERROR: Timestamps changed between polls")
	} else {
		fmt.Println("SUCCESS: Timestamps remain stable")
	}
}
EOF

# Run the test
OUTPUT=$(cd /home/user/commons.systems/tui && go run /tmp/test_log_display.go 2>&1)

if echo "$OUTPUT" | grep -q "SUCCESS: Timestamps remain stable"; then
    pass "Log timestamps remain stable across multiple polls"
elif echo "$OUTPUT" | grep -q "TIMESTAMP_CHANGED"; then
    fail "Log timestamps are updating on each poll: $OUTPUT"
else
    fail "Test failed to execute properly: $OUTPUT"
fi

# Cleanup
rm -f /tmp/test_log_display.go

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
