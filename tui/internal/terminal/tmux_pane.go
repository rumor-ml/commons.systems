// tmux_pane.go - Individual tmux pane tracking and navigation
//
// ## Metadata
//
// Individual tmux pane representation with comprehensive identification and navigation capabilities.
//
// ### Purpose
//
// Represent individual tmux panes with their session, window, and pane coordinates to enable
// direct navigation and provide rich information display including titles, commands, and shell types.
//
// ### Instructions
//
// #### Pane Identification
//
// ##### Coordinate Tracking
//
// Track session name, window index, and pane index to enable precise tmux targeting
// for navigation operations using tmux select-pane commands.
//
// ##### Information Hierarchy
//
// Provide pane information in priority order: pane title (when available), last command
// executed for zsh shells, current running command for all other shell types.
//
// #### Shell Type Classification
//
// ##### Shell Type Detection
//
// Classify panes as zsh, claude, or other using TTY-based process detection (primary),
// Claude-specific markers in pane titles (fallback), and running command analysis to enable
// organized display in navigation interface without misdetecting generic executables.
//
// ##### Display Organization
//
// Support organization by project/worktree/shell type without exposing tmux session/window
// hierarchy to the user interface for simplified navigation experience.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing project discovery and shell classification that inform pane
// organization and mapping within the navigation interface.

package terminal

import (
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/natb1/tui/pkg/model"
)

// TmuxPane represents an individual pane within a tmux window
type TmuxPane struct {
	// Coordinate identification
	SessionName string // tmux session name
	WindowIndex int    // window index within session
	PaneIndex   int    // pane index within window

	// Pane information (priority order)
	PaneTitle      string // tmux pane title (priority 1)
	LastCommand    string // last command executed for zsh (priority 2)
	CurrentCommand string // current running command (priority 3)

	// Context information
	CurrentPath  string          // working directory of pane
	PaneTTY      string          // TTY device path (e.g., /dev/ttys002)
	ShellType    model.ShellType // detected shell type
	Active       bool            // whether pane is currently active
	CreatedAt    time.Time       // when pane was created
	LastActivity time.Time       // last activity timestamp

	// Display information
	DisplayTitle string          // computed display title for UI
	Project      *model.Project  // mapped project (if any)
	Worktree     *model.Worktree // mapped worktree (if any)
}

// NewTmuxPane creates a new TmuxPane with coordinate information
func NewTmuxPane(sessionName string, windowIndex, paneIndex int) *TmuxPane {
	return &TmuxPane{
		SessionName:  sessionName,
		WindowIndex:  windowIndex,
		PaneIndex:    paneIndex,
		ShellType:    model.ShellTypeUnknown,
		Active:       false,
		CreatedAt:    time.Now(),
		LastActivity: time.Now(),
	}
}

// GetTmuxTarget returns the tmux target string for this pane
func (p *TmuxPane) GetTmuxTarget() string {
	return fmt.Sprintf("%s:%d.%d", p.SessionName, p.WindowIndex, p.PaneIndex)
}

// GetDisplayTitle returns the appropriate display title based on priority
func (p *TmuxPane) GetDisplayTitle() string {
	if p.DisplayTitle != "" {
		return p.DisplayTitle
	}

	// Priority 1: Pane title (when available and meaningful)
	if p.PaneTitle != "" && !isBoringPaneTitle(p.PaneTitle) {
		return p.PaneTitle
	}

	// Priority 2: Last command for zsh shells
	if p.ShellType == model.ShellTypeZsh && p.LastCommand != "" && p.LastCommand != "zsh" {
		return p.LastCommand
	}

	// Priority 3: Current running command
	if p.CurrentCommand != "" {
		return p.CurrentCommand
	}

	// Fallback: shell type
	return string(p.ShellType)
}

// DetectShellType analyzes pane characteristics to determine shell type
func (p *TmuxPane) DetectShellType() {
	// If already detected as Claude, keep it as Claude
	// This prevents Claude panes from disappearing when their title changes
	if p.ShellType == model.ShellTypeClaude {
		return
	}

	// PRIMARY: Check for Claude process in TTY (most reliable)
	if p.hasClaudeProcess() {
		p.ShellType = model.ShellTypeClaude
		return
	}

	// FALLBACK: Check for ✳ symbol in title (Claude-specific marker)
	if p.PaneTitle != "" && strings.Contains(p.PaneTitle, "✳") {
		p.ShellType = model.ShellTypeClaude
		return
	}

	// Check current command for specific shell types
	switch {
	case strings.Contains(p.CurrentCommand, "zsh"):
		p.ShellType = model.ShellTypeZsh
	case strings.Contains(p.CurrentCommand, "claude"):
		p.ShellType = model.ShellTypeClaude
	case strings.Contains(p.CurrentCommand, "nvim") || strings.Contains(p.CurrentCommand, "vim"):
		p.ShellType = model.ShellTypeNvim
	default:
		// Default to unknown for generic executables (go, node, python, etc.)
		p.ShellType = model.ShellTypeUnknown
	}
}

// hasClaudeProcess checks if any process in the pane's TTY is "claude"
func (p *TmuxPane) hasClaudeProcess() bool {
	if p.PaneTTY == "" {
		return false
	}

	// Extract TTY name from /dev/ttysNNN
	tty := strings.TrimPrefix(p.PaneTTY, "/dev/")
	if tty == p.PaneTTY {
		// No /dev/ prefix, use as-is
		tty = p.PaneTTY
	}

	// Run: ps -t <tty> -o command=
	// Check if any line is exactly "claude"
	cmd := exec.Command("ps", "-t", tty, "-o", "command=")
	output, err := cmd.Output()
	if err != nil {
		// ps command failed (e.g., no processes in TTY)
		return false
	}

	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		// Check for exact match or "claude" with args
		if trimmed == "claude" || strings.HasPrefix(trimmed, "claude ") {
			return true
		}
	}
	return false
}

// isBoringPaneTitle filters out uninteresting pane titles
func isBoringPaneTitle(title string) bool {
	// Filter out hostname-like titles
	if strings.HasSuffix(title, ".local") {
		return true
	}

	// Filter out exact matches for shell names
	boring := []string{"bash", "zsh", "sh", "fish", "tcsh", "csh", "node"}
	for _, shell := range boring {
		if title == shell {
			return true
		}
	}

	return false
}
