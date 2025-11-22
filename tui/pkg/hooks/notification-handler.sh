#!/bin/bash
# Centralized Claude Code notification hook
# This script receives notifications from Claude Code and stores them in the centralized project store
# Distributed to all projects via hook synchronization system

set -euo pipefail

# Set up logging
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${ICF_LOG_DIR:-/tmp}/claude-notifications.log"

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [central-notification-hook] $*" >> "$LOG_FILE"
}

log "Centralized notification hook started from $(pwd)"

# Detect project context
PROJECT_ROOT=""
CURRENT_DIR="$(pwd)"

# Method 1: Check if we're in a known project structure
if [[ -f "go.mod" || -f "main.go" || -f "package.json" || -f "CLAUDE.md" ]]; then
    PROJECT_ROOT="$CURRENT_DIR"
    log "Detected project root via file markers: $PROJECT_ROOT"
elif [[ -f "../go.mod" || -f "../main.go" || -f "../package.json" || -f "../CLAUDE.md" ]]; then
    PROJECT_ROOT="$(cd .. && pwd)"
    log "Detected project root in parent: $PROJECT_ROOT"
else
    # Method 2: Walk up looking for project markers
    dir="$CURRENT_DIR"
    while [[ "$dir" != "/" ]]; do
        if [[ -f "$dir/go.mod" || -f "$dir/main.go" || -f "$dir/package.json" || -f "$dir/CLAUDE.md" ]]; then
            PROJECT_ROOT="$dir"
            log "Found project root by walking up: $PROJECT_ROOT"
            break
        fi
        dir="$(dirname "$dir")"
    done
fi

# If still no project root, use current directory
if [[ -z "$PROJECT_ROOT" ]]; then
    PROJECT_ROOT="$CURRENT_DIR"
    log "Using current directory as project root: $PROJECT_ROOT"
fi

# Determine project name from path
PROJECT_NAME="$(basename "$PROJECT_ROOT")"
log "Determined project name: $PROJECT_NAME"

# Read the JSON input from stdin
input=$(cat)
log "Received input: $input"

# Check if we have a valid JSON input
if [[ -z "$input" ]]; then
    log "No input received"
    exit 0
fi

# Try to extract notification type and message from the input
# Claude Code sends different formats, so we need to be flexible
notification_type="claude_activity"
message=""
session_id=""

# Check if this is a tool permission request
if echo "$input" | grep -q "permission to use"; then
    notification_type="tool_permission_request"
    message=$(echo "$input" | jq -r '.userMessage // .message // empty' 2>/dev/null || echo "$input")
fi

# Check if this is an input idle notification
if echo "$input" | grep -q "waiting for.*input"; then
    notification_type="input_idle"
    message=$(echo "$input" | jq -r '.userMessage // .message // empty' 2>/dev/null || echo "$input")
fi

# Extract session ID if available
session_id=$(echo "$input" | jq -r '.sessionId // .session_id // empty' 2>/dev/null)

# If no specific message found, use the full input as message
if [[ -z "$message" ]]; then
    message=$(echo "$input" | jq -r '.userMessage // .message // empty' 2>/dev/null || echo "$input")
fi

# Create notification JSON with project context
notification_json=$(cat <<EOF
{
    "type": "$notification_type",
    "message": "$message",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "session_id": "$session_id",
    "project_name": "$PROJECT_NAME",
    "project_path": "$PROJECT_ROOT",
    "data": {
        "raw_input": $(echo "$input" | jq -Rs .),
        "working_directory": "$CURRENT_DIR"
    }
}
EOF
)

log "Created notification: $notification_json"

# Find the centralized store processor
# Look for the project CLI or TUI that can handle notifications
store_processor=""

# Method 1: Look for project CLI in ../project
project_cli_paths=(
    "$(dirname "$SCRIPT_DIR")/../../project/main"
    "$(dirname "$SCRIPT_DIR")/../../project/project-cli"
    "$(dirname "$SCRIPT_DIR")/../../project/claude-hook"
)

for path in "${project_cli_paths[@]}"; do
    if [[ -x "$path" ]]; then
        store_processor="$path"
        log "Found project CLI processor: $store_processor"
        break
    fi
done

# Method 2: Look for TUI processor that can handle notifications
if [[ -z "$store_processor" ]]; then
    tui_paths=(
        "$(dirname "$SCRIPT_DIR")/../../tui/icf-tui"
        "$(dirname "$SCRIPT_DIR")/../icf-tui"
        "$HOME/.local/bin/icf-tui"
        "/usr/local/bin/icf-tui"
        "$(which icf-tui 2>/dev/null)"
    )
    
    for path in "${tui_paths[@]}"; do
        if [[ -x "$path" ]]; then
            store_processor="$path --process-notification"
            log "Found TUI processor: $store_processor"
            break
        fi
    done
fi

# Process the notification
if [[ -n "$store_processor" ]]; then
    log "Sending notification to store processor: $store_processor"
    if echo "$notification_json" | $store_processor 2>>"$LOG_FILE"; then
        log "Notification processed successfully"
    else
        log "Failed to process notification via $store_processor"
        # Fallback to local storage
        notification_dir="${ICF_WORKSPACE_ROOT:-$PROJECT_ROOT}/.icf/notifications"
        mkdir -p "$notification_dir"
        notification_file="$notification_dir/$(date +%s)-$PROJECT_NAME-notification.json"
        echo "$notification_json" > "$notification_file"
        log "Stored notification locally in $notification_file"
    fi
else
    log "No store processor found, storing notification locally"
    # Fallback: store in a local file within the project
    notification_dir="$PROJECT_ROOT/.icf/notifications"
    mkdir -p "$notification_dir"
    notification_file="$notification_dir/$(date +%s)-notification.json"
    echo "$notification_json" > "$notification_file"
    log "Stored notification in $notification_file"
fi

# Pass through the original input unchanged (required by Claude Code hooks)
echo "$input"

log "Centralized notification hook completed"