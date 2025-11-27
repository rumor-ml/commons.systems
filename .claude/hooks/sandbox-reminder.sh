#!/bin/bash

# PreToolUse Hook: Remind about dangerouslyDisableSandbox for excluded commands
# Dynamically reads excluded commands from settings.json

SETTINGS_FILE=".claude/settings.json"

# Read hook input from stdin
input=$(cat)

# Extract command from JSON
command=$(echo "$input" | jq -r '.tool_input.command // empty')

# If no command found, allow silently
if [[ -z "$command" ]]; then
  echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}'
  exit 0
fi

# Read excluded commands from settings.json
if [[ ! -f "$SETTINGS_FILE" ]]; then
  echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}'
  exit 0
fi

# Parse excluded commands as JSON array
excluded_json=$(jq -r '.sandbox.excludedCommands // []' "$SETTINGS_FILE")

# Get the first word (base command)
base_cmd=$(echo "$command" | awk '{print $1}')

# Check each excluded command
while IFS= read -r excluded; do
  [[ -z "$excluded" ]] && continue

  # Handle multi-word commands like "go mod tidy"
  if [[ "$excluded" == *" "* ]]; then
    # Multi-word: check if command starts with it
    if [[ "$command" == "$excluded"* ]]; then
      cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "SANDBOX REMINDER: '$excluded' is in sandbox.excludedCommands. You MUST use dangerouslyDisableSandbox: true for this command to work correctly."
  }
}
EOF
      exit 0
    fi
  else
    # Single word: check base command
    if [[ "$base_cmd" == "$excluded" ]]; then
      cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "SANDBOX REMINDER: '$base_cmd' is in sandbox.excludedCommands. You MUST use dangerouslyDisableSandbox: true for this command to work correctly."
  }
}
EOF
      exit 0
    fi
  fi
done < <(echo "$excluded_json" | jq -r '.[]')

# No match - allow silently
echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}'
exit 0
