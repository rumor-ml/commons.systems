// main.go - TUI entry point
//
// ## Metadata
//
// TUI main executable providing unified terminal multiplexing and assistant UI.
//
// ### Purpose
//
// Command-line entry point for the TUI application, handling argument parsing,
// initialization, and launching the unified Bubble Tea interface that serves as both terminal
// multiplexer and TUI assistant.
//
// ### Instructions
//
// #### Application Startup
//
// ##### Workspace Detection
//
// Initialize ICF workspace discovery using environment variables and fallback detection to
// establish the root directory for project scanning and metadata aggregation.
//
// ##### Mode Selection
//
// Support command-line flags for initial mode selection (terminal focus, assistant focus, or
// split view) while defaulting to the user's previous session preference.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing workspace detection patterns and project discovery algorithms that
// form the foundation for multiplexer project awareness.

package main

import (
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
	"github.com/natb1/tui/internal/app"
	"github.com/natb1/tui/pkg/cli"
	"github.com/rumor-ml/log/pkg/log"
)

func main() {
	// Force color environment FIRST, before any library initialization
	os.Setenv("COLORTERM", "truecolor")
	os.Setenv("TERM", "xterm-256color")
	os.Setenv("FORCE_COLOR", "1")
	os.Setenv("CLICOLOR_FORCE", "1")

	// Initialize logging after setting environment
	logger := log.Get().WithComponent("tui")
	// Removed: Verbose INFO log (startup message, not useful in production)

	// Acquire single-instance lock BEFORE any other initialization
	// This prevents multiple TUI processes from running and competing for marker files
	lock, err := app.AcquireInstanceLock()
	if err != nil {
		logger.Error("Failed to acquire instance lock", "error", err)
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		fmt.Fprintf(os.Stderr, "\nTroubleshooting:\n")
		fmt.Fprintf(os.Stderr, "  - Check for existing TUI in tmux window 'tui'\n")
		fmt.Fprintf(os.Stderr, "  - If no TUI visible, remove stale lock: rm -f /tmp/tui-instance.sock\n")
		os.Exit(1)
	}
	defer (*lock).Close() // Auto-cleanup on exit
	// Removed: Verbose INFO log (called repeatedly)

	// Set up signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		sig := <-sigChan
		logger.Info("Received signal, shutting down gracefully", "signal", sig)
		// Lock will be cleaned up by defer when main() exits
		os.Exit(0)
	}()

	// Set color profile for the application
	lipgloss.SetColorProfile(termenv.TrueColor)

	// Parse command line arguments
	config, err := cli.Parse()
	if err != nil {
		logger.Error("Failed to parse arguments", "error", err)
		fmt.Fprintf(os.Stderr, "Error parsing arguments: %v\n", err)
		os.Exit(1)
	}
	// Removed: Verbose INFO log (called repeatedly)

	// Handle non-multiplexer modes first
	if config.Help || config.Tools || config.SwitchMode {
		// Removed: Verbose INFO log (called repeatedly)
		if err := cli.Execute(config); err != nil {
			logger.Error("CLI execute failed", "error", err)
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		return
	}

	// Removed: Verbose INFO log (called repeatedly)

	// Check if we need to launch inside tmux
	if err := ensureRunningInTmux(); err != nil {
		logger.Error("Failed to ensure running in tmux", "error", err)
		fmt.Fprintf(os.Stderr, "Error launching in tmux: %v\n", err)
		os.Exit(1)
	}

	// Default: run full multiplexer with existing UI
	// Create application controller - project discovery will use current directory automatically
	// Removed: Verbose INFO log (startup message, not useful in production)
	muxApp, err := app.New("")
	if err != nil {
		logger.Error("Failed to create app", "error", err)
		fmt.Fprintf(os.Stderr, "Error initializing ICF multiplexer: %v\n", err)
		os.Exit(1)
	}
	// Removed: Verbose INFO log (startup message, not useful in production)

	// Color environment already set at startup

	// Force color profile one more time right before starting Bubble Tea
	lipgloss.SetColorProfile(termenv.TrueColor)

	// Start Bubble Tea program with explicit input/output to force color preservation
	// Removed: Verbose INFO logs (startup messages, not useful in production)
	program := tea.NewProgram(muxApp,
		tea.WithAltScreen(),
		tea.WithInput(os.Stdin),
		tea.WithOutput(os.Stdout))
	// Removed: Verbose INFO log (startup message, not useful in production)

	// Run the program and handle tmux attachment if needed
	// Removed: Verbose INFO log (startup message, not useful in production)
	model, err := program.Run()
	logger.Info("Bubble Tea program.Run() returned", "error", err)
	if err != nil {
		logger.Error("Program run failed", "error", err)
		fmt.Fprintf(os.Stderr, "Error running ICF multiplexer: %v\n", err)
		os.Exit(1)
	}

	// Check if we need to attach to tmux
	if appModel, ok := model.(*app.App); ok {
		if err := handleTmuxAttachment(appModel); err != nil {
			fmt.Fprintf(os.Stderr, "Error handling tmux attachment: %v\n", err)
			os.Exit(1)
		}
	}

	// Show log database path on exit
	if logDB := os.Getenv("ICF_LOG_DB"); logDB != "" {
		fmt.Printf("\nLogs saved to: %s\n", logDB)
	}
}

