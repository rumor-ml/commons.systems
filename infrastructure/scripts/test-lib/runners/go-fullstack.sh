#!/bin/bash
# Go fullstack app test runner (unit + e2e)

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
      # Run Go unit tests (no emulators needed)
      echo "Running unit tests for ${app_name}..."
      cd "${app_path}/site"
      make test-unit $extra_args
      ;;
    e2e)
      # Auto-start emulators (idempotent - won't start if already running)
      echo "Setting up emulators for e2e tests..."
      source "$script_dir/allocate-test-ports.sh"
      source "$script_dir/start-emulators.sh"

      # Set up cleanup trap
      cleanup_emulators() {
        "$script_dir/stop-emulators.sh" 2>/dev/null || true
      }
      trap cleanup_emulators EXIT

      export GCP_PROJECT_ID="${GCP_PROJECT_ID:-demo-test}"

      # Build the app
      echo "Building ${app_name}..."
      cd "${app_path}/site"
      make build

      # Run E2E tests via make
      echo "Running E2E tests..."
      cd "$app_path"
      make test-e2e $extra_args
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
