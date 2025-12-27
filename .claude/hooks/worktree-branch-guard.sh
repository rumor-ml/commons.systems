#!/bin/bash

# PreToolUse Hook: Verify git operations match worktree branch
# Prevents accidental commits/pushes to wrong branch when working across multiple worktrees.
# Dependencies: jq (JSON processor)

# Get project root for worktree-local tmp
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LOG_FILE="${PROJECT_ROOT}/tmp/hooks/worktree-branch-guard.log"
if ! mkdir -p "${PROJECT_ROOT}/tmp/hooks" 2>/dev/null; then
  echo '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "ERROR: Cannot create log directory tmp/hooks. Check permissions and disk space."}}'
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

log "=== Worktree branch guard hook started ==="

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
if ! command=$(echo "$input" | jq -r '.tool_input.command // empty' 2>/dev/null); then
  deny "Failed to parse JSON input. Ensure valid JSON with .tool_input.command field."
fi
log "Extracted command: $command"
[[ -z "$command" ]] && allow "Empty command field - no git operation to validate"

# Parse command into base and first argument
read -r base_cmd first_arg _ <<< "$command"
log "Base command: $base_cmd, First arg: $first_arg"

# Only intercept destructive git remote commands
if [[ "$base_cmd" != "git" ]]; then
  allow  # Not a git command
fi

# Check if this is a destructive remote operation
case "$first_arg" in
  push|pull|merge)
    log "Detected destructive git operation: $first_arg"
    ;;
  *)
    allow  # Not a destructive operation (fetch, log, commit, add, etc. are safe)
    ;;
esac

# Check if we're in a worktree directory
current_dir=$(pwd)
log "Current directory: $current_dir"

# Only validate if in ~/worktrees/ directory
if [[ "$current_dir" != "$HOME/worktrees/"* ]]; then
  log "Not in ~/worktrees/ directory, skipping validation"
  allow
fi

# Get current branch name
if ! current_branch=$(git rev-parse --abbrev-ref HEAD 2>&1); then
  deny "Unable to determine current git branch. Git error: $current_branch"
fi
log "Current branch: $current_branch"

# Get expected branch name from directory
expected_branch=$(basename "$current_dir")
log "Expected branch (from directory): $expected_branch"

# Validate branch matches directory
if [[ "$current_branch" != "$expected_branch" ]]; then
  deny "WORKTREE BRANCH MISMATCH: You are on branch '$current_branch' but in worktree directory '$expected_branch'.

Expected: Branch name should match directory name in ~/worktrees/

Current situation:
  - Directory: $current_dir
  - Branch:    $current_branch
  - Expected:  $expected_branch

To fix this issue:
  1. Switch to the correct branch:
     git checkout $expected_branch

  2. Or navigate to the correct worktree for branch '$current_branch':
     cd ~/worktrees/$current_branch

  3. Or if the branch doesn't exist yet:
     git checkout -b $expected_branch

This safety check prevents accidental commits/pushes to the wrong branch when working across multiple worktrees."
fi

# Branch matches directory - allow the operation
log "Branch validation passed: $current_branch == $expected_branch"
allow "Branch matches worktree directory."
