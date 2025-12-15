#!/bin/bash
# Consistent output formatting (text for local, JSON for CI)

# Global variables for tracking results
declare -a RESULTS_MODULES=()
declare -a RESULTS_TYPES=()
declare -a RESULTS_STATUS=()
declare -a RESULTS_OUTPUT=()

# Initialize output mode
OUTPUT_MODE="${OUTPUT_MODE:-text}"  # text or json

# Start output session
output_start() {
  local mode="${1:-$OUTPUT_MODE}"
  OUTPUT_MODE="$mode"

  if [[ "$OUTPUT_MODE" == "json" ]]; then
    echo "{"
    echo '  "results": ['
  fi
}

# Output a test run header
output_test_header() {
  local module_name="$1"
  local module_type="$2"
  local test_type="$3"

  if [[ "$OUTPUT_MODE" == "text" ]]; then
    echo ""
    echo "=========================================="
    echo "Testing: $module_name ($module_type) - $test_type"
    echo "=========================================="
  fi
}

# Record a test result
# Usage: output_test_result <module_name> <test_type> <status> <output>
output_test_result() {
  local module_name="$1"
  local test_type="$2"
  local status="$3"  # passed, failed, skipped
  local output="$4"

  RESULTS_MODULES+=("$module_name")
  RESULTS_TYPES+=("$test_type")
  RESULTS_STATUS+=("$status")
  RESULTS_OUTPUT+=("$output")

  if [[ "$OUTPUT_MODE" == "text" ]]; then
    if [[ "$status" == "passed" ]]; then
      echo "✓ $module_name ($test_type) passed"
    elif [[ "$status" == "failed" ]]; then
      echo "✗ $module_name ($test_type) failed"
      [[ -n "$output" ]] && echo "$output"
    elif [[ "$status" == "skipped" ]]; then
      echo "○ $module_name ($test_type) skipped"
    fi
  fi
}

# End output session with summary
output_end() {
  local exit_code="${1:-0}"

  if [[ "$OUTPUT_MODE" == "json" ]]; then
    # Output JSON results
    local first=true
    for i in "${!RESULTS_MODULES[@]}"; do
      if [ "$first" = true ]; then
        first=false
      else
        echo ","
      fi

      local output_escaped=$(echo "${RESULTS_OUTPUT[$i]}" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
      cat <<EOF
    {
      "module": "${RESULTS_MODULES[$i]}",
      "test_type": "${RESULTS_TYPES[$i]}",
      "status": "${RESULTS_STATUS[$i]}",
      "output": "$output_escaped"
    }
EOF
    done

    echo ""
    echo "  ],"

    # Count results
    local total=${#RESULTS_MODULES[@]}
    local passed=$(printf '%s\n' "${RESULTS_STATUS[@]}" | grep -c "passed" || true)
    local failed=$(printf '%s\n' "${RESULTS_STATUS[@]}" | grep -c "failed" || true)
    local skipped=$(printf '%s\n' "${RESULTS_STATUS[@]}" | grep -c "skipped" || true)

    cat <<EOF
  "summary": {
    "total": $total,
    "passed": $passed,
    "failed": $failed,
    "skipped": $skipped
  },
  "exit_code": $exit_code
}
EOF
  else
    # Text summary
    echo ""
    echo "=========================================="
    echo "Test Summary"
    echo "=========================================="

    local total=${#RESULTS_MODULES[@]}
    local passed=$(printf '%s\n' "${RESULTS_STATUS[@]}" | grep -c "passed" || true)
    local failed=$(printf '%s\n' "${RESULTS_STATUS[@]}" | grep -c "failed" || true)
    local skipped=$(printf '%s\n' "${RESULTS_STATUS[@]}" | grep -c "skipped" || true)

    echo "Total: $total"
    echo "Passed: $passed"
    echo "Failed: $failed"
    echo "Skipped: $skipped"

    if [[ $exit_code -eq 0 ]]; then
      echo ""
      echo "All tests passed!"
    else
      echo ""
      echo "Some tests failed!"
    fi
  fi
}

# List modules (dry run mode)
output_list_modules() {
  local modules="$1"

  if [[ "$OUTPUT_MODE" == "json" ]]; then
    echo "{"
    echo '  "modules": ['

    local first=true
    while IFS=: read -r name type path; do
      if [ "$first" = true ]; then
        first=false
      else
        echo ","
      fi

      cat <<EOF
    {
      "name": "$name",
      "type": "$type",
      "path": "$path"
    }
EOF
    done <<< "$modules"

    echo ""
    echo "  ]"
    echo "}"
  else
    echo "Modules to test:"
    echo ""
    while IFS=: read -r name type path; do
      echo "  - $name ($type)"
    done <<< "$modules"
  fi
}
