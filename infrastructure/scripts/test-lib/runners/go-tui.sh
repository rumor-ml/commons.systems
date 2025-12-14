#!/bin/bash
# Go TUI app test runner

run_go_tui_tests() {
  local app_path="$1"
  local test_type="$2"
  local filter_args="$3"
  local extra_args="$4"

  local app_name=$(basename "$app_path")

  case "$test_type" in
    unit)
      # Run Go unit tests
      cd "$app_path"
      make test-unit $extra_args
      ;;
    e2e)
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
