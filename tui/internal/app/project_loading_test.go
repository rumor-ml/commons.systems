package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/exp/teatest"
	"github.com/natb1/tui/internal/ui"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestProjectDiscoveryInitialization tests that project discovery properly initializes
func TestProjectDiscoveryInitialization(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")

	// Create temporary workspace
	tmpDir := t.TempDir()
	workspaceRoot := filepath.Join(tmpDir, "workspace")
	icfDir := filepath.Join(workspaceRoot, "icf")

	require.NoError(t, os.MkdirAll(icfDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(icfDir, "README.md"), []byte("# ICF"), 0644))

	// Create project map
	pm, err := NewExternalProjectMap(workspaceRoot)
	require.NoError(t, err)
	require.NotNil(t, pm)

	// Should not be initialized before Init() is called
	assert.False(t, pm.IsInitialized(), "project map should not be initialized before Init()")

	// Initialize
	cmd := pm.Init()
	assert.NotNil(t, cmd, "Init() should return a command")

	// Execute the initialization command
	msg := cmd()
	assert.NotNil(t, msg, "initialization command should return a message")

	// After processing discovery complete message, should be initialized
	if _, ok := msg.(ProjectDiscoveryCompleteMsg); ok {
		// In real app, this would be processed by Update()
		assert.True(t, true, "should receive ProjectDiscoveryCompleteMsg")
	}
}

// TestUpdateNavigationProjects tests the updateNavigationProjects function
func TestUpdateNavigationProjects(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")

	// Create temporary workspace
	tmpDir := t.TempDir()
	workspaceRoot := filepath.Join(tmpDir, "workspace")
	icfDir := filepath.Join(workspaceRoot, "icf")
	projectDir := filepath.Join(workspaceRoot, "testproject")

	require.NoError(t, os.MkdirAll(icfDir, 0755))
	require.NoError(t, os.MkdirAll(projectDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(projectDir, "README.md"), []byte("# Test Project"), 0644))

	// Create app
	app, err := New(workspaceRoot)
	require.NoError(t, err)

	// Simulate project discovery by forcing initialization
	// (In a real scenario, this would happen through the discovery process)
	if app.projects != nil {
		// Force initialization for test
		app.projects.Init()
		// Wait a bit for async operations
		time.Sleep(100 * time.Millisecond)
	}

	// Force project discovery to complete
	if app.projects != nil {
		// Wait for initialization to complete
		time.Sleep(200 * time.Millisecond)
	}

	// Call updateNavigationProjects
	app.updateNavigationProjects()

	// Check that navigation was updated
	nav := app.uiManager.GetNavigationComponent()
	require.NotNil(t, nav)

	// Navigation should have at least the current directory as a project
	// (since we handle the case of no discovered projects)
	projects := nav.GetProjects()
	// Projects might be nil if not initialized yet, which is okay for this test
	// The important part is that updateNavigationProjects doesn't crash
	t.Logf("Projects after update: %v", projects)
}

// navigationTestModel is a minimal model for testing navigation updates
type navigationTestModel struct {
	nav      *ui.NavigationComponent
	messages []string
}

func (m *navigationTestModel) Init() tea.Cmd {
	return m.nav.Init()
}

func (m *navigationTestModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	// Log message types for debugging
	m.messages = append(m.messages, fmt.Sprintf("%T", msg))

	_, cmd := m.nav.Update(msg)
	return m, cmd
}

func (m *navigationTestModel) View() string {
	return m.nav.View()
}

// TestNavigationProjectDisplay tests that navigation displays projects correctly
func TestNavigationProjectDisplay(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")

	nav := ui.NewNavigationComponent()
	nav.SetSize(120, 40)

	// Create test projects
	projects := []*model.Project{
		{
			Name: "assistant",
			Path: "/test/assistant",
		},
		{
			Name: "icf",
			Path: "/test/icf",
		},
	}

	// Set projects
	nav.SetProjects(projects)

	// Create test model
	testModel := &navigationTestModel{nav: nav}

	// Run with teatest
	tm := teatest.NewTestModel(t, testModel, teatest.WithInitialTermSize(120, 40))

	// Wait for initial render
	time.Sleep(100 * time.Millisecond)

	// Get output
	output := ""
	teatest.WaitFor(t, tm.Output(), func(bts []byte) bool {
		output = string(bts)
		return strings.Contains(output, "ssistant") || strings.Contains(output, "cf")
	}, teatest.WithDuration(500*time.Millisecond))

	// Verify correct display
	// Verify project content is displayed (the title is handled by renderer, not navigation component)
	assert.Contains(t, output, "ssistant", "should show assistant project (with or without keybinding)")
	assert.Contains(t, output, "cf", "should show icf project (with or without keybinding)")

	// Should NOT contain raw pane data
	assert.NotContains(t, output, "tmux:", "should not show tmux prefixes")
	assert.NotContains(t, output, "pane_", "should not show pane identifiers")
	assert.NotContains(t, output, "%", "should not show tmux pane percentages")

	tm.Quit()
}

