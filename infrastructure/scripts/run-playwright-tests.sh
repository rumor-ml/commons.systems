#!/bin/bash
# Run Playwright E2E tests against deployed site
# Usage: run-playwright-tests.sh <site-name> <site-url>

set -e

SITE_NAME="${1}"
SITE_URL="${2}"

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

# Capture output to validate tests actually ran
TEST_OUTPUT=$(DEPLOYED=true DEPLOYED_URL="$SITE_URL" CI=true npx playwright test --grep "@smoke" 2>&1) || true
TEST_EXIT_CODE=${PIPESTATUS[0]}

echo "$TEST_OUTPUT"

if [ $TEST_EXIT_CODE -eq 0 ]; then
  # Verify at least one test ran (check for "X passed" in output)
  if echo "$TEST_OUTPUT" | grep -qE '[0-9]+ passed'; then
    echo "✅ Smoke tests passed: $SITE_NAME"
  else
    echo "❌ ERROR: No smoke tests found or executed for $SITE_NAME"
    echo "Expected tests with @smoke annotation in ${TEST_DIR}/e2e/"
    echo "Verify that test files contain '@smoke' in test names"
    exit 1
  fi
else
  echo "❌ Playwright tests failed for $SITE_NAME (exit code: $TEST_EXIT_CODE)"
  exit $TEST_EXIT_CODE
fi
