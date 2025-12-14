#!/bin/bash

# PostToolUse Hook: Enforce wiggum protocol - instructions are BINDING
# Triggers on wiggum MCP tool calls

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "decision": "allow",
    "reason": "WIGGUM PROTOCOL CHECK: You just called a wiggum MCP tool. Before responding to user, verify:\n\n## Pre-Response Checklist\n\n- [ ] Did I receive instructions from a wiggum tool?\n- [ ] Have I executed ALL those instructions?\n- [ ] Did a tool explicitly indicate workflow is complete?\n\nIf any answer is 'no', continue executing - do not respond."
  }
}
EOF
exit 0
