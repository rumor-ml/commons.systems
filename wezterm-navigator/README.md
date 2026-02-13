# WezTerm Navigator

A persistent navigator window for WezTerm that displays welcome message and keybindings help.

## Purpose

This is a Bubbletea application designed to run in a dedicated WezTerm window, providing quick reference to common WezTerm keybindings and a welcome message. It runs as a singleton window that persists across all tabs and windows.

## Features

- Persistent singleton window (always visible alongside main windows)
- Tokyo Night color theme
- WezTerm keybindings reference
- Workspace switching hints
- Clean terminal handling with alt screen

## Persistence Across Tabs and Windows

The navigator runs in a **dedicated WezTerm window** that persists across all tabs and windows:

- Single process - efficient memory usage
- Always visible - can tile alongside main windows
- Consistent state - no per-tab duplication

### Accessing the Navigator

1. **Automatic launch**: Navigator window appears when WezTerm starts
2. **Keybinding**: Press `Ctrl+Shift+9` to jump to navigator window
3. **Keybinding**: Press `Ctrl+Shift+0` to jump back to main window
4. **Window manager**: Tile the navigator window alongside your main WezTerm windows

### Window Layout

```
+---------------+-------------------------------+
|               |                               |
|  WezTerm      |                               |
|  Navigator    |     Main WezTerm Window        |
|  (window 0)   |     (window 1)                |
|               |                               |
|  Welcome      |  Tab 1 | Tab 2 | Tab 3        |
|  Keys         |                               |
|               |  $ git status                 |
+---------------+-------------------------------+
```

## Installation

The application is included in the Nix development shell. Simply enter the shell:

```bash
cd ~/commons.systems
nix develop
```

## Usage

The navigator launches automatically when WezTerm starts via the `gui-startup` event handler configured in `nix/home/wezterm.nix`.

To run manually for testing:

```bash
wezterm-navigator
```

Press `Ctrl+C` or `q` to quit.

## Development

```bash
# Run in development mode
make dev

# Build binary
make build

# Run tests
make test

# Clean build artifacts
make clean
```

## Architecture

The navigator uses a **singleton window** pattern:

1. WezTerm's `gui-startup` event creates a dedicated navigator window
2. Launches `wezterm-navigator` in the navigator window
3. Creates the main working window separately
4. Focuses the main window so user starts typing immediately

The navigator window persists across all tab/window operations in the main window.

## Related

- Issue: #1955 - Replace tmux TUI with native WezTerm multiplexing
- WezTerm config: `nix/home/wezterm.nix`
