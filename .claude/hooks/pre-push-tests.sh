#!/bin/bash

# PreToolUse Hook: Run tests before git push
# Intercepts git push commands and runs the full test suite before allowing the push.
# Dependencies: jq (JSON processor)

LOG_FILE="/tmp/claude/pre-push-hook.log"
if ! mkdir -p /tmp/claude 2>/dev/null; then
  echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "ERROR: Cannot create log directory /tmp/claude. Check permissions and disk space."}}'
  exit 0
fi

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE" 2>&1
}

# Output JSON response for Claude Code hooks
output_json() {
  local decision="$1"
  local reason="$2"
  jq -n --arg d "$decision" --arg r "$reason" \
    'if $r == "" then {hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: $d}}
     else {hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: $d, permissionDecisionReason: $r}} end'
}

# Deny with error message and exit
deny() {
  log "ERROR: $1"
  output_json "deny" "$1"
  exit 0
}

# Allow and exit
allow() {
  local reason="${1:-}"
  log "${reason:-Allowing}"
  output_json "allow" "$reason"
  exit 0
}

log "=== Pre-push hook started ==="

# Verify jq dependency (must output raw JSON since jq unavailable)
if ! command -v jq &> /dev/null; then
  log "ERROR: jq not found"
  echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "ERROR: jq is required but not installed. Install it with: brew install jq (macOS) or apt-get install jq (Linux)"}}'
  exit 0
fi

# Read and validate hook input
input=$(cat)
log "Received input: $input"
[[ -z "$input" ]] && deny "Hook received no input"

# Extract command from JSON - allow if not a Bash tool call
if ! command=$(echo "$input" | jq -r '.tool_input.command // empty' 2>&1); then
  deny "Hook received malformed JSON input. jq error: $command"
fi
log "Extracted command: $command"
[[ -z "$command" ]] && allow

# Parse command into base and first argument
read -r base_cmd first_arg _ <<< "$command"
log "Base command: $base_cmd, First arg: $first_arg"

# Only intercept git push commands
[[ "$base_cmd" != "git" || "$first_arg" != "push" ]] && allow

log "Detected git push command - running tests"

# Validate working directory
repo_root=$(git rev-parse --show-toplevel 2>&1) || \
  deny "Unable to find git repository root. Are you in a git repository?"
log "Repository root: $repo_root"
if ! cd_error=$(cd "$repo_root" 2>&1); then
  deny "Failed to change to repository root: $repo_root. Error: $cd_error"
fi

# Validate test script
test_script="$repo_root/infrastructure/scripts/test.sh"
[[ ! -f "$test_script" ]] && deny "Test script not found at $test_script"
[[ ! -x "$test_script" ]] && deny "Test script exists but is not executable: $test_script. Run: chmod +x $test_script"

# Run tests with timeout protection (10 minutes max)
log "Running test script: $test_script"
test_output_file="/tmp/claude/pre-push-test-output-$$.txt"
if ! touch "$test_output_file" 2>/dev/null; then
  deny "Cannot create test output file at $test_output_file. Check /tmp/claude permissions and disk space."
fi
timeout 600 "$test_script" --changed-only --ci > "$test_output_file" 2>&1
test_exit_code=$?
log "Test exit code: $test_exit_code"

# Handle test results
case $test_exit_code in
  0)
    allow "All tests passed. Proceeding with push."
    ;;
  124)
    deny "TESTS TIMED OUT: The test suite exceeded the 10-minute timeout. This may indicate hanging tests or infinite loops. Check the test output at: $test_output_file"
    ;;
  *)
    if [[ ! -f "$test_output_file" ]]; then
      failure_summary="Test output file was deleted or never created: $test_output_file"
    elif [[ ! -r "$test_output_file" ]]; then
      failure_summary="Cannot read test output file (permission denied): $test_output_file"
    else
      failure_summary=$(tail -n 10 "$test_output_file" 2>&1) || failure_summary="Failed to read test output: $test_output_file"
    fi
    deny "TESTS FAILED: The full test suite failed with exit code $test_exit_code. You must fix the failing tests before pushing.

Full test output saved to: $test_output_file

Last 10 lines of output:
$failure_summary

Run '$test_script' to see all failures."
    ;;
esac
