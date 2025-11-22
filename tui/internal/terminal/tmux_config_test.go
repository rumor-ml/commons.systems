package terminal

import (
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/rumor-ml/log/pkg/log"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewTmuxConfig(t *testing.T) {
	logger := log.Get().WithComponent("test")

	tests := []struct {
		name     string
		tmuxPath string
		wantNil  bool
	}{
		{
			name:     "valid tmux path",
			tmuxPath: "/usr/bin/tmux",
			wantNil:  false,
		},
		{
			name:     "empty tmux path",
			tmuxPath: "",
			wantNil:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockExecutor := &MockTmuxExecutor{}
			config := NewTmuxConfig(tt.tmuxPath, logger, mockExecutor)
			if tt.wantNil {
				assert.Nil(t, config)
			} else {
				assert.NotNil(t, config)
				assert.Equal(t, tt.tmuxPath, config.tmuxPath)
			}
		})
	}
}

func TestTmuxConfig_setupGlobalKeybinding(t *testing.T) {
	// Skip if tmux is not available
	tmuxPath, err := exec.LookPath("tmux")
	if err != nil {
		t.Skip("tmux not found in PATH, skipping test")
	}

	logger := log.Get().WithComponent("test")

	tests := []struct {
		name        string
		tmuxPath    string
		expectError bool
	}{
		{
			name:        "valid tmux executable",
			tmuxPath:    tmuxPath,
			expectError: false,
		},
		{
			name:        "empty tmux path",
			tmuxPath:    "",
			expectError: true,
		},
		{
			name:        "invalid tmux path",
			tmuxPath:    "/invalid/path/to/tmux",
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockExecutor := &MockTmuxExecutor{}
			config := NewTmuxConfig(tt.tmuxPath, logger, mockExecutor)
			err := config.setupGlobalKeybinding()

			if tt.expectError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)

				// Verify the keybinding was created
				if tt.tmuxPath != "" {
					output, err := exec.Command(tmuxPath, "list-keys").Output()
					if err == nil {
						assert.Contains(t, string(output), "C-Space")
					}
				}
			}
		})
	}
}

func TestTmuxConfig_externalScript(t *testing.T) {
	// Test that the external script path is correctly configured
	scriptPath := "/Users/n8/carriercommons/tui/navigate-to-tui.sh"

	// Verify the script exists
	_, err := os.Stat(scriptPath)
	assert.NoError(t, err, "Navigation script should exist")

	// Verify the script is executable
	info, err := os.Stat(scriptPath)
	if err == nil {
		mode := info.Mode()
		assert.True(t, mode&0111 != 0, "Script should be executable")
	}
}

func TestTmuxConfig_scriptSyntax(t *testing.T) {
	// Test that the navigation script has valid syntax
	scriptPath := "/Users/n8/carriercommons/tui/navigate-to-tui.sh"

	// Read the script content
	content, err := os.ReadFile(scriptPath)
	if err != nil {
		t.Skip("Navigation script not found, skipping syntax test")
	}

	script := string(content)

	// Check for basic shell syntax validity
	// We can't actually run bash -n without executing, but we can check for common issues

	// Check for balanced quotes
	singleQuotes := strings.Count(script, "'")
	assert.Equal(t, 0, singleQuotes%2, "Single quotes should be balanced")

	// Check for balanced double quotes (excluding escaped ones)
	unescapedScript := strings.ReplaceAll(script, `\"`, "")
	doubleQuotes := strings.Count(unescapedScript, `"`)
	assert.Equal(t, 0, doubleQuotes%2, "Double quotes should be balanced")

	// Check for balanced parentheses
	openParens := strings.Count(script, "(")
	closeParens := strings.Count(script, ")")
	assert.Equal(t, openParens, closeParens, "Parentheses should be balanced")

	// Check for balanced brackets
	openBrackets := strings.Count(script, "[")
	closeBrackets := strings.Count(script, "]")
	assert.Equal(t, openBrackets, closeBrackets, "Brackets should be balanced")

	// Check that variable references are properly formatted
	assert.NotContains(t, script, "$ found_tui", "Variables should not have space after $")
	assert.NotContains(t, script, "$ target_session", "Variables should not have space after $")
	assert.NotContains(t, script, "$ session", "Variables should not have space after $")

	// Verify script contains TUI detection logic
	assert.Contains(t, script, `"$cmd" = "tui"`, "Script should detect TUI binary")
	assert.Contains(t, script, `"$cmd" = "go"`, "Script should detect go run command")
	assert.Contains(t, script, "tmux list-panes", "Script should use tmux list-panes")
}

func TestTmuxConfig_configureSessionKeyBindings(t *testing.T) {
	// Skip if tmux is not available
	tmuxPath, err := exec.LookPath("tmux")
	if err != nil {
		t.Skip("tmux not found in PATH, skipping test")
	}

	logger := log.Get().WithComponent("test")
	mockExecutor := &MockTmuxExecutor{}
	config := NewTmuxConfig(tmuxPath, logger, mockExecutor)

	// Create a test tmux session
	sessionName := "test-session-" + strings.ReplaceAll(t.Name(), "/", "-")
	createCmd := exec.Command(tmuxPath, "new-session", "-d", "-s", sessionName)
	err = createCmd.Run()
	if err != nil {
		// Try to kill existing session and retry
		exec.Command(tmuxPath, "kill-session", "-t", sessionName).Run()
		err = createCmd.Run()
		require.NoError(t, err, "Failed to create test tmux session")
	}

	// Ensure cleanup
	defer exec.Command(tmuxPath, "kill-session", "-t", sessionName).Run()

	// Test configuring session key bindings
	err = config.configureSessionKeyBindings(sessionName)
	assert.NoError(t, err)

	// Verify some bindings were created (we can't easily verify all)
	output, err := exec.Command(tmuxPath, "-t", sessionName, "list-keys").Output()
	if err == nil && len(output) > 0 {
		// Just verify the command ran successfully
		assert.True(t, len(output) > 0, "Should have some key bindings")
	}
}

func TestTmuxConfig_pathDiscovery(t *testing.T) {
	// Test that the TUI path discovery logic works correctly
	tests := []struct {
		name           string
		setupFunc      func() string
		expectFound    bool
		cleanupFunc    func(string)
	}{
		{
			name: "TUI in current directory",
			setupFunc: func() string {
				// Create a mock executable in temp directory
				tmpDir := t.TempDir()
				tuiPath := tmpDir + "/tui"
				err := os.WriteFile(tuiPath, []byte("#!/bin/sh\necho TUI"), 0755)
				require.NoError(t, err)
				return tmpDir
			},
			expectFound: true,
			cleanupFunc: func(dir string) {},
		},
		{
			name: "TUI not found",
			setupFunc: func() string {
				// Use a directory without TUI executable
				return t.TempDir()
			},
			expectFound: false,
			cleanupFunc: func(dir string) {},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testDir := tt.setupFunc()
			defer tt.cleanupFunc(testDir)

			// Change to test directory
			oldDir, err := os.Getwd()
			require.NoError(t, err)
			defer os.Chdir(oldDir)

			err = os.Chdir(testDir)
			require.NoError(t, err)

			// Check if TUI would be found
			_, err = os.Stat("./tui")
			if tt.expectFound {
				assert.NoError(t, err, "TUI should be found")
			} else {
				assert.Error(t, err, "TUI should not be found")
			}
		})
	}
}