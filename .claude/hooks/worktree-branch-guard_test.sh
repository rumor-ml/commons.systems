#!/usr/bin/env bash
# Tests for worktree-branch-guard.sh
# Tests the hook's ability to parse input and validate operations

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/worktree-branch-guard.sh"
FAILURES=0
PASSES=0

# Helper to run hook with input and check decision
run_and_check() {
  local input="$1"
  local expected_decision="$2"
  local description="$3"

  local output
  output=$(echo "$input" | "$HOOK" 2>/dev/null)

  local decision
  # TODO(#1506): Test suite lacks verification of JSON output format conformance
  decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)

  if [[ "$decision" == "$expected_decision" ]]; then
    echo "✓ PASS: $description"
    ((PASSES++))
    return 0
  else
    echo "✗ FAIL: $description"
    echo "  Expected: $expected_decision"
    echo "  Got: $decision"
    echo "  Output: $output"
    ((FAILURES++))
    return 1
  fi
}

echo "Running worktree-branch-guard tests..."
echo ""

# Test 1: Non-git command should allow
run_and_check '{"tool_input":{"command":"ls -la"}}' "allow" \
  "Non-git command (ls) should allow"

# Test 2: Safe git command should allow
run_and_check '{"tool_input":{"command":"git status"}}' "allow" \
  "Safe git command (git status) should allow"

# Test 3: git log should allow
run_and_check '{"tool_input":{"command":"git log"}}' "allow" \
  "Safe git command (git log) should allow"

# Test 4: git diff should allow
run_and_check '{"tool_input":{"command":"git diff"}}' "allow" \
  "Safe git command (git diff) should allow"

# Test 5: git add should allow
run_and_check '{"tool_input":{"command":"git add file.txt"}}' "allow" \
  "Safe git command (git add) should allow"

# Test 6: git commit should allow
run_and_check '{"tool_input":{"command":"git commit -m msg"}}' "allow" \
  "Safe git command (git commit) should allow"

# Test 7: Empty command should allow (not a destructive op)
run_and_check '{"tool_input":{"command":""}}' "allow" \
  "Empty command should allow"

# Test 8: Missing command field should allow (non-Bash tool)
run_and_check '{"tool_input":{}}' "allow" \
  "Missing command field should allow"

# Test 9: Malformed JSON should deny
run_and_check 'invalid json' "deny" \
  "Malformed JSON should deny"

# Test 10: Empty input should deny
run_and_check '' "deny" \
  "Empty input should deny"

# Integration tests for core branch validation logic
echo ""
echo "Running integration tests for branch validation..."
echo ""

# Create a temporary git repo to test branch matching
# TODO(#1505): Use comprehensive trap handling for multiple signals (EXIT INT TERM)
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

cd "$TEMP_DIR" || exit 1
# TODO(#1501): Add error checking for git commands during test setup
git init --quiet
git config user.email "test@example.com"
git config user.name "Test User"
echo "test" > file.txt
git add file.txt
git commit -q -m "Initial commit"

# Test 11: git push in non-worktree directory should allow (not in ~/worktrees/)
output=$(echo '{"tool_input":{"command":"git push"}}' | "$HOOK" 2>/dev/null)
decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
if [[ "$decision" == "allow" ]]; then
  echo "✓ PASS: git push outside worktree directory should allow"
  ((PASSES++))
else
  echo "✗ FAIL: git push outside worktree directory should allow"
  echo "  Got: $decision"
  ((FAILURES++))
fi

# Test 12: git pull in non-worktree directory should allow
output=$(echo '{"tool_input":{"command":"git pull"}}' | "$HOOK" 2>/dev/null)
decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
if [[ "$decision" == "allow" ]]; then
  echo "✓ PASS: git pull outside worktree directory should allow"
  ((PASSES++))
else
  echo "✗ FAIL: git pull outside worktree directory should allow"
  echo "  Got: $decision"
  ((FAILURES++))
fi

