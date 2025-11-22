# Claude Activity Detection - Hybrid Approach

## Overview

The TUI now uses a hybrid approach for detecting Claude activity, combining:
1. **Real-time tmux monitoring** - For detecting active processing states
2. **Claude Code notification hooks** - For specific events like permission requests and idle states

## Why Both Systems Are Needed

After reviewing the Claude Code hooks documentation, we discovered that notification hooks only fire for:
- Tool permission requests
- Input idle after 60+ seconds

They do NOT provide real-time activity status like "Claude is thinking" or processing. The orange text patterns in tmux terminals remain the only way to detect active Claude processing.

## Implementation Details

### ClaudeStatusManager Enhancement
- Added `NotificationHandler` integration alongside existing `ClaudeMonitor`
- New fields in `ClaudePaneStatus`:
  - `HasPermissionRequest` - Claude waiting for tool permission
  - `IsIdle` - Claude waiting for input
  - `LastNotification` - Most recent notification event

### Status Display Logic
- Primary: tmux monitoring shows real-time processing activity with duration
- Secondary: Notification events show:
  - "awaiting permission" for tool permission requests
  - "idle" for idle notifications
- Combined highlighting: Orange highlight shows for:
  - Inactive Claude panes (no processing detected via tmux)
  - Panes with pending permission requests
  - Idle Claude sessions

### Integration Flow
1. App controller sets `NotificationHandler` on `ClaudeStatusManager` during init
2. When Claude panes are updated, system queries recent notifications
3. Notifications are mapped to panes by project ID
4. Both tmux activity and notification states influence display

## Benefits
- Complete Claude state visibility
- Real-time processing detection retained
- Additional context from notification events
- Future extensibility for new notification types