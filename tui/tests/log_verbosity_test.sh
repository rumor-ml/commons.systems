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
rm -f /tmp/tui-test-logs.txt /tmp/tui-test-logs.db

# Build TUI
echo "Building TUI..."
go build -o tui-test main.go

# Start TUI in background, capturing logs
# The log package writes to the database, so we need to query it after
echo "Starting TUI for 10 seconds to collect logs..."
timeout 10s ./tui-test 2>&1 || true

# Wait a moment for any final log writes
sleep 1

# Find the actual log database (it's in /tmp)
LOG_DB=$(ls -t /tmp/tui*.db 2>/dev/null | head -1)
if [ -z "$LOG_DB" ]; then
    echo "No log database found in /tmp"
    fail "Could not find log database"
    exit 1
fi

echo "Found log database: $LOG_DB"
echo "Analyzing log patterns..."

# Create a simple Go script to analyze the logs
cat > /tmp/analyze_logs.go <<EOF
package main

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func main() {
	dbPath := os.Args[1]
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	// Find messages that repeat with timestamps close together (within 2 seconds)
	query := `
		SELECT message, time, COUNT(*) as count
		FROM logs
		GROUP BY message
		HAVING count > 1
		ORDER BY count DESC
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
		var lastTime string
		var count int
		if err := rows.Scan(&message, &lastTime, &count); err != nil {
			fmt.Fprintf(os.Stderr, "Scan failed: %v\n", err)
			continue
		}

		// For each repeated message, check if occurrences are within 2 seconds of each other
		timestampQuery := `
			SELECT time FROM logs WHERE message = ? ORDER BY time ASC
		`
		timestampRows, err := db.Query(timestampQuery, message)
		if err != nil {
			continue
		}

		var timestamps []time.Time
		for timestampRows.Next() {
			var ts string
			if err := timestampRows.Scan(&ts); err != nil {
				continue
			}
			t, err := time.Parse("2006-01-02 15:04:05.999999999-07:00", ts)
			if err != nil {
				// Try alternative format
				t, err = time.Parse(time.RFC3339Nano, ts)
				if err != nil {
					continue
				}
			}
			timestamps = append(timestamps, t)
		}
		timestampRows.Close()

		// Check if any two consecutive timestamps are within 2 seconds
		// This indicates a log printing repeatedly every second
		for i := 1; i < len(timestamps); i++ {
			diff := timestamps[i].Sub(timestamps[i-1])
			if diff < 2*time.Second && count >= 3 {
				fmt.Printf("REPEATED EVERY ~%.1fs: %s (total count: %d, interval: %.2fs)\n",
					diff.Seconds(), message, count, diff.Seconds())
				repeatedCount++
				break
			}
		}
	}

	if repeatedCount > 0 {
		fmt.Printf("\nFound %d messages printing repeatedly every second\n", repeatedCount)
		os.Exit(1)
	}

	fmt.Println("No logs printing repeatedly every second")
}
EOF

# Run the analysis
ANALYSIS_OUTPUT=$(go run /tmp/analyze_logs.go "$LOG_DB" 2>&1)
ANALYSIS_EXIT=$?

echo "$ANALYSIS_OUTPUT"

if [ $ANALYSIS_EXIT -eq 0 ] && echo "$ANALYSIS_OUTPUT" | grep -q "No logs printing repeatedly every second"; then
    pass "No logs are printing repeatedly every second"
else
    fail "Found logs printing repeatedly every second: $ANALYSIS_OUTPUT"
fi

# Cleanup
rm -f tui-test /tmp/analyze_logs.go

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
