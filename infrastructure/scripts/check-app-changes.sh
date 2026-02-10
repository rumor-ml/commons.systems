#!/usr/bin/env bash
# Check which apps have changes compared to main branch
# Usage: check-app-changes.sh
# Outputs: JSON arrays for each app type that has changes

set -e

# Get the base branch to compare against
BASE_BRANCH="${GITHUB_BASE_REF:-main}"
BASE_REF="origin/${BASE_BRANCH}"

echo "Checking for changes against ${BASE_REF}..." >&2

# Fetch origin to ensure we have latest main
git fetch origin "${BASE_BRANCH}" --depth=1 2>/dev/null || true

# Get list of changed files
CHANGED_FILES=$(git diff --name-only "${BASE_REF}...HEAD" 2>/dev/null || echo "")

# If we can't get diff (e.g., on main branch), test everything
if [ -z "$CHANGED_FILES" ]; then
  echo "Cannot determine changes - will test all apps" >&2
  echo "changed_all=true"
  exit 0
fi

echo "Changed files:" >&2
echo "$CHANGED_FILES" >&2
echo "" >&2

# Function to check if an app has changes
has_changes() {
  local app_path="$1"

  # Check if any changed files are in this app's directory
  echo "$CHANGED_FILES" | grep -q "^${app_path}/"
}

# Function to check if shared/infrastructure files changed
has_shared_changes() {
  echo "$CHANGED_FILES" | grep -qE "^(shared/|infrastructure/|\.github/workflows/|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)"
}

# If shared files changed, test everything
if has_shared_changes; then
  echo "Shared/infrastructure files changed - will test all apps" >&2
  echo "changed_all=true"
  exit 0
fi

# Check each app for changes
CHANGED_APPS=""

for app in fellspiral videobrowser audiobrowser print budget; do
  if has_changes "$app"; then
    CHANGED_APPS="${CHANGED_APPS} ${app}"
    echo "App changed: ${app}" >&2
  fi
done

for app in printsync; do
  if has_changes "$app"; then
    CHANGED_APPS="${CHANGED_APPS} ${app}"
    echo "App changed: ${app}" >&2
  fi
done

for app in tmux-tui; do
  if has_changes "$app"; then
    CHANGED_APPS="${CHANGED_APPS} ${app}"
    echo "App changed: ${app}" >&2
  fi
done

for pkg in pkg/filesync; do
  if has_changes "$pkg"; then
    CHANGED_APPS="${CHANGED_APPS} filesync"
    echo "Package changed: ${pkg}" >&2
  fi
done

# Output results
if [ -z "$CHANGED_APPS" ]; then
  echo "No app-specific changes detected" >&2
  echo "changed_all=false"
  echo "changed_apps=[]"
else
  echo "Changed apps:${CHANGED_APPS}" >&2
  # Convert to JSON array
  APPS_JSON=$(echo "$CHANGED_APPS" | tr ' ' '\n' | grep -v '^$' | jq -R -s -c 'split("\n") | map(select(length > 0))')
  echo "changed_all=false"
  echo "changed_apps=${APPS_JSON}"
fi
