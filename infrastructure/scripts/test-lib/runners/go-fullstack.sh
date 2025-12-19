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

      # Timing instrumentation for CI debugging
      local start_time=$(date +%s)
      echo "[TIMING] E2E test run started at $(date)"

      # Auto-start emulators (idempotent - won't start if already running)
      echo "Setting up emulators for e2e tests..."
      source "$script_dir/allocate-test-ports.sh"
      local after_ports=$(date +%s)
      echo "[TIMING] Port allocation took $((after_ports - start_time)) seconds"

      source "$script_dir/start-emulators.sh"
      local after_emulators=$(date +%s)
      echo "[TIMING] Emulator startup took $((after_emulators - after_ports)) seconds"

      export GCP_PROJECT_ID="${GCP_PROJECT_ID:-demo-test}"

      # Log environment for debugging
      echo "[DEBUG] FIREBASE_AUTH_EMULATOR_HOST=$FIREBASE_AUTH_EMULATOR_HOST"
      echo "[DEBUG] FIRESTORE_EMULATOR_HOST=$FIRESTORE_EMULATOR_HOST"
      echo "[DEBUG] STORAGE_EMULATOR_HOST=$STORAGE_EMULATOR_HOST"

      # Build the app
      echo "Building ${app_name}..."
      cd "${app_path}/site"
      make build
      local after_build=$(date +%s)
      echo "[TIMING] Build took $((after_build - after_emulators)) seconds"

      # Run E2E tests via make and capture exit code
      echo "Running E2E tests..."
      cd "$app_path"
      make test-e2e $extra_args
      local test_exit=$?
      local after_tests=$(date +%s)
      echo "[TIMING] Tests took $((after_tests - after_build)) seconds"
      echo "[TIMING] Total E2E time: $((after_tests - start_time)) seconds"

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