# Test 13: git merge in non-worktree directory should allow
output=$(echo '{"tool_input":{"command":"git merge"}}' | "$HOOK" 2>/dev/null)
decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
if [[ "$decision" == "allow" ]]; then
  echo "✓ PASS: git merge outside worktree directory should allow"
  ((PASSES++))
else
  echo "✗ FAIL: git merge outside worktree directory should allow"
  echo "  Got: $decision"
  ((FAILURES++))
fi

# Create worktree-like test scenario: fake HOME to have ~/worktrees/ structure
# TODO(#1505): Use comprehensive trap handling for multiple signals (EXIT INT TERM)
FAKE_HOME=$(mktemp -d)
trap "rm -rf $TEMP_DIR $FAKE_HOME" EXIT

# Create fake worktree directory with matching branch name
mkdir -p "$FAKE_HOME/worktrees/test-branch"
cd "$FAKE_HOME/worktrees/test-branch" || exit 1

# Initialize git repo
git init --quiet
git config user.email "test@example.com"
git config user.name "Test User"
echo "test" > file.txt
git add file.txt
git commit -q -m "Initial commit"
git checkout -q -b test-branch

# TODO(#1504): Extend run_and_check to accept HOME parameter to consolidate repetitive test pattern
# Test 14: Matching branch name should allow push
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git push"}}' | "$HOOK" 2>/dev/null)
decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
if [[ "$decision" == "allow" ]]; then
  echo "✓ PASS: git push with matching branch name should allow"
  ((PASSES++))
else
  echo "✗ FAIL: git push with matching branch name should allow"
  echo "  Expected: allow"
  echo "  Got: $decision"
  ((FAILURES++))
fi

# Test 15: Mismatched branch name should deny push
git checkout -q -b wrong-branch
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git push"}}' | "$HOOK" 2>/dev/null)
decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
if [[ "$decision" == "deny" ]]; then
  echo "✓ PASS: git push with mismatched branch name should deny"
  ((PASSES++))
else
  echo "✗ FAIL: git push with mismatched branch name should deny"
  echo "  Expected: deny"
  echo "  Got: $decision"
  ((FAILURES++))
fi

# Test 16: Mismatched branch should provide helpful error message
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git pull"}}' | "$HOOK" 2>/dev/null)
reason=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null)
if [[ "$reason" =~ "WORKTREE BRANCH MISMATCH" ]]; then
  echo "✓ PASS: Deny message includes helpful guidance"
  ((PASSES++))
else
  echo "✗ FAIL: Deny message should include WORKTREE BRANCH MISMATCH"
  echo "  Got: $reason"
  ((FAILURES++))
fi

# Switch back to matching branch for next tests
git checkout -q test-branch

# Test 17: git stash in worktree should deny (to prevent stashing parallel agent work)
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git stash"}}' | "$HOOK" 2>/dev/null)
decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
if [[ "$decision" == "deny" ]]; then
  echo "✓ PASS: git stash in worktree should deny"
  ((PASSES++))
else
  echo "✗ FAIL: git stash in worktree should deny (got: $decision)"
  ((FAILURES++))
fi

# Test 18: git stash push variant should also deny
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git stash push -m test"}}' | "$HOOK" 2>/dev/null)
decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
if [[ "$decision" == "deny" ]]; then
  echo "✓ PASS: git stash push in worktree should deny"
  ((PASSES++))
else
  echo "✗ FAIL: git stash push in worktree should deny (got: $decision)"
  ((FAILURES++))
fi

# Test 19: git checkout <branch> in worktree should deny (to prevent switching branches)
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git checkout main"}}' | "$HOOK" 2>/dev/null)
decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
if [[ "$decision" == "deny" ]]; then
  echo "✓ PASS: git checkout <branch> in worktree should deny"
  ((PASSES++))
else
  echo "✗ FAIL: git checkout <branch> in worktree should deny (got: $decision)"
  ((FAILURES++))
fi

# Test 20: git checkout -b variant should also deny
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git checkout -b new-branch"}}' | "$HOOK" 2>/dev/null)
decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
if [[ "$decision" == "deny" ]]; then
  echo "✓ PASS: git checkout -b in worktree should deny"
  ((PASSES++))