// ensureRunningInTmux ensures the application is running inside tmux
func ensureRunningInTmux() error {
	logger := log.Get()

	// Check if we're already inside tmux
	if os.Getenv("TMUX") != "" {
		// Removed: Verbose INFO log (called repeatedly)
		return nil
	}

	// Removed: Verbose INFO log (called repeatedly)

	// Find tmux executable
	tmuxPath, err := findTmuxExecutable()
	if err != nil {
		return fmt.Errorf("tmux not available: %w", err)
	}

	// Get current executable path and arguments
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("failed to get executable path: %w", err)
	}

	// Create a tmux session that runs the ICF assistant directly
	sessionName := "icf-assistant-main"

	// Prepare the full command line
	cmdLine := executable
	if len(os.Args) > 1 {
		cmdLine += " " + strings.Join(os.Args[1:], " ")
	}

	logger.Info("Creating tmux session with ICF assistant",
		"session", sessionName,
		"command", cmdLine)

	// Create new session and run the command, then attach
	// Use -A flag to attach if session exists, create if it doesn't
	// This replaces the current process entirely
	env := os.Environ()
	args := []string{tmuxPath, "new-session", "-A", "-s", sessionName, cmdLine}

	logger.Info("Executing tmux new-session", "args", args)
	return syscall.Exec(tmuxPath, args, env)
}

var tmuxPathCache string
var tmuxPathOnce sync.Once

// findTmuxExecutable finds the tmux executable with caching
func findTmuxExecutable() (string, error) {
	var err error
	tmuxPathOnce.Do(func() {
		// Try PATH first (fastest)
		if path, pathErr := exec.LookPath("tmux"); pathErr == nil {
			tmuxPathCache = path
			return
		}

		// Try common locations
		locations := []string{
			"/opt/homebrew/bin/tmux",          // Homebrew on Apple Silicon
			"/usr/local/bin/tmux",             // Homebrew on Intel
			"/usr/bin/tmux",                   // System package
			"/run/current-system/sw/bin/tmux", // NixOS
		}

		for _, path := range locations {
			if _, statErr := os.Stat(path); statErr == nil {
				tmuxPathCache = path
				return
			}
		}

		err = fmt.Errorf("tmux executable not found")
	})

	if tmuxPathCache == "" && err != nil {
		return "", err
	}
	return tmuxPathCache, nil
}

// handleTmuxAttachment handles tmux session attachment after TUI exit
func handleTmuxAttachment(appModel *app.App) error {
	logger := log.Get()

	// Check if there's a pending tmux attachment
	attachment := appModel.GetPendingAttachment()
	if attachment == nil {
		logger.Info("No pending tmux attachment")
		return nil
	}

	logger.Info("Processing tmux attachment",
		"session", attachment.SessionName,
		"window", attachment.WindowName)

	// Get tmux manager to access tmux executable path
	tmuxManager := appModel.GetTmuxManager()
	if tmuxManager == nil {
		return fmt.Errorf("tmux manager not available")
	}

	// Use tmux manager to attach to the session
	err := tmuxManager.AttachToWindow(attachment.SessionName, attachment.WindowName)
	if err != nil {
		logger.Error("Failed to attach to tmux session",
			"session", attachment.SessionName,
			"window", attachment.WindowName,
			"error", err)
		return fmt.Errorf("tmux attachment failed: %w", err)
	}

	logger.Info("Tmux session ended, returning to TUI")
	return nil
}
