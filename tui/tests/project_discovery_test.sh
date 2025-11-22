#!/usr/bin/env bash

# Project Discovery E2E Tests
# Verifies that TUI discovers and displays all monorepo projects

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
TEST_RESULTS=()

echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  TUI Project Discovery Test Suite         ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo

# Helper functions
log_test() {
    echo -e "${BLUE}[TEST $((TESTS_RUN + 1))]${NC} $1"
}

pass() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
    TEST_RESULTS+=("PASS: $1")
}

fail() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    TEST_RESULTS+=("FAIL: $1")
}

# Navigate to TUI directory
cd "$(dirname "$0")/.."

# ============================================================================
# UNIT TESTS
# ============================================================================

echo -e "\n${BLUE}═══ Project Discovery Unit Tests ═══${NC}"

# Test 1: Test EnhancedDiscoverProjects discovers all projects
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Test project discovery function"

# Create test program to call discovery
cat > /tmp/test_discovery.go <<'EOF'
package main

import (
	"fmt"
	"github.com/rumor-ml/carriercommons/pkg/discovery"
)

func main() {
	projects, err := discovery.EnhancedDiscoverProjects("/home/user/commons.systems")
	if err != nil {
		fmt.Printf("ERROR: %v\n", err)
		return
	}

	fmt.Printf("Found %d projects\n", len(projects))
	for _, p := range projects {
		fmt.Printf("- %s: %s\n", p.Name, p.Description)
	}
}
EOF

# Build and run test (already in tui directory from earlier cd)
OUTPUT=$(go run /tmp/test_discovery.go 2>&1)

if echo "$OUTPUT" | grep -q "Found [0-9]* projects"; then
    PROJECT_COUNT=$(echo "$OUTPUT" | grep "Found" | grep -oE "[0-9]+")
    if [ "$PROJECT_COUNT" -ge 5 ]; then
        pass "Discovery found $PROJECT_COUNT projects"
    else
        fail "Discovery found too few projects ($PROJECT_COUNT, expected >= 5)"
    fi
else
    fail "Discovery function failed or returned no output"
fi

# Test 2: Verify specific projects are discovered
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify fellspiral project is discovered"

if echo "$OUTPUT" | grep -q "fellspiral"; then
    pass "fellspiral project discovered"
else
    fail "fellspiral project NOT discovered"
fi

# Test 3: Verify videobrowser
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify videobrowser project is discovered"

if echo "$OUTPUT" | grep -q "videobrowser"; then
    pass "videobrowser project discovered"
else
    fail "videobrowser project NOT discovered"
fi

# Test 4: Verify tui itself
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify tui project is discovered"

if echo "$OUTPUT" | grep -q "tui"; then
    pass "tui project discovered"
else
    fail "tui project NOT discovered"
fi

# Test 5: Verify infrastructure
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify infrastructure project is discovered"

if echo "$OUTPUT" | grep -q "infrastructure"; then
    pass "infrastructure project discovered"
else
    fail "infrastructure project NOT discovered"
fi

# Test 6: Verify projects have descriptions
TESTS_RUN=$((TESTS_RUN + 1))
log_test "Verify projects have descriptions"

if echo "$OUTPUT" | grep -q "Fellspiral card game"; then
    pass "Projects have descriptive metadata"
else
    fail "Projects missing descriptive metadata"
fi

# ============================================================================
# RESULTS SUMMARY
# ============================================================================

echo
echo -e "${GREEN}╔════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Test Results Summary                      ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════╝${NC}"
echo
echo "Total tests run:    $TESTS_RUN"
echo -e "Passed:             ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed:             ${RED}$TESTS_FAILED${NC}"
echo

for result in "${TEST_RESULTS[@]}"; do
    if [[ $result == PASS:* ]]; then
        echo -e "${GREEN}✓${NC} ${result#PASS: }"
    else
        echo -e "${RED}✗${NC} ${result#FAIL: }"
    fi
done

if [ $TESTS_FAILED -eq 0 ]; then
    echo
    echo -e "${GREEN}✓ All project discovery tests passed!${NC}"
    exit 0
else
    echo
    echo -e "${RED}✗ Some tests failed.${NC}"
    exit 1
fi
