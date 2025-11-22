```
Copyright (c) 2025 RUMOR.ML and Nathan Bixby
Licensed under CC BY-NC-SA 4.0.
https://creativecommons.org/licenses/by-nc-sa/4.0/
https://github.com/rumor-ml/icf/blob/main/LICENSE
```

# ICF TTY Multiplexer

## Metadata

[ICF TTY Multiplexer](https://github.com/rumor-ml/tui)

### Purpose

A Go-based terminal user interface that integrates with tmux to provide ICF project-aware navigation and Claude assistant monitoring. The interface presents a four-section vertical layout for efficient project switching and status tracking.

### Core Principles

#### ICF-Integrated Navigation

##### Project-Aware Interface

Terminal interface organizes around ICF projects using project discovery from the ../project repository, enabling quick navigation between projects with keyboard shortcuts and real-time status display.

##### Claude Activity Monitoring

Monitors and displays Claude assistant activity status across projects, providing visibility into active Claude sessions and their current state.

#### Four-Section Interface Design

##### Vertical Layout

Simple top-to-bottom interface with log display (top, 7 lines with 4 truncated + 3 detail), project navigation (middle), dev server status (1 line), and help text (bottom) for focused interaction without complex panel management.

##### Keyboard-Driven Navigation

Single-key commands for common actions: c(laude), z(sh), n(vim) for shell types, x for project blocking, with immediate tmux integration.

#### Tmux Integration

##### Session Management

Deep integration with tmux for terminal session management, discovering existing tmux sessions and creating new sessions/windows as needed for project work.

##### Pane Discovery

Automatic discovery and navigation of tmux panes, including unmapped sessions grouped under "Other Sessions" for comprehensive terminal visibility.

### Dependencies

#### [ICF Project Repository](../project)

Project discovery and metadata capabilities provided by the sibling project repository, eliminating duplicate discovery logic within the TUI codebase.

#### Bubble Tea Framework

Go TUI framework providing event handling, component architecture, and terminal rendering for the four-section interface design.

#### Tmux

Terminal multiplexer providing session, window, and pane management capabilities that the interface coordinates and navigates.

## Architecture

The ICF TTY Multiplexer implements a modular architecture with clear separation of concerns:

### Package Structure

The application is organized into **8 focused internal packages**:

#### **app/** (11 files)
Application coordination and controller logic. Manages mode transitions, event routing, and component integration. Contains the main App controller and extracted functional modules for lifecycle management.

#### **assistant/** (2 files)
Claude integration and monitoring. Provides assistant core functionality and interfaces for Claude session management within the multiplexer.

#### **persistence/** (2 files)
Status persistence using SQLite. Stores project and worktree blocked/testing status flags across TUI restarts. Uses the `../store` module for database operations with graceful degradation when persistence unavailable.

#### **security/** (1 file)
Input sanitization and command validation. Ensures safe execution of shell commands and prevents injection attacks in tmux operations.

#### **status/** (10 files)
Status aggregation, caching, and notifications. Consolidates project status, Claude activity monitoring, and notification handling using structured data storage.

#### **terminal/** (27 files)
Tmux integration and session management. Handles tmux discovery, session creation, pane management, and Claude activity detection within terminal sessions.

#### **ui/** (38 files)
Terminal user interface and interaction handling. Implements the four-section interface design with Bubble Tea components for navigation, logs, dev server status, and help display.

#### **worktree/** (1 file)
Git worktree operations for project management.

### Storage Architecture

The application uses two separate storage systems:

- **../log package**: Used exclusively for application logging, debugging, and audit trails with component-based logging (`log.Get().WithComponent("component-name")`)
- **../store package**: Used for persistent project/worktree status storage in `tui/status.db`. Status flags (blocked/testing) survive TUI restarts and are automatically restored on startup

### Interface Components

- **Log Display**: Top section (7 lines) showing system activity and status messages with split view: 4 lines of truncated log history and 3 lines showing the full selected log with text wrapping
- **Project Navigation**: Middle section with project list and navigation options
- **Dev Server Status**: Single line showing development server status and control
- **Help Text**: Bottom section displaying available keyboard shortcuts

### Integration Patterns

- **Component Logging**: All modules use `../log` with component identifiers for centralized log management  
- **Project Discovery**: Delegates to `../project` repository for ICF project detection and metadata
- **Tmux Coordination**: Deep integration with tmux for session, window, and pane management

## Features

### Project Navigation

- Automatic ICF project discovery through ../project repository
- Keyboard shortcuts for quick project access
- Real-time project status display with blocking/unblocking (x key) and testing status (t key)
- Project status indicators:
  - **Blocked** (🚫): Mark projects as blocked with `<project key> x` - shows muted text
  - **Testing** (🧪): Mark projects as testing with `<project key> t` - shows muted text
  - **Persistent**: Status survives TUI restarts and is automatically restored on startup
  - **Manual clear only**: Status persists indefinitely until explicitly toggled off
  - Tmux integration: Press `ctrl-b t` from any Claude pane to navigate to TUI and auto-mark project as testing

### Tmux Integration

- Automatic tmux session discovery and creation
- Direct navigation to project-specific tmux sessions
- Support for multiple shell types: Claude (c), Zsh (z), Nvim (n)
- "Other Sessions" display for unmapped tmux activity

### Log Navigation

- Real-time log display with automatic scrolling
- Split view showing 4 truncated log lines and 3 lines of detail for selected log
- Arrow key navigation through log history (↑ for older, ↓ for newer)
- Fast navigation with PageUp/PageDown (jump 5 logs at a time)
- Auto-scroll follows newest logs until user navigates back in history
- Automatic resumption of auto-scroll when returning to most recent log
- Text wrapping in detail view shows full log messages

### Claude Monitoring

- Real-time Claude assistant activity tracking
- Status display integration within project navigation
- Claude session discovery and management

### Dev Server Management

- Integrated development server control for carrier modules
- Real-time status updates (stopped, starting, restarting, running, error)
- Quick restart with 'r' key - restarts running server or starts stopped server
- Path configuration with '/' key - set the initial module path
- **Graceful degradation**: Server starts even when modules have compilation errors
- **Automatic module discovery**: Scans carriercommons workspace for web modules
- **Compilation validation**: Each module is compiled independently before inclusion
- **Parallel validation**: Fast startup with concurrent module checks (4-worker pool)
- **Transparent error reporting**: Excluded modules logged with actionable error messages
- Visual status indicators with color-coded glyphs (yellow for degraded state)
- Supports zero-module operation (minimal server mode)

## TUI Process Management

### Single Instance Enforcement

The TUI enforces single-instance operation to prevent orphaned processes from interfering with marker delivery (`ctrl-b t` functionality). Only one TUI process can run at a time.

**How it works:**
- TUI acquires a lock file (`/tmp/tui-instance.sock`) on startup
- If another TUI is already running, the new instance exits with a clear error message
- Lock is automatically released when TUI exits normally
- Stale locks from crashes (`kill -9`) are detected and automatically removed

**If TUI won't start:**
- **Error**: `"another TUI instance is running"`
- **Check**: Look for existing TUI in tmux window named 'tui'
- **If no TUI visible**: Stale lock file from crash
  - **Option 1**: Wait 5 seconds and retry (automatic stale lock detection)
  - **Option 2**: Manually remove lock: `rm -f /tmp/tui-instance.sock`

### Development Workflow

**Compiled Binary** (`./tui`):
```bash
# Build once
go build -o tui

# Run
./tui

# Restart: Press Ctrl+D or 'q' to quit, then:
./tui
```

**Go Run** (`go run main.go`):
```bash
# For rapid development iteration
go run main.go

# To restart: Press Ctrl+D in existing TUI, then:
go run main.go
```

**Important**: Old instance must exit before starting new one. The single-instance lock prevents accidental multiple instances.

### Tmux Integration: `ctrl-b t` Marker

The `ctrl-b t` key binding marks the current project as "testing" and navigates to the TUI.

**How it works:**
1. Shell script finds TUI pane and gets its process ID (PID)
2. Creates marker file: `/tmp/tui-testing-markers/mark-testing-request-{PID}`
3. TUI polls directory every 500ms, processes marker if PID matches
4. Project status toggles (testing ↔ ready)
5. Status persists to database

**If `ctrl-b t` doesn't work:**
- **Check TUI is running**: `tmux list-panes -a | grep tui`
- **Check marker directory**: `ls /tmp/tui-testing-markers/`
- **Check for orphaned processes**: `ps aux | grep -E '(tui|go-build.*main)' | grep -v grep`
- **View TUI logs**: Check component `testing-marker` for marker detection events

### Troubleshooting Orphaned Processes

**Symptoms**:
- TUI won't start with "another instance running" error
- No visible TUI in tmux
- `ctrl-b t` doesn't toggle status

**Diagnosis:**
```bash
# Check for TUI processes
ps aux | grep -E '(tui|go-build.*main)' | grep -v grep

# Check for lock file
ls -la /tmp/tui-instance.sock
```

**Solution:**
```bash
# Kill orphaned processes (if any found)
pkill -f 'tui|go-build.*main'

# Remove stale lock (if needed)
rm -f /tmp/tui-instance.sock

# Restart TUI
./tui
```

**Note**: With single-instance enforcement, orphaned processes should be rare. This typically only happens after `kill -9` or system crashes.

## Getting Started

The multiplexer provides a keyboard-driven interface for ICF project navigation:

### Navigation Keys

#### Project Navigation
- **c** - Open/switch to Claude shell for selected project
- **z** - Open/switch to Zsh shell for selected project
- **n** - Open/switch to Nvim shell for selected project
- **x** - Toggle project blocked status

#### Log Navigation
- **↑** - Navigate to older logs (scroll back in log history, one at a time)
- **↓** - Navigate to newer logs (scroll forward in log history, one at a time)
- **PageUp** - Jump back 5 logs in history
- **PageDown** - Jump forward 5 logs in history

#### Dev Server Control
- **r** - Restart/start dev server (uses current or last known path)
- **/** - Set dev server path and start/restart server

#### General
- **Ctrl+D** - Quit application
- **Esc** - Cancel current operation

### Project Discovery

The interface automatically discovers ICF projects through integration with the ../project repository, displaying:

- Project names and paths
- Current tmux session status
- Claude assistant activity
- Available shell options per project

### Tmux Integration

Working seamlessly with existing tmux configurations:

- Discovers existing tmux sessions and maps them to projects
- Creates new sessions/windows as needed
- Maintains tmux session organization
- Displays unmapped sessions under "Other Sessions"

---

**Dependencies**: [ICF Project Repository](../project)