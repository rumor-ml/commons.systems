#!/usr/bin/env bash
# Check if files changed in a given path pattern
# Usage: check-changes.sh <path-pattern> [commit-range]
# Example: check-changes.sh "fellspiral/**" "HEAD^..HEAD"

set -e

PATH_PATTERN="${1}"
COMMIT_RANGE="${2:-HEAD^..HEAD}"

if [ -z "$PATH_PATTERN" ]; then
  echo "Error: PATH_PATTERN is required"
  echo "Usage: $0 <path-pattern> [commit-range]"
  exit 1
fi

# Check if there are any changes in the path
if git diff --name-only "$COMMIT_RANGE" | grep -q "^${PATH_PATTERN}"; then
  echo "true"
  exit 0
else
  echo "false"
  exit 0
fi
