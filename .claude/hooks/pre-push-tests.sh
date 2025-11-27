#!/bin/bash

# PreToolUse Hook: Run tests before git push
# Intercepts git push commands and runs the full test suite

# Read hook input from stdin
input=$(cat)

# Extract command from JSON
command=$(echo "$input" | jq -r '.tool_input.command // empty')

# If no command found, allow silently
if [[ -z "$command" ]]; then
  echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}'
  exit 0
fi

# Check if this is a git push command
if [[ "$command" == "git push"* ]]; then
  # Run the test suite
  ./infrastructure/scripts/run-all-local-tests.sh
  test_exit_code=$?

  if [[ $test_exit_code -eq 0 ]]; then
    # Tests passed - allow the push
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "All tests passed. Proceeding with push."
  }
}
EOF
    exit 0
  else
    # Tests failed - deny the push
    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "TESTS FAILED: The test suite failed with exit code $test_exit_code. You must fix the failing tests before pushing. Run './infrastructure/scripts/run-all-local-tests.sh' to see the failures."
  }
}
EOF
    exit 0
  fi
fi

# Not a push command - allow silently
echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}'
exit 0
