#!/usr/bin/env bash
# Run all local tests for all apps in the repository
# Usage: ./run-all-local-tests.sh [--changed-only]
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$REPO_ROOT/infrastructure/scripts"
CHANGED_ONLY=false
FAILED_TESTS=()
TESTED_APPS=()

# Parse arguments
if [ "$1" = "--changed-only" ]; then
  CHANGED_ONLY=true
fi

# Get list of changed apps (directories with changes)
get_changed_apps() {
  # Get all changed files
  git diff --name-only HEAD origin/main 2>/dev/null | cut -d'/' -f1 | sort -u
}

# Check if an app has changes
app_has_changes() {
  local app_name="$1"

  if [ "$CHANGED_ONLY" = false ]; then
    return 0  # Always test if not in changed-only mode
  fi

  # Check if app is in the list of changed directories
  if get_changed_apps | grep -q "^${app_name}$"; then
    return 0
  fi

  return 1
}

# Check if an app has a Firebase hosting configuration
app_has_firebase_config() {
  local app_name="$1"
  local firebase_json="$REPO_ROOT/firebase.json"

  if [ ! -f "$firebase_json" ]; then
    return 1
  fi

  # Check if firebase.json has a hosting config for this site
  if jq -e ".hosting[] | select(.site == \"$app_name\")" "$firebase_json" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

# Discover and test Firebase apps
test_firebase_apps() {
  echo "=== Discovering Firebase Apps ==="

  for dir in "$REPO_ROOT"/*; do
    if [ ! -d "$dir" ]; then continue; fi

    local app_name=$(basename "$dir")

    # Skip special directories
    if [[ "$app_name" =~ ^\..*$ ]] || [ "$app_name" = "node_modules" ] || [ "$app_name" = "infrastructure" ]; then
      continue
    fi

    # Check for Firebase app: has site/ with package.json and tests/ with playwright
    if [ -d "$dir/site" ] && [ -f "$dir/site/package.json" ] && [ -d "$dir/tests" ]; then
      # Verify app has a Firebase hosting configuration
      if ! app_has_firebase_config "$app_name"; then
        echo "Skipping $app_name (no Firebase hosting config in firebase.json)"
        continue
      fi

      if ! app_has_changes "$app_name"; then
        echo "Skipping $app_name (no changes)"
        continue
      fi

      echo ""
      echo "========================================"
      echo "Testing Firebase app: $app_name"
      echo "========================================"

      if "$SCRIPT_DIR/test-firebase-app.sh" "$dir"; then
        TESTED_APPS+=("$app_name")
        echo "✓ $app_name passed"
      else
        FAILED_TESTS+=("Firebase app: $app_name")
        echo "✗ $app_name FAILED"
      fi
    fi
  done
}

# Discover and test Go fullstack apps
test_go_fullstack_apps() {
  echo ""
  echo "=== Discovering Go Fullstack Apps ==="

  for dir in "$REPO_ROOT"/*; do
    if [ ! -d "$dir" ]; then continue; fi

    local app_name=$(basename "$dir")

    # Skip special directories
    if [[ "$app_name" =~ ^\..*$ ]] || [ "$app_name" = "node_modules" ] || [ "$app_name" = "infrastructure" ]; then
      continue
    fi

    # Check for Go fullstack app: has server/ with go.mod
    if [ -d "$dir/server" ] && [ -f "$dir/server/go.mod" ]; then
      if ! app_has_changes "$app_name"; then
        echo "Skipping $app_name (no changes)"
        continue
      fi

      echo ""
      echo "========================================"
      echo "Testing Go fullstack app: $app_name"
      echo "========================================"

      if "$SCRIPT_DIR/test-go-fullstack-app.sh" "$dir"; then
        TESTED_APPS+=("$app_name")
        echo "✓ $app_name passed"
      else
        FAILED_TESTS+=("Go fullstack app: $app_name")
        echo "✗ $app_name FAILED"
      fi
    fi
  done
}

# Discover and test Go TUI apps
test_go_tui_apps() {
  echo ""
  echo "=== Discovering Go TUI Apps ==="

  for dir in "$REPO_ROOT"/*; do
    if [ ! -d "$dir" ]; then continue; fi

    local app_name=$(basename "$dir")

    # Skip special directories
    if [[ "$app_name" =~ ^\..*$ ]] || [ "$app_name" = "node_modules" ] || [ "$app_name" = "infrastructure" ]; then
      continue
    fi

    # Check for Go TUI app: has cmd/ and go.mod and uses bubbletea
    if [ -d "$dir/cmd" ] && [ -f "$dir/go.mod" ]; then
      if grep -q "bubbletea" "$dir/go.mod" 2>/dev/null; then
        if ! app_has_changes "$app_name"; then
          echo "Skipping $app_name (no changes)"
          continue
        fi

        echo ""
        echo "========================================"
        echo "Testing Go TUI app: $app_name"
        echo "========================================"

        if "$SCRIPT_DIR/test-go-tui-app.sh" "$dir"; then
          TESTED_APPS+=("$app_name")
          echo "✓ $app_name passed"
        else
          FAILED_TESTS+=("Go TUI app: $app_name")
          echo "✗ $app_name FAILED"
        fi
      fi
    fi
  done
}

# Discover and test Go packages
test_go_packages() {
  echo ""
  echo "=== Discovering Go Packages ==="

  for dir in "$REPO_ROOT"/*; do
    if [ ! -d "$dir" ]; then continue; fi

    local app_name=$(basename "$dir")

    # Skip special directories
    if [[ "$app_name" =~ ^\..*$ ]] || [ "$app_name" = "node_modules" ] || [ "$app_name" = "infrastructure" ]; then
      continue
    fi

    # Check for Go package: has go.mod but not cmd/ or server/
    if [ -f "$dir/go.mod" ] && [ ! -d "$dir/cmd" ] && [ ! -d "$dir/server" ]; then
      if ! app_has_changes "$app_name"; then
        echo "Skipping $app_name (no changes)"
        continue
      fi

      echo ""
      echo "========================================"
      echo "Testing Go package: $app_name"
      echo "========================================"

      if "$SCRIPT_DIR/test-go-package.sh" "$dir"; then
        TESTED_APPS+=("$app_name")
        echo "✓ $app_name passed"
      else
        FAILED_TESTS+=("Go package: $app_name")
        echo "✗ $app_name FAILED"
      fi
    fi
  done
}

# Main execution
echo "========================================="
echo "Running All Local Tests"
if [ "$CHANGED_ONLY" = true ]; then
  echo "Mode: Changed apps only"
else
  echo "Mode: All apps"
fi
echo "========================================="

test_firebase_apps
test_go_fullstack_apps
test_go_tui_apps
test_go_packages

# Report results
echo ""
echo "========================================="
echo "Test Summary"
echo "========================================="
echo "Tested apps: ${#TESTED_APPS[@]}"
echo "Failed tests: ${#FAILED_TESTS[@]}"

if [ ${#TESTED_APPS[@]} -eq 0 ]; then
  echo ""
  echo "Warning: No apps were tested"
  if [ "$CHANGED_ONLY" = true ]; then
    echo "This might be because no apps have changes"
  fi
fi

if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
  echo ""
  echo "The following tests FAILED:"
  for test in "${FAILED_TESTS[@]}"; do
    echo "  ✗ $test"
  done
  exit 1
else
  echo ""
  echo "✓ All tests passed!"
  exit 0
fi
