#!/bin/bash
# Makefile utility functions

# Check if a Makefile has a specific target
# Usage: makefile_has_target <makefile_path> <target_name>
# Returns: 0 if target exists, 1 if not
makefile_has_target() {
  local makefile_path="$1"
  local target="$2"

  [[ ! -f "$makefile_path" ]] && return 1

  # Use make -n (dry-run) to check if target exists
  # Exit code 2 = "No rule to make target"
  # Exit code 0 = target exists
  cd "$(dirname "$makefile_path")"
  make -n "$target" >/dev/null 2>&1
  local exit_code=$?

  [[ $exit_code -eq 0 ]] && return 0
  return 1
}
