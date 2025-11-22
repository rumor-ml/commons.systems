// Package terminal provides tmux utility functions.

package terminal

import (
	"os"
	"os/exec"
	"strings"

	"github.com/rumor-ml/log/pkg/log"
)

// TmuxUtils provides utility functions for tmux operations
type TmuxUtils struct {
	logger log.Logger
}

// NewTmuxUtils creates a new tmux utilities instance
func NewTmuxUtils(logger log.Logger) *TmuxUtils {
	return &TmuxUtils{
		logger: logger,
	}
}

// FindTmuxExecutable finds the tmux executable path
func FindTmuxExecutable(logger log.Logger) string {
	// Try specific nix store paths first (for reliability)
	fallbackPaths := []string{
		"/nix/store/hj4r6y5nd1kh25c6xil1p4vxqvv5r7zk-tmux-3.5a/bin/tmux",
		"/nix/store/nns9f4cgm1ciaiyxpm0n60ihbnbz1h69-tmux-3.5a/bin/tmux",
		"/opt/homebrew/bin/tmux",
		"/usr/local/bin/tmux",
		"/usr/bin/tmux",
	}

	for _, path := range fallbackPaths {
		if _, err := os.Stat(path); err == nil {
			// Test if we can actually execute a command with this tmux
			testCmd := exec.Command(path, "-V")
			if output, err := testCmd.Output(); err == nil {
				if logger != nil {
					logger.Info("Found working tmux executable", "path", path, "version", strings.TrimSpace(string(output)))
				}
				return path
			}
		}
	}

	// Last resort: try PATH
	if tmuxPath, err := exec.LookPath("tmux"); err == nil {
		return tmuxPath
	}

	logger.Error("tmux executable not found in PATH or common locations")
	return ""
}

// tmuxSessionExists checks if a tmux session exists
func tmuxSessionExists(executor TmuxExecutor, sessionName string) bool {
	if executor == nil {
		return false
	}

	// Use tmux has-session to check if session exists
	_, err := executor.Execute("has-session", "-t", sessionName)
	return err == nil
}

// tmuxWindowExists checks if a specific window exists in a tmux session
func tmuxWindowExists(executor TmuxExecutor, sessionName, windowName string) bool {
	if executor == nil {
		return false
	}

	// List windows in the session and check if the window name exists
	output, err := executor.Execute("list-windows", "-t", sessionName, "-F", "#{window_name}")
	if err != nil {
		return false
	}

	windowNames := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, name := range windowNames {
		if name == windowName {
			return true
		}
	}

	return false
}

// isClaudeSession detects if a window represents a Claude session
func isClaudeSession(window *TmuxWindow) bool {
	// Claude patterns in pane title
	claudePatterns := []string{
		"Claude",
		"claude",
		"Anthropic",
		"AI Assistant",
		"Planning",
		"Analyzing", 
		"Working on",
		"Building",
		"Implementing",
		"Debugging",
		"Creating",
		"Updating",
		"Configuring",
		"Installing",
		"Testing",
		"Refactoring",
		"Wondering",
		"Mending",
		"Crafting",
	}

	// Check pane title for Claude activity patterns
	if window.PaneTitle != "" {
		for _, pattern := range claudePatterns {
			if strings.Contains(window.PaneTitle, pattern) {
				return true
			}
		}

		// Claude sessions often have multi-word descriptive titles
		words := strings.Fields(window.PaneTitle)
		if len(words) >= 2 {
			// Multi-word titles like "Log Database", "Testing Strategy" are likely Claude
			return true
		}
	}

	// Claude sessions often run node but have meaningful window names
	if window.Command == "node" && window.Name != "node" {
		return true
	}

	return false
}