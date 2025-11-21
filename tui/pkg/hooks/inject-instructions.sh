#!/bin/bash
# Claude Code hook wrapper for instruction injection
# This script delegates to the Go implementation to avoid platform-specific issues

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"

# Path to the Go hook binary
HOOK_BINARY="${PROJECT_ROOT}/claude-hook"

# If binary doesn't exist, try to build it
if [[ ! -f "$HOOK_BINARY" ]]; then
    # Try to build the hook
    if command -v go &> /dev/null; then
        (cd "$PROJECT_ROOT" && go build -o claude-hook ./cmd/claude-hook) >&2
    else
        echo "Error: claude-hook binary not found and Go not available to build it" >&2
        # Pass through input unchanged
        cat
        exit 0
    fi
fi

# Execute the Go hook binary
"$HOOK_BINARY"