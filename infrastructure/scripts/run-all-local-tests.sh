#!/bin/bash
# Run all local tests for all apps in the repository
# Usage: ./run-all-local-tests.sh [--changed-only]
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_DIR="$REPO_ROOT/infrastructure/scripts"
CHANGED_ONLY=false
FAILED_TESTS=()
TESTED_APPS=()
APPS_TO_TEST_CACHE=""
APPS_TO_TEST_CACHED=false

# Parse arguments
if [ "$1" = "--changed-only" ]; then
  CHANGED_ONLY=true
fi

# Get list of changed apps (directories with changes)
get_changed_apps() {
  # Get all changed files
  git diff --name-only HEAD origin/main 2>/dev/null | cut -d'/' -f1 | sort -u
}

# Get list of changed shared Go modules
get_changed_shared_modules() {
  # Get changed files in shared/ and pkg/ directories
  git diff --name-only HEAD origin/main 2>/dev/null | grep -E '^(shared|pkg)/' | while read -r file; do
    # Extract the module path (e.g., shared/templates, pkg/filesync)
    echo "$file" | cut -d'/' -f1,2
  done | sort -u
}

# Find apps that depend on a given Go module
find_dependent_apps() {
  local module_path="$1"
  local module_name=""

  # Determine the Go module name based on path
  if [ -f "$REPO_ROOT/$module_path/go.mod" ]; then
    module_name=$(grep '^module ' "$REPO_ROOT/$module_path/go.mod" | awk '{print $2}')
  fi

  if [ -z "$module_name" ]; then
    return
  fi

  # Search for apps that depend on this module
  for dir in "$REPO_ROOT"/*; do
    if [ ! -d "$dir" ]; then continue; fi

    local app_name=$(basename "$dir")

    # Skip special directories
    if [[ "$app_name" =~ ^\..*$ ]] || [ "$app_name" = "node_modules" ] || [ "$app_name" = "infrastructure" ]; then
      continue
    fi

    # Check go.mod files in app directories
    find "$dir" -name "go.mod" -type f 2>/dev/null | while read -r gomod; do
      if grep -q "$module_name" "$gomod" 2>/dev/null; then
        echo "$app_name"
        break
      fi
    done
  done | sort -u
}

# Get all apps that should be tested (including transitive dependencies)
get_apps_to_test() {
  # Return cached result if available
  if [ "$APPS_TO_TEST_CACHED" = true ]; then
    echo "$APPS_TO_TEST_CACHE"
    return
  fi

  local changed_dirs=()

  # Get directly changed directories
  while IFS= read -r dir; do
    [ -n "$dir" ] && changed_dirs+=("$dir")
  done < <(get_changed_apps)

  # Check for changed shared modules and add dependent apps
  while IFS= read -r module_path; do
    [ -z "$module_path" ] && continue

    echo "Detected change in shared module: $module_path" >&2

    # Find apps that depend on this module
    while IFS= read -r app; do
      [ -n "$app" ] && changed_dirs+=("$app")
      echo "  Adding dependent app: $app" >&2
    done < <(find_dependent_apps "$module_path")
  done < <(get_changed_shared_modules)

  # Cache and return unique list
  APPS_TO_TEST_CACHE=$(printf '%s\n' "${changed_dirs[@]}" | sort -u)
  APPS_TO_TEST_CACHED=true
  echo "$APPS_TO_TEST_CACHE"
}

# Check if an app has changes
app_has_changes() {
  local app_name="$1"

  if [ "$CHANGED_ONLY" = false ]; then
    return 0  # Always test if not in changed-only mode
  fi

  # Check if app is in the list of apps to test (includes transitive dependencies)
  if get_apps_to_test | grep -q "^${app_name}$"; then
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
