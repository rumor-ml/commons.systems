// Package terminal provides tmux session coordination and management for ICF projects.
// This file demonstrates the new testing pattern using factory and builder pattern.

package terminal

import (
	"context"
	"testing"

	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNewPatternExample demonstrates using the new factory/builder pattern
func TestNewPatternExample(t *testing.T) {
	ctx := context.Background()

	// Create test panes
	pane1 := &TmuxPane{
		SessionName:    "project1",
		WindowIndex:    0,
		PaneIndex:      0,
		PaneTitle:      "claude",
		CurrentCommand: "claude",
		CurrentPath:    "/home/user/project1",
		ShellType:      model.ShellTypeClaude,
	}

	pane2 := &TmuxPane{
		SessionName:    "project2",
		WindowIndex:    1,
		PaneIndex:      0,
		PaneTitle:      "zsh",
		CurrentCommand: "zsh",
		CurrentPath:    "/home/user/project2",
		ShellType:      model.ShellTypeZsh,
	}

	// Build test configuration using builder pattern
	testConfig := NewTmuxTestConfig().
		WithPane(pane1).
		WithPane(pane2).
		WithCurrentSession("project1").
		Build()

	// Create TmuxManager using factory with test configuration
	factory := NewTmuxManagerFactory()
	tm := factory.NewTesting(ctx, testConfig)

	// Verify panes were added
	assert.NotNil(t, tm)
	assert.Equal(t, 2, len(tm.panes))
	assert.Contains(t, tm.panes, "project1:0.0")
	assert.Contains(t, tm.panes, "project2:1.0")
}

// TestNewPatternWithProjects demonstrates testing with projects
func TestNewPatternWithProjects(t *testing.T) {
	ctx := context.Background()
	logger := log.Get()

	// Create test projects
	project := &model.Project{
		Name: "test-project",
		Path: "/home/user/test-project",
	}

	// Create test panes for the project
	claudePane := &TmuxPane{
		SessionName:    "test-project",
		WindowIndex:    0,
		PaneIndex:      0,
		PaneTitle:      "claude",
		CurrentCommand: "claude",
		CurrentPath:    "/home/user/test-project",
		ShellType:      model.ShellTypeClaude,
	}

	// Create mock executor
	mockExecutor := NewMockTmuxExecutor()
	mockExecutor.SetCommandOutput("/usr/local/bin/tmux display-message -p #{session_name}", []byte("test-project:0"))

	// Build test configuration
	testConfig := NewTmuxTestConfig().
		WithExecutor(mockExecutor).
		WithPane(claudePane).
		WithCurrentSession("test-project").
		Build()

	// Create TmuxManager
	factory := NewTmuxManagerFactory()
	tm := factory.NewTesting(ctx, testConfig)

	// Register project with pane
	tm.GetPaneRegistry().Register(claudePane, project)

	// Test finding Claude pane for project
	foundPanes := tm.GetPaneRegistry().GetProjectPanes(project, model.ShellTypeClaude)
	require.NotEmpty(t, foundPanes)
	foundEntry := foundPanes[0]
	assert.Equal(t, "test-project:0.0", foundEntry.PaneTarget)
	assert.Equal(t, project, foundEntry.OriginalProject)

	logger.Debug("Test passed with new pattern")
}

// TestNewPatternMigrationComparison shows the new pattern
func TestNewPatternMigrationComparison(t *testing.T) {
	ctx := context.Background()

	// Note: Old pattern methods (AddPaneForTesting, SetCurrentSessionOverride) have been removed.
	// All tests must now use the factory and builder pattern.

	t.Run("NewPattern", func(t *testing.T) {
		// New way - using factory and builder
		pane := &TmuxPane{
			SessionName: "new-test",
			WindowIndex: 0,
			PaneIndex:   0,
		}

		testConfig := NewTmuxTestConfig().
			WithPane(pane).
			WithCurrentSession("new-test").
			Build()

		factory := NewTmuxManagerFactory()
		tm := factory.NewTesting(ctx, testConfig)

		assert.Contains(t, tm.panes, "new-test:0.0")
	})
}

// TestNewPatternWithMockSessions demonstrates mocking sessions
func TestNewPatternWithMockSessions(t *testing.T) {
	ctx := context.Background()

	// Create mock session provider
	mockSessionProvider := NewMockSessionProvider()

	// Create test session
	testSession := &TmuxSession{
		Name: "mock-session",
		Windows: map[string]*TmuxWindow{
			"claude": {
				Index: 0,
				Name:  "claude",
			},
		},
	}

	mockSessionProvider.SetSession(testSession, "/home/user/mock-project")
	mockSessionProvider.SetCurrentSessionOverride("mock-session")

	// Build test configuration with custom session provider
	testConfig := NewTmuxTestConfig().
		WithSessionProvider(mockSessionProvider).
		Build()

	// Create TmuxManager
	factory := NewTmuxManagerFactory()
	tm := factory.NewTesting(ctx, testConfig)

	// Test session operations
	currentSession, err := tm.getCurrentTmuxSession()
	require.NoError(t, err)
	assert.Equal(t, "mock-session", currentSession)
}

// TestQuickTestConfig demonstrates helper functions
func TestQuickTestConfig(t *testing.T) {
	ctx := context.Background()

	t.Run("QuickConfig", func(t *testing.T) {
		// Quickest way to get a test TmuxManager
		factory := NewTmuxManagerFactory()
		tm := factory.NewTesting(ctx, QuickTestConfig())
		assert.NotNil(t, tm)
	})

	t.Run("ConfigWithPane", func(t *testing.T) {
		pane := &TmuxPane{
			SessionName: "quick-test",
			WindowIndex: 0,
			PaneIndex:   0,
		}

		factory := NewTmuxManagerFactory()
		tm := factory.NewTesting(ctx, TestConfigWithPane(pane))
		assert.Contains(t, tm.panes, "quick-test:0.0")
	})

	t.Run("ConfigWithSession", func(t *testing.T) {
		pane1 := &TmuxPane{SessionName: "session-test", WindowIndex: 0, PaneIndex: 0}
		pane2 := &TmuxPane{SessionName: "session-test", WindowIndex: 1, PaneIndex: 0}

		factory := NewTmuxManagerFactory()
		tm := factory.NewTesting(ctx, TestConfigWithSession("session-test", pane1, pane2))

		assert.Contains(t, tm.panes, "session-test:0.0")
		assert.Contains(t, tm.panes, "session-test:1.0")

		session, err := tm.getCurrentTmuxSession()
		require.NoError(t, err)
		assert.Equal(t, "session-test", session)
	})
}