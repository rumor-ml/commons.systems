// Package terminal provides tmux window management functionality.

package terminal

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/rumor-ml/log/pkg/log"
)

// TmuxWindowManager handles tmux window operations
type TmuxWindowManager struct {
	tmuxPath string
	logger   log.Logger
	executor TmuxExecutor
}

// NewTmuxWindowManager creates a new window manager
func NewTmuxWindowManager(tmuxPath string, logger log.Logger, executor TmuxExecutor) *TmuxWindowManager {
	return &TmuxWindowManager{
		tmuxPath: tmuxPath,
		logger:   logger,
		executor: executor,
	}
}

// createTmuxWindow creates a new window in an existing tmux session
func (wm *TmuxWindowManager) createTmuxWindow(sessionName, windowName, command, workingDir string) (int, error) {
	if wm.tmuxPath == "" {
		return -1, fmt.Errorf("tmux executable not found")
	}

	wm.logger.Info("Creating tmux window",
		"session", sessionName,
		"window", windowName,
		"command", command,
		"workingDir", workingDir)

	// First create the window with the desired name and working directory
	_, err := wm.executor.Execute("new-window", "-t", sessionName, "-n", windowName, "-c", workingDir)
	if err != nil {
		return -1, fmt.Errorf("failed to create window %s in session %s: %w", windowName, sessionName, err)
	}

	// Get the window index that was just created
	output, err := wm.executor.Execute("list-windows", "-t", sessionName, "-F", "#{window_index}:#{window_name}")
	if err != nil {
		return -1, fmt.Errorf("failed to get window index for %s: %w", windowName, err)
	}

	// Find the window index for our window name
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	var windowIndex int = -1
	for _, line := range lines {
		parts := strings.Split(line, ":")
		if len(parts) == 2 {
			if parts[1] == windowName {
				if idx, err := strconv.Atoi(parts[0]); err == nil {
					windowIndex = idx
					break
				}
			}
		}
	}

	if windowIndex == -1 {
		return -1, fmt.Errorf("could not determine window index for %s", windowName)
	}

	wm.logger.Info("Created tmux window successfully", "session", sessionName, "window", windowName, "index", windowIndex)

	// Send the command to the window (if provided and not empty)
	if command != "" && command != "zsh" {
		// Check if this is a claude command and if flake.nix exists
		actualCommand := command
		if command == "claude" || command == "claude -c" {
			flakePath := workingDir + "/flake.nix"
			if _, err := os.Stat(flakePath); err == nil {
				// flake.nix exists, wrap claude in nix develop (always use -c flag)
				actualCommand = "nix develop --command claude -c"
				wm.logger.Info("Wrapping claude command in nix develop", "originalCommand", command, "actualCommand", actualCommand)
			} else {
				// No flake.nix, ensure we use -c flag
				actualCommand = "claude -c"
			}
		}

		target := fmt.Sprintf("%s:%d", sessionName, windowIndex)
		_, err := wm.executor.Execute("send-keys", "-t", target, actualCommand, "Enter")
		if err != nil {
			wm.logger.Warn("Failed to send command to new window", "error", err, "command", actualCommand)
			// Don't return error here, window was created successfully
		} else {
			wm.logger.Info("Sent command to new window", "command", actualCommand)
		}
	}

	return windowIndex, nil
}

// ListWindows returns a list of windows for a given session
func (wm *TmuxWindowManager) ListWindows(sessionName string) ([]*TmuxWindow, error) {
	if wm.tmuxPath == "" {
		return nil, fmt.Errorf("tmux executable not found")
	}

	// Get window information from tmux using executor
	output, err := wm.executor.Execute("list-windows", "-t", sessionName, "-F", "#{window_index}:#{window_name}:#{window_active}")
	if err != nil {
		return nil, fmt.Errorf("failed to list windows for session %s: %w", sessionName, err)
	}

	var windows []*TmuxWindow
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	
	for _, line := range lines {
		if line == "" {
			continue
		}
		
		parts := strings.Split(line, ":")
		if len(parts) >= 3 {
			index, _ := strconv.Atoi(parts[0])
			name := parts[1]
			active := parts[2] == "1"
			
			window := &TmuxWindow{
				Index:  index,
				Name:   name,
				Active: active,
			}
			windows = append(windows, window)
		}
	}

	return windows, nil
}

