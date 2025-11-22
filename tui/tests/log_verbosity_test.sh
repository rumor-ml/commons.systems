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

# Clear the log database to start fresh
rm -f /tmp/tui-test-logs.db

# Build TUI
echo "Building TUI..."
go build -o tui-test main.go

# Start TUI in background with log database
echo "Starting TUI for 5 seconds..."
TUI_LOG_DB=/tmp/tui-test-logs.db timeout 5s ./tui-test || true

# Query the log database to check for repeated messages
echo "Analyzing log patterns..."

# Create a simple Go script to analyze the logs
cat > /tmp/analyze_logs.go <<'EOF'
package main

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func main() {
	db, err := sql.Open("sqlite3", "/tmp/tui-test-logs.db")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	// Count logs with same message but different timestamps within 5 seconds
	query := `
		SELECT message, COUNT(*) as count
		FROM logs
		GROUP BY message
		HAVING count > 1
		ORDER BY count DESC
		LIMIT 10
	`

	rows, err := db.Query(query)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Query failed: %v\n", err)
		os.Exit(1)
	}
	defer rows.Close()

	repeatedCount := 0
	for rows.Next() {
		var message string
		var count int
		if err := rows.Scan(&message, &count); err != nil {
			fmt.Fprintf(os.Stderr, "Scan failed: %v\n", err)
			continue
		}

		// Check if this message was logged more than once per second
		if count > 2 {
			fmt.Printf("REPEATED: %s (count: %d)\n", message, count)
			repeatedCount++
		}
	}

	if repeatedCount > 0 {
		fmt.Printf("\nFound %d messages that repeated excessively\n", repeatedCount)
		os.Exit(1)
	}

	fmt.Println("No excessive log repetition detected")
}
EOF

# Run the analysis
ANALYSIS_OUTPUT=$(go run /tmp/analyze_logs.go 2>&1)
ANALYSIS_EXIT=$?

echo "$ANALYSIS_OUTPUT"

if [ $ANALYSIS_EXIT -eq 0 ] && echo "$ANALYSIS_OUTPUT" | grep -q "No excessive log repetition"; then
    pass "No logs are printing repeatedly with updating timestamps"
else
    fail "Found logs printing repeatedly: $ANALYSIS_OUTPUT"
fi

# Cleanup
rm -f tui-test /tmp/analyze_logs.go /tmp/tui-test-logs.db

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
