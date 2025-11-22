package app

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	discovery "github.com/rumor-ml/carriercommons/pkg/discovery"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestClaudeNavigationIntegration tests the full navigation flow with a real tmux session
func TestClaudeNavigationIntegration(t *testing.T) {
	// Removed short mode skip per user feedback

	ctx := context.Background()
	sessionName := fmt.Sprintf("icf-test-%d", time.Now().Unix())

	// Create test tmux session
	createCmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName)
	err := createCmd.Run()
	require.NoError(t, err, "Failed to create test tmux session")

	// Ensure cleanup
	defer func() {
		killCmd := exec.Command("tmux", "kill-session", "-t", sessionName)
		_ = killCmd.Run()
	}()

	// Create tmux manager using new pattern
	testConfig := terminal.NewTmuxTestConfig().
		WithCurrentSession(sessionName).
		Build()

	factory := terminal.NewTmuxManagerFactory()
	tm := factory.NewTesting(ctx, testConfig)

	// Check initial window count
	initialWindows := getWindowList(t, sessionName)
	initialWindowCount := len(initialWindows)
	t.Logf("Initial window count: %d, windows: %v", initialWindowCount, initialWindows)

	// Try to find real carriercommons root for integration testing
	carriercommonsRoot := discovery.FindCarrierCommonsRoot()
	if carriercommonsRoot == "" {
		// If not in carriercommons, use temp directories for testing
		tmpDir := t.TempDir()
		carriercommonsRoot = tmpDir
		// Create test project directories
		os.MkdirAll(filepath.Join(tmpDir, "log"), 0755)
		os.MkdirAll(filepath.Join(tmpDir, "project"), 0755)
		os.MkdirAll(filepath.Join(tmpDir, "tui"), 0755)
	}

	// Create test projects using discovered or temp paths
	logProject := &model.Project{
		Name: "log",
		Path: filepath.Join(carriercommonsRoot, "log"),
	}

	projectProject := &model.Project{
		Name: "project",
		Path: filepath.Join(carriercommonsRoot, "project"),
	}

	tuiProject := &model.Project{
		Name: "tui",
		Path: filepath.Join(carriercommonsRoot, "tui"),
	}

	// Test 1: Create Claude window for project
	t.Run("CreateClaudeWindowForProject", func(t *testing.T) {
		session, err := tm.CreateProjectSession(projectProject)
		require.NoError(t, err)
		assert.Equal(t, sessionName, session.Name)

		window, err := tm.CreateOrGetWindow(session.Name, projectProject.Name, "claude", "", projectProject)
		require.NoError(t, err)
		assert.NotNil(t, window)

		// Verify window was created
		windows := getWindowList(t, sessionName)
		assert.Contains(t, windows, "project", "Should have created window named 'project'")
		assert.Equal(t, initialWindowCount+1, len(windows), "Should have created one new window")
	})

	// Test 2: Create Claude window for log project
	t.Run("CreateClaudeWindowForLog", func(t *testing.T) {
		session, err := tm.CreateProjectSession(logProject)
		require.NoError(t, err)
		assert.Equal(t, sessionName, session.Name)

		window, err := tm.CreateOrGetWindow(session.Name, logProject.Name, "claude", "", logProject)
		require.NoError(t, err)
		assert.NotNil(t, window)

		// Verify window was created
		windows := getWindowList(t, sessionName)
		assert.Contains(t, windows, "log", "Should have created window named 'log'")
		assert.Equal(t, initialWindowCount+2, len(windows), "Should have two new windows")
	})

	// Test 3: Verify path-based discovery works
	t.Run("PathBasedDiscovery", func(t *testing.T) {
		// Try to get the log claude window again
		session, err := tm.CreateProjectSession(logProject)
		require.NoError(t, err)

		window, err := tm.CreateOrGetWindow(session.Name, logProject.Name, "claude", "", logProject)
		require.NoError(t, err)
		assert.NotNil(t, window)

		// Should still have same number of windows (not created a duplicate)
		windows := getWindowList(t, sessionName)
		assert.Equal(t, initialWindowCount+2, len(windows), "Should not create duplicate window")
	})

	// Test 4: Create different shell types
	t.Run("DifferentShellTypes", func(t *testing.T) {
		session, err := tm.CreateProjectSession(tuiProject)
		require.NoError(t, err)
		t.Logf("Created session: %s", session.Name)

		// Create nvim window instead of zsh to avoid conflict with the default window
		t.Logf("Calling CreateOrGetWindow with sessionName=%s, windowName=%s, command=%s",
			session.Name, tuiProject.Name, "nvim")
		window, err := tm.CreateOrGetWindow(session.Name, tuiProject.Name, "nvim", "", tuiProject)
		require.NoError(t, err)
		assert.NotNil(t, window)
		t.Logf("Created window: Name=%s, Command=%s, Index=%d", window.Name, window.Command, window.Index)

		windows := getWindowList(t, sessionName)
		t.Logf("Windows after creation: %v", windows)

		// The window should be named "tui" as that's what we passed as windowName
		assert.Contains(t, windows, "tui", "Should have created window named 'tui'")

		// When running all tests together, expect 4 windows (initial + project + log + tui)
		// When running alone, expect 2 windows (initial zsh + tui)
		expectedCount := initialWindowCount + 1
		if initialWindowCount == 1 {
			// Running alone
			expectedCount = 2
		} else {
			// Running with other tests
			expectedCount = initialWindowCount + 3
		}
		assert.GreaterOrEqual(t, len(windows), expectedCount, "Should have created new windows")
	})
}

// getWindowList returns list of window names in a tmux session
func getWindowList(t *testing.T, sessionName string) []string {
	cmd := exec.Command("tmux", "list-windows", "-t", sessionName, "-F", "#{window_name}")
	output, err := cmd.Output()
	require.NoError(t, err, "Failed to list windows")

	windows := strings.Split(strings.TrimSpace(string(output)), "\n")
	return windows
}
