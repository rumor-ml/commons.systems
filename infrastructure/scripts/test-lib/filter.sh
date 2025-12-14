#!/bin/bash
# Filter logic for module/type/file/name

# Filter modules by comma-separated list
# Usage: filter_by_modules <modules_csv> <module_name>
# Returns: 0 if module matches, 1 otherwise
filter_by_modules() {
  local modules_csv="$1"
  local module_name="$2"

  [[ -z "$modules_csv" ]] && return 0

  # Split by comma and check if module_name is in list
  IFS=',' read -ra MODULES <<< "$modules_csv"
  for mod in "${MODULES[@]}"; do
    [[ "$mod" == "$module_name" ]] && return 0
  done

  return 1
}

# Check if module type supports test type
# Usage: supports_test_type <module_type> <test_type>
# Returns: 0 if supported, 1 otherwise
supports_test_type() {
  local module_type="$1"
  local test_type="$2"

  case "$module_type" in
    firebase)
      [[ "$test_type" == "e2e" || "$test_type" == "deployed-e2e" ]] && return 0
      ;;
    go-fullstack)
      [[ "$test_type" == "unit" || "$test_type" == "e2e" || "$test_type" == "deployed-e2e" ]] && return 0
      ;;
    go-tui)
      [[ "$test_type" == "unit" || "$test_type" == "e2e" ]] && return 0
      ;;
    go-package)
      [[ "$test_type" == "unit" ]] && return 0
      ;;
    mcp-server)
      [[ "$test_type" == "unit" ]] && return 0
      ;;
  esac

  return 1
}

# Get changed modules by comparing with main branch
# Usage: get_changed_modules <root_dir>
# Output: comma-separated list of changed module names
get_changed_modules() {
  local root_dir="$1"
  local changed_dirs=""

  # Get list of changed files vs main
  local changed_files=$(git -C "$root_dir" diff --name-only main...HEAD 2>/dev/null || echo "")

  if [[ -z "$changed_files" ]]; then
    # If no diff (maybe we're on main), return empty
    echo ""
    return
  fi

  # Extract top-level directories from changed files
  local dirs=$(echo "$changed_files" | cut -d'/' -f1 | sort -u)

  # Build comma-separated list
  local first=true
  for dir in $dirs; do
    # Skip infrastructure, shared, etc.
    [[ "$dir" == "infrastructure" ]] && continue
    [[ "$dir" == "shared" ]] && continue
    [[ "$dir" == "pkg" ]] && continue
    [[ "$dir" == ".github" ]] && continue
    [[ "$dir" == ".claude" ]] && continue

    if [ "$first" = true ]; then
      changed_dirs="$dir"
      first=false
    else
      changed_dirs="$changed_dirs,$dir"
    fi
  done

  echo "$changed_dirs"
}

# Build framework-specific filter arguments
# Usage: build_filter_args <test_type> <file_pattern> <name_filter>
# Output: Filter arguments for the test framework
build_filter_args() {
  local test_type="$1"
  local file_pattern="$2"
  local name_filter="$3"
  local args=""

  # Playwright (for e2e tests)
  if [[ "$test_type" == "e2e" || "$test_type" == "deployed-e2e" ]]; then
    [[ -n "$file_pattern" ]] && args="$args $file_pattern"
    [[ -n "$name_filter" ]] && args="$args --grep '$name_filter'"
  fi

  # Go tests (for unit tests)
  if [[ "$test_type" == "unit" ]]; then
    [[ -n "$name_filter" ]] && args="$args -run '$name_filter'"
  fi

  echo "$args"
}
