#!/usr/bin/env bash

# PreToolUse Hook: Verify git operations match worktree branch
# Prevents accidental commits/pushes to wrong branch when working across multiple worktrees.
# Dependencies: jq (JSON processor)

# Get project root for worktree-local tmp
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LOG_FILE="${PROJECT_ROOT}/tmp/hooks/worktree-branch-guard.log"
MKDIR_ERROR=$(mkdir -p "${PROJECT_ROOT}/tmp/hooks" 2>&1)
if [ $? -ne 0 ]; then
  echo "{\"hookSpecificOutput\": {\"hookEventName\": \"PreToolUse\", \"permissionDecision\": \"deny\", \"permissionDecisionReason\": \"ERROR: Cannot create log directory at ${PROJECT_ROOT}/tmp/hooks\\n\\nError: ${MKDIR_ERROR}\\n\\nTo fix this issue:\\n1. Check disk space: df -h\\n2. Check permissions: ls -ld ${PROJECT_ROOT}/tmp\\n3. Ensure ${PROJECT_ROOT} is writable\\n\\nThis hook requires a log directory to operate.\"}}" | jq
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
if ! command=$(echo "$input" | jq -r '.tool_input.command // ""' 2>/dev/null); then
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

# Check if we're in a worktree directory (need to check this early)
current_dir=$(pwd)
log "Current directory: $current_dir"

in_worktree=false
if [[ "$current_dir" == "$HOME/worktrees/"* ]]; then
  in_worktree=true
  log "Detected worktree directory"
fi

# Determine operation type and whether to validate
needs_validation=false

case "$first_arg" in
  push|pull|merge)
    log "Detected destructive git operation: $first_arg"
    needs_validation=true
    ;;
  stash)
    # Only block stash creation operations (git stash, git stash push, git stash save)
    # Allow read-only operations like "git stash list" or "git stash show"
    # Parse: git stash [subcommand] - need to skip "git" and "stash" to get subcommand
    read -r _ _ stash_subcommand _ <<< "$command"
    if [[ -z "$stash_subcommand" || "$stash_subcommand" == "push" || "$stash_subcommand" == "save" ]]; then
      log "Detected stash creation operation (stash, stash push, stash save)"
      if [[ "$in_worktree" == true ]]; then
        deny "WORKTREE SAFETY: git stash is blocked in worktree directories to prevent stashing work from parallel agents.

Current directory: $current_dir

To stash changes, work in the main repository directory instead:
  cd ~/commons.systems/

This safety check prevents accidentally stashing uncommitted changes from other agents working in parallel."
      fi
    else
      allow  # stash list, stash show, etc. are read-only
    fi
    ;;
  checkout)
    # Block all checkout operations except file restoration (checkout -- <file>)
    # This includes branch switching, creating branches, and checking out commits
    # Parse: git checkout [args] - need to skip "git" and "checkout" to get first argument
    read -r _ _ checkout_target _ <<< "$command"
    if [[ "$checkout_target" == "--" ]]; then
      allow  # git checkout -- <file> is safe (file restoration)
    else
      log "Detected checkout operation (potential branch switch)"
      if [[ "$in_worktree" == true ]]; then
        deny "WORKTREE SAFETY: git checkout <branch> is blocked in worktree directories to prevent switching branches.

Current directory: $current_dir

Worktree directories are branch-specific. To work on a different branch:
  cd ~/worktrees/<branch-name>

This safety check prevents accidentally destroying work from other agents in parallel."
      fi
    fi
    ;;
  switch)
    log "Detected switch operation (branch switching)"
    if [[ "$in_worktree" == true ]]; then
      deny "WORKTREE SAFETY: git switch is blocked in worktree directories to prevent switching branches.

Current directory: $current_dir

Worktree directories are branch-specific. To work on a different branch:
  cd ~/worktrees/<branch-name>

This safety check prevents accidentally destroying work from other agents in parallel."
    fi
    ;;
  *)
    allow  # Not a destructive operation (fetch, log, commit, add, etc. are safe)
    ;;
esac

# Only validate branch matching if in worktree and operation requires it
if [[ "$in_worktree" == false ]]; then
  log "Not in ~/worktrees/ directory, skipping validation"
  allow
fi

if [[ "$needs_validation" == false ]]; then
  # Not a branch-matching operation (push/pull/merge)
  # All other operations (including stash/checkout/switch) were handled in the case statement
  allow
fi

# Get current branch name
if ! current_branch=$(git rev-parse --abbrev-ref HEAD 2>&1); then
  # Check if we're not in a git repo (common case outside worktrees)
  if [[ "$current_branch" =~ "not a git repository" ]]; then
    allow "Not in a git repository, skipping validation"
  fi
  # Sanitize error message (truncate if too long, escape special chars)
  sanitized_error=$(echo "$current_branch" | head -c 200 | tr '\n' ' ')
  deny "Unable to determine current git branch. Git error: $sanitized_error"
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
  1. Navigate to the correct worktree for branch '$current_branch':
     cd ~/worktrees/$current_branch

  2. Or if you need to work on branch '$expected_branch':
     Use the correct worktree directory that matches the branch

Note: This hook blocks branch-switching operations (checkout, switch) and stash operations
in worktree directories to prevent interference with parallel agent work.

This safety check prevents accidental commits/pushes to the wrong branch when working across multiple worktrees."
fi

# Branch matches directory - allow the operation
log "Branch validation passed: $current_branch == $expected_branch"
allow "Branch matches worktree directory."
