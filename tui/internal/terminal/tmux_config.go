// Package terminal provides tmux configuration management functionality.

package terminal

import (
	"fmt"
	"os"

	"github.com/rumor-ml/log/pkg/log"
)

// TmuxConfig handles tmux configuration and key binding setup
type TmuxConfig struct {
	tmuxPath string
	logger   log.Logger
	executor TmuxExecutor
}

// NewTmuxConfig creates a new tmux configuration manager
func NewTmuxConfig(tmuxPath string, logger log.Logger, executor TmuxExecutor) *TmuxConfig {
	return &TmuxConfig{
		tmuxPath: tmuxPath,
		logger:   logger,
		executor: executor,
	}
}

// setupGlobalKeybinding sets up the global tmux keybinding for navigation
func (tc *TmuxConfig) setupGlobalKeybinding() error {
	if tc.tmuxPath == "" {
		return fmt.Errorf("tmux executable not found")
	}

	// Set up a key binding that works in any tmux session
	// Use Ctrl+Space as trigger to avoid conflicts with common key bindings
	// Use external script for navigation
	scriptPath := "/Users/n8/carriercommons/tui/navigate-to-tui.sh"

	// Check if script exists, if not create it
	if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
		tc.logger.Warn("Navigation script not found, keybinding may not work", "path", scriptPath)
	}

	_, err := tc.executor.Execute("bind-key", "-T", "root", "C-Space", "run-shell", scriptPath)
	if err != nil {
		tc.logger.Error("Failed to setup global tmux key binding", "error", err)
		return fmt.Errorf("failed to setup global key binding: %w", err)
	}

	tc.logger.Info("Configured smart tmux key binding",
		"trigger", "Ctrl+Space",
		"description", "Smart TUI navigation across all sessions")

	// Set up screenshot key binding (Ctrl+Shift+S)
	screenshotCmd := `run-shell 'screenshot_path="/tmp/tmux_screenshot_$(date +%Y%m%d_%H%M%S).png"; screencapture -o "$screenshot_path" && echo "Screenshot saved to $screenshot_path"'`
	_, err = tc.executor.Execute("bind-key", "-T", "root", "C-S", "run-shell", screenshotCmd)
	if err != nil {
		tc.logger.Warn("Failed to setup screenshot key binding", "error", err)
		// Don't return error for screenshot binding failure
	} else {
		tc.logger.Info("Configured screenshot key binding",
			"trigger", "Ctrl+Shift+S",
			"description", "Capture screenshot to /tmp")
	}

	// Set up testing marker key binding (prefix + t)
	testingScriptPath := "/Users/n8/carriercommons/tui/navigate-to-tui-and-mark-testing.sh"

	// Check if testing script exists
	if _, err := os.Stat(testingScriptPath); os.IsNotExist(err) {
		tc.logger.Warn("Testing navigation script not found", "path", testingScriptPath)
	}

	// Bind to prefix + t (default prefix is Ctrl+B)
	_, err = tc.executor.Execute("bind-key", "-T", "prefix", "t", "run-shell", testingScriptPath)
	if err != nil {
		tc.logger.Warn("Failed to setup testing mark key binding", "error", err)
		// Don't return error for this binding failure
	} else {
		tc.logger.Info("Configured testing mark key binding",
			"trigger", "Prefix+T (Ctrl+B T)",
			"description", "Navigate to TUI and mark project as testing")
	}

	return nil
}

// configureSessionKeyBindings configures custom key bindings for a tmux session
func (tc *TmuxConfig) configureSessionKeyBindings(sessionName string) error {
	if tc.tmuxPath == "" {
		return fmt.Errorf("tmux executable not found")
	}

	tc.logger.Info("Configuring key bindings for session", "session", sessionName)

	// Configure useful key bindings for the session
	bindings := map[string]string{
		"C-n": "new-window -n zsh -c '#{pane_current_path}' zsh",           // Ctrl+N: new zsh window
		"C-c": "new-window -n claude -c '#{pane_current_path}' claude",     // Ctrl+C: new claude window  
		"C-r": "source-file ~/.tmux.conf \\; display-message 'Reloaded!'", // Ctrl+R: reload config
		"C-h": "select-window -t :-",                                       // Ctrl+H: previous window
		"C-l": "select-window -t :+",                                       // Ctrl+L: next window
	}

	for key, command := range bindings {
		_, err := tc.executor.Execute("-t", sessionName, "bind-key", "-T", "prefix", key, "run-shell", command)
		if err != nil {
			tc.logger.Warn("Failed to configure key binding",
				"session", sessionName,
				"key", key,
				"command", command,
				"error", err)
			// Continue with other bindings even if one fails
		}
	}

	tc.logger.Info("Configured tmux key bindings",
		"session", sessionName,
		"bindings", len(bindings))

	// Configure session-specific screenshot binding
	screenshotCmd := fmt.Sprintf(`run-shell 'screenshot_path="/tmp/tmux_%s_$(date +%%Y%%m%%d_%%H%%M%%S).png"; screencapture -o "$screenshot_path" && tmux display-message "Screenshot: $screenshot_path"'`, sessionName)
	_, err := tc.executor.Execute("-t", sessionName, "bind-key", "-T", "prefix", "C-s", "run-shell", screenshotCmd)
	if err != nil {
		tc.logger.Warn("Failed to setup session screenshot key binding",
			"session", sessionName,
			"error", err)
		// Don't fail the entire session setup for this
	} else {
		tc.logger.Info("Configured screenshot key binding",
			"session", sessionName,
			"trigger", "Prefix+Ctrl+S")
	}

	return nil
}