#!/usr/bin/env bash
# Sanitize branch name for Cloud Run service names
# Usage: sanitize-branch-name.sh <branch-name> [prefix]
# Example: sanitize-branch-name.sh "feature/my-feature" "fellspiral"

set -e

BRANCH_NAME="${1}"
PREFIX="${2:-}"

if [ -z "$BRANCH_NAME" ]; then
  echo "Error: BRANCH_NAME is required"
  echo "Usage: $0 <branch-name> [prefix]"
  exit 1
fi

# Remove 'claude/' prefix if present
BRANCH_NAME="${BRANCH_NAME#claude/}"

# Convert to lowercase, replace / and _ with -, remove invalid chars
SANITIZED=$(echo "$BRANCH_NAME" | tr '[:upper:]' '[:lower:]' | tr '/_' '-' | sed 's/[^a-z0-9-]//g')

# Build service name with prefix if provided
if [ -n "$PREFIX" ]; then
  SERVICE_NAME="${PREFIX}-${SANITIZED}"
else
  SERVICE_NAME="${SANITIZED}"
fi

# Truncate if needed (max 63 chars for Cloud Run)
SERVICE_NAME="${SERVICE_NAME:0:63}"

# Remove trailing hyphen if present
SERVICE_NAME="${SERVICE_NAME%-}"

echo "$SERVICE_NAME"
