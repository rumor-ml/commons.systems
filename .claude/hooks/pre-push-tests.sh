#!/bin/bash

# PreToolUse Hook: Run tests before git push
# Intercepts git push commands and runs the full test suite before allowing the push.
# This ensures code quality by preventing pushes when tests fail.
#
# Dependencies: jq (JSON processor)

# Log file for debugging (stderr to avoid interfering with stdout JSON)
LOG_FILE="/tmp/claude/pre-push-hook.log"
mkdir -p /tmp/claude

# Helper function to log with timestamp to stderr
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE" 2>&1
}

log "=== Pre-push hook started ==="

# Helper function to output JSON using jq -n (guarantees valid JSON)
output_json() {
  local decision="$1"
  local reason="${2:-}"

  if [[ -n "$reason" ]]; then
    jq -n --arg decision "$decision" --arg reason "$reason" \
      '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: $decision, permissionDecisionReason: $reason}}'
  else
    jq -n --arg decision "$decision" \
      '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: $decision}}'
  fi
}

# Critical Fix #2: Verify jq dependency
if ! command -v jq &> /dev/null; then
  log "ERROR: jq not found"
  echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "ERROR: jq is required but not installed. Install it with: brew install jq (macOS) or apt-get install jq (Linux)"}}' >&2
  exit 1
fi

# Read hook input from stdin
input=$(cat)
log "Received input: $input"

# Critical Fix #4: Better empty input handling
# Distinguish between "no input at all" (deny) vs "no command field" (allow)
if [[ -z "$input" ]]; then
  log "ERROR: No input received from stdin"
  output_json "deny" "ERROR: Hook received no input"
  exit 0
fi

# Extract command from JSON
command=$(echo "$input" | jq -r '.tool_input.command // empty')
log "Extracted command: $command"

# If no command field found, allow silently (not a Bash tool call)
if [[ -z "$command" ]]; then
  log "No command field - allowing silently"
  output_json "allow"
  exit 0
fi

# Important Fix #5: Consistent pattern matching
# Extract base command and first argument like sandbox-reminder.sh
base_cmd=$(echo "$command" | awk '{print $1}')
first_arg=$(echo "$command" | awk '{print $2}')
log "Base command: $base_cmd, First arg: $first_arg"

# Check if this is a git push command
if [[ "$base_cmd" == "git" && "$first_arg" == "push" ]]; then
  log "Detected git push command - running tests"

  # Critical Fix #1: Working directory validation
  # Find the repository root and cd to it before running tests
  repo_root=$(git rev-parse --show-toplevel 2>&1)
  if [[ $? -ne 0 ]]; then
    log "ERROR: Not in a git repository"
    output_json "deny" "ERROR: Unable to find git repository root. Are you in a git repository?"
    exit 0
  fi

  log "Repository root: $repo_root"
  cd "$repo_root" || {
    log "ERROR: Failed to cd to repo root"
    output_json "deny" "ERROR: Failed to change to repository root: $repo_root"
    exit 0
  }

  # Critical Fix #3: Test script validation
  # Use absolute path after finding repo root
  test_script="$repo_root/infrastructure/scripts/run-all-local-tests.sh"

  if [[ ! -f "$test_script" ]]; then
    log "ERROR: Test script not found at $test_script"
    output_json "deny" "ERROR: Test script not found at $test_script"
    exit 0
  fi

  if [[ ! -x "$test_script" ]]; then
    log "ERROR: Test script not executable"
    output_json "deny" "ERROR: Test script exists but is not executable: $test_script. Run: chmod +x $test_script"
    exit 0
  fi

  log "Running test script: $test_script"

  # Suggestion #7: Improved error messages
  # Capture test output to a temporary file for better debugging
  test_output_file="/tmp/claude/pre-push-test-output-$$.txt"

  # Important Fix #6: Timeout protection
  # Use timeout to prevent hanging tests (10 minutes max)
  timeout 600 "$test_script" > "$test_output_file" 2>&1
  test_exit_code=$?

  log "Test exit code: $test_exit_code"

  # Check for timeout (exit code 124)
  if [[ $test_exit_code -eq 124 ]]; then
    log "ERROR: Tests timed out after 10 minutes"
    output_json "deny" "TESTS TIMED OUT: The test suite exceeded the 10-minute timeout. This may indicate hanging tests or infinite loops. Check the test output at: $test_output_file"
    exit 0
  fi

  if [[ $test_exit_code -eq 0 ]]; then
    # Tests passed - allow the push
    log "Tests passed - allowing push"
    output_json "allow" "All tests passed. Proceeding with push."
    exit 0
  else
    # Tests failed - deny the push
    log "Tests failed with exit code $test_exit_code"

    # Suggestion #7: Include summary of failures in deny message
    # Get last 10 lines of output for context
    failure_summary=$(tail -n 10 "$test_output_file" 2>/dev/null || echo "Unable to read test output")

    deny_message="TESTS FAILED: The full test suite failed with exit code $test_exit_code. You must fix the failing tests before pushing.

Full test output saved to: $test_output_file

Last 10 lines of output:
$failure_summary

Run '$test_script' to see all failures."

    output_json "deny" "$deny_message"
    exit 0
  fi
fi

# Not a git push command - allow silently
log "Not a git push command - allowing silently"
output_json "allow"
exit 0