// GetWindowsWithDetails returns detailed window information for a session
func (wm *TmuxWindowManager) GetWindowsWithDetails(sessionName string) ([]*TmuxWindow, error) {
	if wm.tmuxPath == "" {
		return nil, fmt.Errorf("tmux executable not found")
	}

	// Get detailed window information including pane details
	output, err := wm.executor.Execute("list-windows", "-t", sessionName, "-F",
		"#{window_index}:#{window_name}:#{window_active}:#{pane_current_command}:#{pane_title}")
	if err != nil {
		return nil, fmt.Errorf("failed to list detailed windows for session %s: %w", sessionName, err)
	}

	var windows []*TmuxWindow
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	
	for _, line := range lines {
		if line == "" {
			continue
		}
		
		parts := strings.Split(line, ":")
		if len(parts) >= 5 {
			index, _ := strconv.Atoi(parts[0])
			name := parts[1]
			active := parts[2] == "1"
			command := parts[3]
			paneTitle := parts[4]
			
			window := &TmuxWindow{
				Index:     index,
				Name:      name,
				Active:    active,
				Command:   command,
				PaneTitle: paneTitle,
			}
			windows = append(windows, window)
		}
	}

	return windows, nil
}

// FindWindowByPath finds a window in a session based on path and type
func (wm *TmuxWindowManager) FindWindowByPath(sessionName string, projectPath string, windowType string) (*TmuxWindow, error) {
	if wm.tmuxPath == "" {
		return nil, fmt.Errorf("tmux executable not found")
	}

	// Get window information with current working directory
	output, err := wm.executor.Execute("list-windows", "-t", sessionName, "-F",
		"#{window_index}:#{window_name}:#{pane_current_path}:#{pane_current_command}")
	if err != nil {
		return nil, fmt.Errorf("failed to list windows for path search in session %s: %w", sessionName, err)
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		
		parts := strings.Split(line, ":")
		if len(parts) >= 4 {
			index, _ := strconv.Atoi(parts[0])
			name := parts[1]
			currentPath := parts[2]
			command := parts[3]
			
			// Check if this window matches our criteria
			pathMatches := strings.HasPrefix(currentPath, projectPath) || currentPath == projectPath
			typeMatches := (windowType == "zsh" && (name == "zsh" || strings.Contains(command, "zsh"))) ||
						 (windowType == "claude" && (name == "claude" || strings.Contains(command, "claude")))
			
			if pathMatches && typeMatches {
				return &TmuxWindow{
					Index:   index,
					Name:    name,
					Command: command,
				}, nil
			}
		}
	}

	return nil, fmt.Errorf("no %s window found in %s for path %s", windowType, sessionName, projectPath)
}

// discoverSessionWindows discovers all windows in a session and their details
func (wm *TmuxWindowManager) discoverSessionWindows(sessionName string) (map[string]*TmuxWindow, error) {
	if wm.tmuxPath == "" {
		return nil, fmt.Errorf("tmux executable not found")
	}

	windows := make(map[string]*TmuxWindow)

	// Get comprehensive window information
	output, err := wm.executor.Execute("list-windows", "-t", sessionName, "-F",
		"#{window_index}:#{window_name}:#{window_active}:#{pane_current_command}:#{pane_title}")
	if err != nil {
		// Session might not exist or have no windows
		wm.logger.Debug("No windows found for session", "session", sessionName, "error", err)
		return windows, nil
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}

		parts := strings.Split(line, ":")
		if len(parts) >= 5 {
			indexStr := parts[0]
			name := parts[1]
			activeStr := parts[2]
			command := parts[3]
			paneTitle := strings.Join(parts[4:], ":") // Rejoin in case title contains colons

			index, err := strconv.Atoi(indexStr)
			if err != nil {
				wm.logger.Warn("Invalid window index", "index", indexStr, "session", sessionName)
				continue
			}

			active := activeStr == "1"

			window := &TmuxWindow{
				Index:     index,
				Name:      name,
				Command:   command,
				PaneTitle: paneTitle,
				Active:    active,
			}

			windows[name] = window
		}
	}

	return windows, nil
}