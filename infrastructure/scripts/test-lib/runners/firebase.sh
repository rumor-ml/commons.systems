#!/bin/bash
# Firebase app test runner

run_firebase_tests() {
  local app_path="$1"
  local test_type="$2"
  local filter_args="$3"
  local extra_args="$4"

  local app_name=$(basename "$app_path")
  local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  local root_dir="$(cd "$script_dir/../.." && pwd)"

  case "$test_type" in
    e2e)
      # Auto-start emulators (idempotent - won't start if already running)
      echo "Setting up emulators for e2e tests..."
      source "$script_dir/allocate-test-ports.sh"
      source "$script_dir/start-emulators.sh"

      export GCP_PROJECT_ID="${GCP_PROJECT_ID:-demo-test}"

      # Build the app
      echo "Building ${app_name}..."
      pnpm --dir "${app_path}/site" build

      # Run Playwright tests and capture exit code
      echo "Running Playwright tests..."
      cd "${app_path}/tests"
      npx playwright test $filter_args $extra_args
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
      cd "${app_path}/tests"
      npx playwright test $filter_args $extra_args
      ;;
    *)
      echo "Unsupported test type for Firebase app: $test_type"
      return 1
      ;;
  esac
}
