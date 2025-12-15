#!/bin/bash
# Go TUI app test runner
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/makefile-utils.sh"

run_go_tui_tests() {
  local app_path="$1"
  local test_type="$2"
  local filter_args="$3"
  local extra_args="$4"

  local app_name=$(basename "$app_path")

  case "$test_type" in
    unit)
      # Check if test-unit target exists
      local makefile="${app_path}/Makefile"
      if ! makefile_has_target "$makefile" "test-unit"; then
        echo "Skipping unit tests for ${app_name} - no test-unit target defined"
        return 0
      fi

      # Run Go unit tests
      cd "$app_path"
      make test-unit $extra_args
      ;;
    e2e)
      # Check if test-e2e target exists
      local makefile="${app_path}/Makefile"
      if ! makefile_has_target "$makefile" "test-e2e"; then
        echo "Skipping e2e tests for ${app_name} - no test-e2e target defined"
        return 0
      fi

      # Run Go E2E tests
      cd "$app_path"
      make test-e2e $extra_args
      ;;
    *)
      echo "Unsupported test type for Go TUI app: $test_type"
      return 1
      ;;
  esac
}