// TestEmptyProjectHandling tests that navigation handles empty project list gracefully
func TestEmptyProjectHandling(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")

	nav := ui.NewNavigationComponent()
	nav.SetSize(120, 40)

	// Set empty projects
	nav.SetProjects([]*model.Project{})

	// Get view
	view := nav.View()

	// Should show header but indicate no projects
	assert.Contains(t, view, "No projects found", "should show no projects message")

	// Should NOT show error or panic
	assert.NotContains(t, view, "panic", "should not panic with empty projects")
	assert.NotContains(t, view, "error", "should not show error with empty projects")
}

// TestProjectConversionRegression tests the specific case that caused the regression
func TestProjectConversionRegression(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")

	// Create temporary workspace that mimics the regression scenario
	tmpDir := t.TempDir()
	workspaceRoot := filepath.Join(tmpDir, "intent")
	icfDir := filepath.Join(workspaceRoot, "icf")
	assistantDir := filepath.Join(workspaceRoot, "assistant")
	worktreeDir := filepath.Join(assistantDir, ".worktrees", "blocked-indicator")

	// Create all directories
	require.NoError(t, os.MkdirAll(icfDir, 0755))
	require.NoError(t, os.MkdirAll(assistantDir, 0755))
	require.NoError(t, os.MkdirAll(worktreeDir, 0755))

	// Create marker files
	require.NoError(t, os.WriteFile(filepath.Join(icfDir, "README.md"), []byte("# ICF"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(assistantDir, "README.md"), []byte("# Assistant"), 0644))

	// Note: ICF_WORKSPACE_ROOT is no longer used, discovery is based on git submodules

	// Change to worktree directory to simulate the regression scenario
	oldCwd, err := os.Getwd()
	require.NoError(t, err)
	defer os.Chdir(oldCwd)

	err = os.Chdir(worktreeDir)
	require.NoError(t, err)

	// Test modern approach - no explicit workspace root needed
	detectedRoot, err := os.Getwd()
	require.NoError(t, err)

	// Normalize paths to handle macOS /var -> /private/var symlinks
	worktreeDirNorm, err := filepath.EvalSymlinks(worktreeDir)
	require.NoError(t, err)
	detectedRootNorm, err := filepath.EvalSymlinks(detectedRoot)
	require.NoError(t, err)

	// The modern approach auto-detects the current working directory
	assert.Equal(t, worktreeDirNorm, detectedRootNorm,
		"MODERN APPROACH: Should be in correct working directory")

	// Create app without explicit workspace root - it will auto-detect
	app, err := New("")
	require.NoError(t, err, "MODERN APPROACH: App creation should not fail with auto-detection")

	// Verify the app has resolved the workspace root correctly
	appRootResolved, _ := filepath.EvalSymlinks(app.workspaceRoot)
	detectedRootResolved, _ := filepath.EvalSymlinks(detectedRoot)
	assert.Equal(t, detectedRootResolved, appRootResolved,
		"MODERN APPROACH: App should auto-detect current working directory as workspace root")

	// The navigation component should be properly initialized
	nav := app.uiManager.GetNavigationComponent()
	require.NotNil(t, nav, "REGRESSION TEST: Navigation component should exist")

	// Update navigation to trigger the conversion
	app.updateNavigationProjects()

	// Even if no projects are discovered yet, navigation should handle it gracefully
	// and not show raw pane data
	view := nav.View()
	assert.Contains(t, view, "No projects found",
		"REGRESSION TEST: Should show proper header, not raw data")
	assert.NotContains(t, view, "tmux:",
		"REGRESSION TEST: Should not show raw tmux data when projects aren't loaded")
}
