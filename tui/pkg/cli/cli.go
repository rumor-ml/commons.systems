package cli

import (
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	projectdiscovery "github.com/rumor-ml/carriercommons/pkg/discovery"
	icflog "github.com/rumor-ml/log/pkg/log"
)

// Config holds the CLI configuration
type Config struct {
	Tools      bool
	Help       bool
	SwitchMode bool
	Args       []string
}

// Parse parses command line arguments and returns configuration
func Parse() (*Config, error) {
	config := &Config{}

	// Define flags
	flag.BoolVar(&config.Tools, "p", false, "Run assistant tools in stdio mode")
	flag.BoolVar(&config.Help, "h", false, "Show help")
	flag.BoolVar(&config.SwitchMode, "switch-mode", false, "Switch to existing TUI instance or create new one")

	// Parse flags
	flag.Parse()

	// Get remaining arguments
	config.Args = flag.Args()

	return config, nil
}

// Execute runs the appropriate command based on configuration
func Execute(config *Config) error {
	if config.Help {
		return showHelp()
	}

	if config.Tools {
		return runTools()
	}

	if config.SwitchMode {
		return runSwitchMode()
	}

	// Default: run multiplexer
	return runMultiplexer()
}

func showHelp() error {
	fmt.Printf(`TUI - Terminal User Interface multiplexer

Usage:
  tui                              Run TTY multiplexer (default)
  tui -p                           Run tools in stdio mode
  tui -switch-mode                 Switch to existing TUI instance or create new one
  tui -h                           Show this help

The TTY multiplexer provides git worktree-aware project navigation
with accordion-style interface and Claude Code integration.

`)
	return nil
}

func runTools() error {
	fmt.Println("Tools mode not yet implemented")
	return nil
}

func runSwitchMode() error {
	// Use proper logging infrastructure
	logger := icflog.Get().WithComponent("cli-switch")
	cwd, _ := os.Getwd()
	logger.Debug("Switch-mode called", "cwd", cwd)

	// Use the project discovery system to find carriercommons root
	currentProjectPath := projectdiscovery.FindCarrierCommonsRoot()
	if currentProjectPath == "" {
		logger.Error("Could not find carriercommons root directory")
		return fmt.Errorf("could not find carriercommons root directory")
	}
	
	// The TUI project is a submodule, so look for it
	tuiPath := filepath.Join(currentProjectPath, "tui")
	if _, err := os.Stat(tuiPath); err != nil {
		logger.Error("TUI submodule not found", "path", tuiPath, "error", err)
		return fmt.Errorf("tui submodule not found at %s", tuiPath)
	}
	
	logger.Debug("Found project paths", "carriercommons_root", currentProjectPath, "tui_path", tuiPath)
	
	// Find tmux executable
	tmuxPath, err := exec.LookPath("tmux")
	if err != nil {
		return fmt.Errorf("tmux not found: %w", err)
	}

	// Get current tmux session first
	currentSessionCmd := exec.Command(tmuxPath, "display-message", "-p", "#{session_name}")
	sessionOutput, err := currentSessionCmd.Output()
	if err != nil {
		return fmt.Errorf("failed to get current session: %w", err)
	}
	currentSession := strings.TrimSpace(string(sessionOutput))

	// Look for existing TUI instances in current session only (all windows)
	cmd := exec.Command(tmuxPath, "list-panes", "-s", "-t", currentSession, "-F", 
		"#{session_name}:#{window_index}.#{pane_index}:#{pane_current_command}:#{pane_current_path}")
	
	output, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("failed to list tmux panes: %w", err)
	}

	// Parse output to find matching TUI instances in current session
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		
		parts := strings.Split(line, ":")
		if len(parts) < 4 {
			continue
		}
		
		command := parts[2]
		path := strings.Join(parts[3:], ":") // Handle colons in paths
		
		// Check if this is a TUI process in our TUI project directory
		if (command == "tui" || command == "go") && path == tuiPath {
			// Found existing TUI instance in current session, switch to it
			paneTarget := parts[0] + ":" + parts[1]
			
			logger.Debug("Found existing TUI instance", "pane_target", paneTarget)
			
			// Check if we're already in the target pane
			currentPaneCmd := exec.Command(tmuxPath, "display-message", "-p", "#{session_name}:#{window_index}.#{pane_index}")
			if currentPaneOutput, err := currentPaneCmd.Output(); err == nil {
				currentPane := strings.TrimSpace(string(currentPaneOutput))
				logger.Debug("Pane comparison", "current", currentPane, "target", paneTarget)
				
				if currentPane == paneTarget {
					logger.Debug("Already in target pane, no switch needed")
					return nil
				}
			}
			
			// Switch to the target pane (which may be in a different window)
			// Use select-window first, then select-pane to handle cross-window navigation
			selectCmd := exec.Command(tmuxPath, "select-window", "-t", paneTarget)
			err := selectCmd.Run()
			
			if err != nil {
				logger.Error("Failed to switch to pane", "pane_target", paneTarget, "error", err)
			} else {
				logger.Debug("Successfully switched to TUI pane")
				
				// Verify the switch worked
				verifyPaneCmd := exec.Command(tmuxPath, "display-message", "-p", "#{session_name}:#{window_index}.#{pane_index}")
				if verifyOutput, verifyErr := verifyPaneCmd.Output(); verifyErr == nil {
					newPane := strings.TrimSpace(string(verifyOutput))
					logger.Debug("Switch verification", "current_pane", newPane)
				}
			}
			
			return err
		}
	}
	
	logger.Debug("No matching TUI found, creating new one")

	// No existing TUI found in current session, create new one
	
	// Check current pane command to decide how to launch TUI
	currentCmdExec := exec.Command(tmuxPath, "display-message", "-p", "#{pane_current_command}")
	currentCmdOutput, err := currentCmdExec.Output()
	if err != nil {
		return fmt.Errorf("failed to get current command: %w", err)
	}
	
	currentCommand := strings.TrimSpace(string(currentCmdOutput))
	
	// If current pane is a shell, use it; otherwise create new window
	if currentCommand == "zsh" || currentCommand == "bash" || 
	   currentCommand == "-zsh" || currentCommand == "-bash" {
		// Start TUI in current pane
		sendCmd := exec.Command(tmuxPath, "send-keys", 
			fmt.Sprintf("cd %s && ./tui", tuiPath), "Enter")
		return sendCmd.Run()
	} else {
		// Create new window for TUI
		newWindowCmd := exec.Command(tmuxPath, "new-window", "-n", "icf-tui", "-c", tuiPath)
		if err := newWindowCmd.Run(); err != nil {
			return fmt.Errorf("failed to create new window: %w", err)
		}
		
		// Start TUI in the new window
		sendCmd := exec.Command(tmuxPath, "send-keys", "./tui", "Enter")
		return sendCmd.Run()
	}
}


func runMultiplexer() error {
	// This function is called from Execute but main.go handles
	// the multiplexer case directly, so this shouldn't be reached
	fmt.Println("Error: runMultiplexer called unexpectedly")
	return nil
}
