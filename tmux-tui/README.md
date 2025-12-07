# tmux-tui

Developer dashboard TUI for commons.systems monorepo.

## Features

- Auto-spawns in 40-column left pane in every new tmux window
- Hotkey to reopen if closed (Prefix + t, default Prefix is Ctrl+b)
- Built with Go and Bubbletea
- Integrates cleanly with existing Node.js workflow
- Comprehensive E2E tests

## Installation

Prerequisites: Nix environment (provided by monorepo)

```bash
# Simply enter the Nix development environment
nix develop

# That's it! The shellHook will:
# 1. Automatically build the TUI binary (if needed)
# 2. Auto-source the tmux config (if in tmux)
# 3. New tmux windows will automatically spawn the TUI
```

**No manual build step required!** The Nix shellHook detects if the binary is missing or outdated and rebuilds automatically.

## Usage

### Quick Start
1. From the project root (in tmux): `nix develop`
2. Create a new tmux window: `Ctrl+b c`
3. The TUI automatically appears in a 40-column left pane!

### Automatic Spawn
When you're in the Nix development environment and inside tmux, every new window automatically gets a TUI pane on the left (40 columns wide).

### Manual Control
- **Reopen TUI**: Press `Prefix + t` (default: Ctrl+b, then t)
- **Close TUI**: Press `Ctrl+C` in the TUI pane
- **Disable globally**: Exit the Nix shell or unset the tmux hook
- **Rebuild manually**: `cd tmux-tui && make build` (usually not needed)

### Environment Variables
- `TMUX_TUI_SPAWN_SCRIPT`: Path to spawn.sh (set automatically by Nix shellHook)

## Development

```bash
# Run without building (development mode)
make dev  # or: go run ./cmd/tmux-tui

# Build the binary
make build  # or: go build -ldflags "-s -w" -o build/tmux-tui ./cmd/tmux-tui

# Run all tests
make test  # or: go test ./...

# Run only E2E tests
make test-e2e  # or: go test ./tests/...

# Clean build artifacts
make clean  # or: go clean && rm -rf build/
```

## Architecture

### Components

1. **cmd/tmux-tui/main.go** - Bubbletea TUI application
   - Simple "Hello World" interface
   - Quits with Ctrl+C
   - Displays session info

2. **scripts/spawn.sh** - Tmux hook script
   - Creates 40-column left pane
   - Tracks pane via tmux window options
   - Prevents duplicate TUI instances
   - Returns focus to main pane

3. **tmux-tui.conf** - Tmux configuration
   - Sets `after-new-window` hook
   - Binds Prefix + t keybinding
   - Auto-sourced by Nix shellHook

4. **tests/e2e_test.go** - E2E tests
   - Tests TUI functionality with teatest
   - Tests tmux integration with background sessions
   - Tests multi-session isolation

### How It Works

1. When you run `nix develop`, the shellHook:
   - **Automatically builds** the TUI binary (if missing or outdated)
   - Sets `TMUX_TUI_SPAWN_SCRIPT` environment variable
   - Sources `tmux-tui.conf` into your tmux session

2. When you create a new tmux window:
   - The `after-new-window` hook triggers
   - `spawn.sh` runs and creates a 40-column left pane
   - TUI binary launches in that pane
   - Focus returns to the main (right) pane

3. If you close the TUI:
   - Press Prefix + t to reopen it
   - The keybinding runs the same `spawn.sh` script

### Automatic Build Detection
The shellHook intelligently rebuilds only when needed:
- Binary doesn't exist: **builds**
- `main.go` modified since last build: **rebuilds**
- Binary up-to-date: **skips build**

### Pane Tracking

The spawn script uses tmux window options to track the TUI pane:
- Stores pane ID in `@tui-pane` window option
- Checks if pane exists before creating a new one
- Prevents duplicate TUI instances in the same window

## Testing

### Run Tests
```bash
# All tests (unit + E2E)
make test

# Just E2E tests
make test-e2e
```

### Test Coverage
- ✅ TUI initialization
- ✅ Ctrl+C quit behavior
- ✅ View rendering (40-column width)
- ✅ Tmux pane spawning
- ✅ Window option tracking
- ✅ Multi-session isolation
- ✅ Script and config file validation

### Manual Testing

#### Quick Restart for Testing
```bash
# Restart all TUI panes with the current branch version
./scripts/restart-tui.sh
```

This script:
- Stops the daemon
- Rebuilds binaries from current branch
- Kills all existing TUI panes
- Respawns TUI panes in all windows

#### Manual Verification Checklist
After building, verify:
- [ ] `nix develop` auto-sources config (when in tmux)
- [ ] New tmux window spawns TUI in 40-column left pane
- [ ] Cursor starts in right pane (main work area)
- [ ] Multiple windows have independent TUI panes
- [ ] Ctrl+C closes TUI pane
- [ ] Prefix + t reopens TUI
- [ ] Multiple tmux sessions work independently

## Troubleshooting

### TUI doesn't spawn in new windows

**Diagnosis:**
```bash
# Check if in Nix shell
echo $IN_NIX_SHELL

# Check if hook is set
tmux show-hooks -g | grep after-new-window

# Check environment variable
tmux show-environment -g | grep TMUX_TUI_SPAWN_SCRIPT

# Test spawn script manually
./scripts/spawn.sh
```

**Fix:** Re-enter Nix shell (`exit` then `nix develop`)

### Multiple TUI panes appear

**Diagnosis:**
```bash
# Check window option
tmux show-window-options | grep tui-pane
```

**Fix:** Kill extra panes - spawn.sh should prevent this on next window creation

### TUI crashes immediately

**Diagnosis:**
```bash
# Run TUI directly to see errors
./build/tmux-tui
```

**Fix:** Rebuild: `make clean && make build`

### Keybinding doesn't work

**Diagnosis:**
```bash
# Check keybinding is set
tmux list-keys | grep "bind-key.*t"
```

**Fix:** Re-source config: `tmux source-file tmux-tui/tmux-tui.conf`

## Project Structure

```
tmux-tui/
├── cmd/
│   └── tmux-tui/
│       └── main.go          # TUI entry point
├── scripts/
│   ├── spawn.sh             # Tmux hook script
│   └── restart-tui.sh       # Testing script - restart all TUI panes
├── tests/
│   └── e2e_test.go          # E2E tests
├── tmux-tui.conf            # Tmux configuration
├── go.mod                   # Go module definition
├── go.sum                   # Go dependencies
├── Makefile                 # Build targets
└── README.md                # This file
```

## Contributing

This is part of the commons.systems monorepo. Follow monorepo conventions:
- Use `make build` (or `go build`) for building
- Use `make test` (or `go test`) for testing
- Keep changes isolated to the `tmux-tui/` directory
- Update tests when adding new functionality

## Future Enhancements

Ideas for future development (not currently implemented):
- Git status and branch info
- Running dev servers display
- Task manager integration
- CI/CD status
- Configurable themes
- Dynamic width adjustment
- State persistence across sessions
