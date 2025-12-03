#!/bin/bash

# PostToolUse Hook: Remind to use Task tool after exiting plan mode
# Triggers on ExitPlanMode tool completion

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "decision": "allow",
    "reason": "IMPLEMENTATION REMINDER: You have exited plan mode. Per CLAUDE.md, do NOT make edits directly. Use the Task tool with subagent_type='accept-edits' to execute the plan."
  }
}
EOF
exit 0