else
  echo "✗ FAIL: git checkout -b in worktree should deny (got: $decision)"
  ((FAILURES++))
fi

# Test 21: git switch <branch> in worktree should deny
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git switch main"}}' | "$HOOK" 2>/dev/null)
decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
if [[ "$decision" == "deny" ]]; then
  echo "✓ PASS: git switch <branch> in worktree should deny"
  ((PASSES++))
else
  echo "✗ FAIL: git switch <branch> in worktree should deny (got: $decision)"
  ((FAILURES++))
fi

# Test 22: git switch -c variant should also deny
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git switch -c new-branch"}}' | "$HOOK" 2>/dev/null)
decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
if [[ "$decision" == "deny" ]]; then
  echo "✓ PASS: git switch -c in worktree should deny"
  ((PASSES++))
else
  echo "✗ FAIL: git switch -c in worktree should deny (got: $decision)"
  ((FAILURES++))
fi

# Test 23: git checkout -- <file> (non-branch operation) should allow
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git checkout -- file.txt"}}' | "$HOOK" 2>/dev/null)
decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
if [[ "$decision" == "allow" ]]; then
  echo "✓ PASS: git checkout -- <file> in worktree should allow"
  ((PASSES++))
else
  echo "✗ FAIL: git checkout -- <file> in worktree should allow (got: $decision)"
  ((FAILURES++))
fi

# Test 24: git stash list (read-only) should allow
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git stash list"}}' | "$HOOK" 2>/dev/null)
decision=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)
if [[ "$decision" == "allow" ]]; then
  echo "✓ PASS: git stash list in worktree should allow"
  ((PASSES++))
else
  echo "✗ FAIL: git stash list in worktree should allow (got: $decision)"
  ((FAILURES++))
fi

# === Error Message Content Tests ===
echo ""
echo "Testing error message quality and user guidance..."
echo ""

# Test 25: Stash error message explains worktree safety
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git stash"}}' | "$HOOK" 2>/dev/null)
reason=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null)
failed=false
if [[ ! "$reason" =~ "WORKTREE SAFETY" ]]; then
  echo "✗ FAIL: Stash error should include 'WORKTREE SAFETY' header"
  failed=true
fi
if [[ ! "$reason" =~ "git stash is blocked" ]]; then
  echo "✗ FAIL: Stash error should explain that git stash is blocked"
  failed=true
fi
if [[ ! "$reason" =~ "parallel agents" ]]; then
  echo "✗ FAIL: Stash error should mention parallel agents"
  failed=true
fi
if [[ ! "$reason" =~ "~/commons.systems" ]]; then
  echo "✗ FAIL: Stash error should suggest ~/commons.systems as alternative"
  failed=true
fi
if [[ "$failed" == false ]]; then
  echo "✓ PASS: Stash error message contains key elements"
  ((PASSES++))
else
  echo "  Full message: $reason"
  ((FAILURES++))
fi

# Test 26: Checkout error message provides correct guidance
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git checkout main"}}' | "$HOOK" 2>/dev/null)
reason=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null)
failed=false
if [[ ! "$reason" =~ "WORKTREE SAFETY" ]]; then
  echo "✗ FAIL: Checkout error should include 'WORKTREE SAFETY' header"
  failed=true
fi
if [[ ! "$reason" =~ "cd ~/worktrees/" ]]; then
  echo "✗ FAIL: Checkout error should suggest cd ~/worktrees/<branch-name>"
  failed=true
fi
if [[ ! "$reason" =~ "branch-specific" ]]; then
  echo "✗ FAIL: Checkout error should explain worktrees are branch-specific"
  failed=true
fi
if [[ "$reason" =~ "git checkout -b" ]]; then
  echo "✗ FAIL: Checkout error should NOT suggest git checkout -b (also blocked)"
  failed=true
fi
if [[ "$failed" == false ]]; then
  echo "✓ PASS: Checkout error message contains correct guidance"
  ((PASSES++))
else
  echo "  Full message: $reason"
  ((FAILURES++))
