#!/bin/bash
# Go fullstack app test runner (unit + e2e)
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/makefile-utils.sh"

run_go_fullstack_tests() {
  local app_path="$1"
  local test_type="$2"
  local filter_args="$3"
  local extra_args="$4"

  local app_name=$(basename "$app_path")
  local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  local root_dir="$(cd "$script_dir/../.." && pwd)"

  case "$test_type" in
    unit)
      # Check if test-unit target exists
      local makefile="${app_path}/site/Makefile"
      if ! makefile_has_target "$makefile" "test-unit"; then
        echo "Skipping unit tests for ${app_name} - no test-unit target defined"
        return 0
      fi

      # Run Go unit tests (no emulators needed)
      echo "Running unit tests for ${app_name}..."
      cd "${app_path}/site"
      make test-unit $extra_args
      ;;
    e2e)
      # Check if test-e2e target exists
      local makefile="${app_path}/Makefile"
      if ! makefile_has_target "$makefile" "test-e2e"; then
        echo "Skipping e2e tests for ${app_name} - no test-e2e target defined"
        return 0
      fi

      # Auto-start emulators (idempotent - won't start if already running)
      echo "Setting up emulators for e2e tests..."
      source "$script_dir/allocate-test-ports.sh"
      source "$script_dir/start-emulators.sh"

      export GCP_PROJECT_ID="${GCP_PROJECT_ID:-demo-test}"

      # Build the app
      echo "Building ${app_name}..."
      cd "${app_path}/site"
      make build

      # Run E2E tests via make and capture exit code
      echo "Running E2E tests..."
      cd "$app_path"
      make test-e2e $extra_args
      local test_exit=$?

      # Clean up emulators (always run, ignore errors)
      "$script_dir/stop-emulators.sh" 2>/dev/null || true

      # Return the test exit code, not cleanup exit code
      return $test_exit
      ;;
    deployed-e2e)
      # No emulators for deployed tests
      export DEPLOYED=true

      echo "Running deployed e2e tests (no emulators)..."
      cd "$app_path"
      make test-e2e $extra_args
      ;;
    *)
      echo "Unsupported test type for Go fullstack app: $test_type"
      return 1
      ;;
  esac
}
