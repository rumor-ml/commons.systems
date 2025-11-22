// tmux_navigation.go - Tmux navigation and attachment functionality

package terminal

import (
	"fmt"
	"os"

	"github.com/rumor-ml/log/pkg/log"
)

// TmuxNavigator handles tmux session, window, and pane navigation
type TmuxNavigator struct {
	tmuxPath string
	logger   log.Logger
	executor TmuxExecutor
}

// NewTmuxNavigator creates a new tmux navigator
func NewTmuxNavigator(tmuxPath string, logger log.Logger, executor TmuxExecutor) *TmuxNavigator {
	return &TmuxNavigator{
		tmuxPath: tmuxPath,
		logger:   logger,
		executor: executor,
	}
}

// AttachToWindow attaches to a specific window in a tmux session
func (tn *TmuxNavigator) AttachToWindow(sessionName string, windowIndex int) error {
	tn.logger.Info("attachToTmuxWindow called",
		"sessionName", sessionName,
		"windowIndex", windowIndex,
		"tmuxPath", tn.tmuxPath)

	if tn.tmuxPath == "" {
		return fmt.Errorf("tmux executable not found")
	}

	// Check if we're already inside a tmux session
	if tn.isInsideTmux() {
		tn.logger.Info("Inside tmux session, using switch-client")
		return tn.switchToWindow(sessionName, windowIndex)
	} else {
		tn.logger.Info("Outside tmux session, using direct attach")
		return tn.attachToSession(sessionName, windowIndex)
	}
}

// AttachToPane attaches to a specific pane within a tmux window
func (tn *TmuxNavigator) AttachToPane(sessionName string, windowIndex, paneIndex int) error {
	tn.logger.Info("attachToTmuxPane called",
		"sessionName", sessionName,
		"windowIndex", windowIndex,
		"paneIndex", paneIndex,
		"tmuxPath", tn.tmuxPath)

	if tn.tmuxPath == "" {
		return fmt.Errorf("tmux executable not found")
	}

	// Check if we're already inside a tmux session
	if tn.isInsideTmux() {
		tn.logger.Info("Inside tmux session, using switch-client for pane")
		return tn.switchToPane(sessionName, windowIndex, paneIndex)
	} else {
		tn.logger.Info("Outside tmux session, using direct attach to pane")
		return tn.attachToSessionPane(sessionName, windowIndex, paneIndex)
	}
}

// isInsideTmux checks if we're currently running inside a tmux session
func (tn *TmuxNavigator) isInsideTmux() bool {
	// Check for TMUX environment variable which is set when inside tmux
	tmuxVar := os.Getenv("TMUX")
	return tmuxVar != ""
}

// switchToWindow switches to a window when already inside tmux
func (tn *TmuxNavigator) switchToWindow(sessionName string, windowIndex int) error {
	tn.logger.Info("Switching to tmux window from within tmux",
		"sessionName", sessionName,
		"windowIndex", windowIndex)

	// Switch to the target session and window
	output, err := tn.executor.Execute("switch-client", "-t", fmt.Sprintf("%s:%d", sessionName, windowIndex))
	if err != nil {
		tn.logger.Error("tmux switch-client failed", "error", err, "output", string(output))
		return fmt.Errorf("tmux switch-client failed: %w", err)
	}

	tn.logger.Info("Successfully switched to tmux window",
		"sessionName", sessionName,
		"windowIndex", windowIndex)

	return nil
}

// attachToSession attaches to a tmux session from outside tmux
func (tn *TmuxNavigator) attachToSession(sessionName string, windowIndex int) error {
	tn.logger.Info("Attaching to tmux session from outside tmux",
		"sessionName", sessionName,
		"windowIndex", windowIndex)

	// Use tmux attach-session with specific window
	output, err := tn.executor.Execute("attach-session", "-t", fmt.Sprintf("%s:%d", sessionName, windowIndex))
	if err != nil {
		tn.logger.Error("tmux attach-session failed", "error", err, "output", string(output))
		return fmt.Errorf("tmux attach-session failed: %w", err)
	}

	tn.logger.Info("Successfully attached to tmux session",
		"sessionName", sessionName,
		"windowIndex", windowIndex)

	return nil
}

// switchToPane switches to a pane when already inside tmux
func (tn *TmuxNavigator) switchToPane(sessionName string, windowIndex, paneIndex int) error {
	tn.logger.Info("Switching to tmux pane from within tmux",
		"sessionName", sessionName,
		"windowIndex", windowIndex,
		"paneIndex", paneIndex)

	// Switch to the target session and window first
	output, err := tn.executor.Execute("switch-client", "-t", fmt.Sprintf("%s:%d", sessionName, windowIndex))
	if err != nil {
		tn.logger.Error("tmux switch-client failed", "error", err, "output", string(output))
		return fmt.Errorf("tmux switch-client failed: %w", err)
	}

	// Select the specific pane within the window
	output, err = tn.executor.Execute("select-pane", "-t", fmt.Sprintf("%s:%d.%d", sessionName, windowIndex, paneIndex))
	if err != nil {
		tn.logger.Error("tmux select-pane failed", "error", err, "output", string(output))
		return fmt.Errorf("tmux select-pane failed: %w", err)
	}

	tn.logger.Info("Successfully switched to tmux pane",
		"sessionName", sessionName,
		"windowIndex", windowIndex,
		"paneIndex", paneIndex)

	return nil
}

// attachToSessionPane attaches to a specific pane from outside tmux
func (tn *TmuxNavigator) attachToSessionPane(sessionName string, windowIndex, paneIndex int) error {
	tn.logger.Info("Attaching to tmux pane from outside tmux",
		"sessionName", sessionName,
		"windowIndex", windowIndex,
		"paneIndex", paneIndex)

	// Use tmux attach-session with specific pane target
	paneTarget := fmt.Sprintf("%s:%d.%d", sessionName, windowIndex, paneIndex)
	output, err := tn.executor.Execute("attach-session", "-t", paneTarget)
	if err != nil {
		tn.logger.Error("tmux attach-session to pane failed", "error", err, "output", string(output))
		return fmt.Errorf("tmux attach-session to pane failed: %w", err)
	}

	tn.logger.Info("Successfully attached to tmux pane",
		"sessionName", sessionName,
		"windowIndex", windowIndex,
		"paneIndex", paneIndex)

	return nil
}