#!/bin/bash
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
