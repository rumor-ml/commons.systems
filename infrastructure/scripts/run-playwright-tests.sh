#!/bin/bash
# TODO: See issue #435 - Add automated tests for this script (criticality 10/10)
# Run Playwright E2E tests against deployed site
# Usage: run-playwright-tests.sh <site-name> <site-url>

set -e

SITE_NAME="${1}"
SITE_URL="${2}"

# TODO: See issue #434 - Add URL format validation (http:// or https://)
if [ -z "$SITE_NAME" ] || [ -z "$SITE_URL" ]; then
  echo "Usage: $0 <site-name> <site-url>"
  exit 1
fi

echo "=== Playwright E2E Tests: $SITE_NAME ==="
echo "Site: $SITE_URL"

# --- Wait for site to be ready (with retry) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! "$SCRIPT_DIR/health-check.sh" "$SITE_URL" --exponential --max-wait 60; then
  echo "Site not ready after waiting"
  exit 1
fi

# --- Run tests ---
echo "Running tests..."
TEST_DIR="${SITE_NAME}/tests"
if [ ! -d "$TEST_DIR" ]; then
  echo "Test directory not found: $TEST_DIR"
  echo "   Valid sites: fellspiral, videobrowser, audiobrowser, print, printsync"
  exit 1
fi
cd "$TEST_DIR"

# Capture output to validate that Playwright produced results
# We check for "X passed" pattern to confirm Playwright executed successfully
# Note: Pattern matches "0 passed" which may indicate tests were skipped - see TODO below
# TODO: See issue #435 - Consider using Playwright JSON reporter for more reliable validation
# TODO: See issue #435 - Add explicit timeout to prevent hung tests from wasting CI resources
# TODO: See issue #435 - Validate grep pattern matches annotation syntax before running
readonly PLAYWRIGHT_SUCCESS_PATTERN='[0-9]+ passed'

set +e
TEST_OUTPUT=$(DEPLOYED=true DEPLOYED_URL="$SITE_URL" CI=true npx playwright test --grep "@smoke" 2>&1)
TEST_EXIT_CODE=$?
set -e

# Paranoid check: TEST_EXIT_CODE should always be set since $? is always defined
# This only catches catastrophic shell errors, not normal failure modes
if [ -z "$TEST_EXIT_CODE" ]; then
  echo "ERROR: Unable to capture test exit code"
  echo "This indicates a shell scripting bug, not a test failure."
  echo "Please report this issue."
  exit 1
fi

echo "$TEST_OUTPUT"

# Check exit code first - non-zero means tests failed
if [ $TEST_EXIT_CODE -ne 0 ]; then
  echo "Playwright tests failed for $SITE_NAME (exit code: $TEST_EXIT_CODE)"
  exit $TEST_EXIT_CODE
fi

# Verify Playwright produced output by checking for "X passed" pattern
# WARNING: This will match "0 passed" - see issue #435 for proper count validation
# TODO: See issue #435 - Track expected smoke test count per app, validate actual matches expected
if ! echo "$TEST_OUTPUT" | grep -qE "$PLAYWRIGHT_SUCCESS_PATTERN"; then
  echo "ERROR: No smoke tests found or executed for $SITE_NAME"
  echo "Expected tests with @smoke annotation in ${TEST_DIR}/e2e/"
  echo "Verify that test files contain '@smoke' in test names"
  exit 1
fi

echo "Smoke tests passed: $SITE_NAME"
