# Claude Code Notification Integration

This package provides integration with Claude Code notification hooks to track Claude activity within the current TUI session.

## Overview

The notification system works by:

1. **Claude Code Hook**: Claude Code sends notifications via hooks when certain events occur
2. **Notification Handler**: A shell script processes the hook and forwards to the TUI
3. **TUI Processor**: The TUI processes notifications and logs them for the current session
4. **Display Integration**: The TUI displays Claude activity indicators based on current session notifications

## Setup

### 1. Configure Claude Code Hooks

Add the notification hook to your Claude settings.json:

```json
{
  "hooks": {
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "./pkg/hooks/notification-handler.sh"
          }
        ]
      }
    ]
  }
}
```

### 2. Ensure TUI Binary is Available

The notification hook script looks for the TUI binary in these locations:
- `../icf-tui` (relative to hook script)
- `../../icf-tui` (parent directory)
- `$HOME/.local/bin/icf-tui`
- `/usr/local/bin/icf-tui`
- System PATH

### 3. Set Environment Variables (Optional)

- `ICF_WORKSPACE_ROOT`: Root directory for projects (defaults to current directory)
- `ICF_LOG_DIR`: Directory for hook logs (defaults to `/tmp`)

## Notification Types

The system handles these notification types:

### Tool Permission Requests
Triggered when Claude requests permission to use a tool:
```json
{
  "type": "tool_permission_request",
  "message": "Claude needs your permission to use Bash",
  "timestamp": "2025-01-30T15:30:00Z",
  "session_id": "session-123"
}
```

### Input Idle
Triggered when Claude is waiting for user input:
```json
{
  "type": "input_idle", 
  "message": "Claude is waiting for your input",
  "timestamp": "2025-01-30T15:35:00Z",
  "session_id": "session-123"
}
```

### General Activity
Other Claude activity notifications:
```json
{
  "type": "claude_activity",
  "message": "Claude is processing your request",
  "timestamp": "2025-01-30T15:32:00Z",
  "session_id": "session-123"
}
```

## Usage

### Processing Notifications

The TUI can process notifications directly:

```bash
echo '{"type":"activity","message":"test"}' | ./icf-tui --process-notification
```

### Querying Stored Notifications

Use the notification handler to query recent notifications:

```go
handler := notifications.NewNotificationHandler(store)
notifications, err := handler.GetProjectNotifications("my-project", 10)
```

### Display Integration

The TUI can display Claude activity indicators:

```go
handler := notifications.NewNotificationHandler(store)
latest, err := handler.GetLatestActivity()
if latest != nil {
    // Show activity indicator in TUI
}
```

## File Structure

```
internal/notifications/
├── handler.go              # Main notification processor
└── README.md              # This documentation

internal/projectstore/
├── client.go              # Project store wrapper
└── ...

pkg/hooks/
├── notification-handler.sh # Shell script hook
└── ...

examples/
├── claude-settings-example.json # Example Claude settings
└── ...
```

## Architecture

```
Claude Code
    │
    │ (hook notification)
    ▼
notification-handler.sh
    │
    │ (JSON via stdin)  
    ▼
icf-tui --process-notification
    │
    │ (stores in database)
    ▼
Project Store (.icf/project.db)
    │
    │ (queries for display)
    ▼
TUI Navigation Interface
```

## Error Handling

- If the TUI binary is not found, notifications are stored in `$ICF_WORKSPACE_ROOT/.icf/notifications/`
- All hook activity is logged to `$ICF_LOG_DIR/claude-notifications.log`
- Failed notification processing is logged but doesn't block Claude operation

## Testing

Test the notification system:

```bash
# Test notification processing
echo '{"type":"test","message":"test notification"}' | ./icf-tui --process-notification

# Test hook script directly
echo '{"userMessage":"Claude needs permission"}' | ./pkg/hooks/notification-handler.sh

# Check stored notifications
sqlite3 .icf/project.db "SELECT * FROM log_entries WHERE component='claude-notifications';"
```

## Security

- All input is validated and sanitized
- File paths are restricted to workspace boundaries  
- Shell commands in hooks are escaped to prevent injection
- Database access uses parameterized queries