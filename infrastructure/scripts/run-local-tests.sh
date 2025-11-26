#!/bin/bash
# Run local tests for a site
# Usage: run-local-tests.sh <site-name>
# Example: run-local-tests.sh "fellspiral"

set -e

SITE_NAME="${1}"

if [ -z "$SITE_NAME" ]; then
  echo "Error: SITE_NAME is required"
  echo "Usage: $0 <site-name>"
  exit 1
fi

echo "=== Running local tests for $SITE_NAME ==="

# Install dependencies if not already installed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install --frozen-lockfile
fi

# Build the site
echo "Building site..."
pnpm --filter "${SITE_NAME}/site" build

# Lint check
echo "Running lint checks..."
if grep -r "console\.log" "${SITE_NAME}/site/src/" 2>/dev/null; then
  echo "❌ Found console.log statements in source code"
  exit 1
else
  echo "✅ No console.log statements found"
fi

# Check for TODO comments (informational only)
echo "Checking for TODO/FIXME comments..."
if grep -r "TODO\|FIXME" "${SITE_NAME}/" 2>/dev/null; then
  echo "ℹ️ Found TODO/FIXME comments (informational only)"
else
  echo "✅ No TODO/FIXME comments found"
fi

echo "✅ Local tests passed for $SITE_NAME"