fi

# Test 27: Switch error message provides correct guidance
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git switch main"}}' | "$HOOK" 2>/dev/null)
reason=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null)
failed=false
if [[ ! "$reason" =~ "WORKTREE SAFETY" ]]; then
  echo "✗ FAIL: Switch error should include 'WORKTREE SAFETY' header"
  failed=true
fi
if [[ ! "$reason" =~ "cd ~/worktrees/" ]]; then
  echo "✗ FAIL: Switch error should suggest cd ~/worktrees/<branch-name>"
  failed=true
fi
if [[ ! "$reason" =~ "agents in parallel" ]]; then
  echo "✗ FAIL: Switch error should mention agents in parallel"
  failed=true
fi
if [[ "$failed" == false ]]; then
  echo "✓ PASS: Switch error message contains correct guidance"
  ((PASSES++))
else
  echo "  Full message: $reason"
  ((FAILURES++))
fi

# Test 28: Branch mismatch error provides detailed context
# Switch to wrong-branch if not already on it, or force recreate
git branch -D wrong-branch 2>/dev/null || true
git checkout -q -b wrong-branch
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git pull"}}' | "$HOOK" 2>/dev/null)
reason=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null)
failed=false
if [[ ! "$reason" =~ "WORKTREE BRANCH MISMATCH" ]]; then
  echo "✗ FAIL: Mismatch error should include 'WORKTREE BRANCH MISMATCH' header"
  failed=true
fi
if [[ ! "$reason" =~ "Directory:" ]]; then
  echo "✗ FAIL: Mismatch error should show current directory"
  failed=true
fi
if [[ ! "$reason" =~ "Branch:" ]]; then
  echo "✗ FAIL: Mismatch error should show current branch"
  failed=true
fi
if [[ ! "$reason" =~ "Expected:" ]]; then
  echo "✗ FAIL: Mismatch error should show expected branch"
  failed=true
fi
if [[ ! "$reason" =~ "cd ~/worktrees/" ]]; then
  echo "✗ FAIL: Mismatch error should suggest cd to correct worktree"
  failed=true
fi
if [[ "$failed" == false ]]; then
  echo "✓ PASS: Branch mismatch error provides detailed context"
  ((PASSES++))
else
  echo "  Full message: $reason"
  ((FAILURES++))
fi

# Test 29: Stash push variant has same quality error message
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git stash push -m test"}}' | "$HOOK" 2>/dev/null)
reason=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null)
if [[ "$reason" =~ "WORKTREE SAFETY" ]] && [[ "$reason" =~ "parallel agents" ]]; then
  echo "✓ PASS: Stash push error has same quality guidance"
  ((PASSES++))
else
  echo "✗ FAIL: Stash push error should match stash error quality"
  echo "  Full message: $reason"
  ((FAILURES++))
fi

# Test 30: Error messages don't include confusing technical jargon
HOME=$FAKE_HOME output=$(echo '{"tool_input":{"command":"git checkout develop"}}' | "$HOOK" 2>/dev/null)
reason=$(echo "$output" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null)
failed=false
# Should NOT contain overly technical terms without explanation
if [[ "$reason" =~ "rev-parse" ]] || [[ "$reason" =~ "HEAD" ]]; then
  echo "✗ FAIL: Error messages should avoid unexplained git internals (rev-parse, HEAD)"
  failed=true
fi
# SHOULD contain clear user-facing terms
if [[ ! "$reason" =~ "branch" ]]; then
  echo "✗ FAIL: Error message should use clear term 'branch'"
  failed=true
fi
if [[ "$failed" == false ]]; then
  echo "✓ PASS: Error messages use clear, user-friendly language"
  ((PASSES++))
else
  echo "  Full message: $reason"
  ((FAILURES++))
fi


# Summary
echo ""
echo "================================"
echo "Passed: $PASSES"
echo "Failed: $FAILURES"
echo "================================"

if [ $FAILURES -eq 0 ]; then
  echo "All tests passed!"
  exit 0
else
  echo "$FAILURES test(s) failed"
  exit 1
fi
