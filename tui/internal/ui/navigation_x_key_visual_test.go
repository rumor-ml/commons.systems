package ui

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/exp/teatest"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNavigationXKeyVisualUpdate tests X key blocked indicator visual updates
func TestNavigationXKeyVisualUpdate(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")

	// Create navigation component
	nav := NewNavigationComponent()
	nav.SetSize(120, 40)

	// Create test projects
	projects := []*model.Project{
		{
			Name:      "assistant",
			Path:      "/test/assistant",
			IsBlocked: false,
		},
		{
			Name:      "icf",
			Path:      "/test/icf",
			IsBlocked: false,
		},
	}

	// Set projects
	nav.SetProjects(projects)

	// Get initial view
	initialView := nav.View()
	t.Logf("Initial view: %s", initialView)

	// Should not contain blocked indicator initially
	assert.NotContains(t, initialView, "🚫", "should not have blocked indicator initially")

	// Press 'a' then 'x' to toggle assistant project
	nav.Update(tea.KeyMsg{
		Type:  tea.KeyRunes,
		Runes: []rune{'a'},
	})

	_, cmd := nav.Update(tea.KeyMsg{
		Type:  tea.KeyRunes,
		Runes: []rune{'x'},
	})
	require.NotNil(t, cmd, "should return command after 'x'")

	// Execute the command to get the message
	msg := cmd()
	toggleMsg, ok := msg.(ToggleBlockedMsg)
	require.True(t, ok, "should be ToggleBlockedMsg")

	// Manually toggle the project state (simulating what controller does)
	toggleMsg.Project.IsBlocked = true

	// Force refresh by calling RefreshDisplay (simulating what controller does)
	nav.RefreshDisplay()

	// Get view after toggle
	afterView := nav.View()
	t.Logf("After toggle view: %s", afterView)

	// Should now contain blocked indicator
	assert.Contains(t, afterView, "🚫", "should have blocked indicator after toggle")

	// Check for muted color (ANSI code 239)
	assert.Contains(t, afterView, "\x1b[38;5;239m", "should have muted color for blocked project")
}

// TestNavigationXKeyIntegration tests the full integration with controller-like behavior
func TestNavigationXKeyIntegration(t *testing.T) {
	// Initialize logging
	log.Get().WithComponent("test")

	// Create test model that simulates controller behavior
	testModel := &xKeyIntegrationModel{
		nav: NewNavigationComponent(),
		projects: []*model.Project{
			{
				Name:      "assistant",
				Path:      "/test/assistant",
				IsBlocked: false,
			},
			{
				Name:      "icf",
				Path:      "/test/icf",
				IsBlocked: false,
			},
		},
	}
	testModel.nav.SetSize(120, 40)
	testModel.nav.SetProjects(testModel.projects)

	// Run with teatest
	tm := teatest.NewTestModel(t, testModel, teatest.WithInitialTermSize(120, 40))

	// Wait for initial render - look for the keybinding format
	teatest.WaitFor(t, tm.Output(), func(bts []byte) bool {
		return strings.Contains(string(bts), "[a]ssistant")
	}, teatest.WithDuration(500*time.Millisecond))

	// Get initial output
	initialOutput := ""
	teatest.WaitFor(t, tm.Output(), func(bts []byte) bool {
		initialOutput = string(bts)
		return true
	}, teatest.WithDuration(100*time.Millisecond))

	t.Logf("Initial output contains blocked indicator: %v", strings.Contains(initialOutput, "🚫"))

	// Send 'a' then 'x'
	tm.Send(tea.KeyMsg{
		Type:  tea.KeyRunes,
		Runes: []rune{'a'},
	})
	time.Sleep(50 * time.Millisecond)

	tm.Send(tea.KeyMsg{
		Type:  tea.KeyRunes,
		Runes: []rune{'x'},
	})
	time.Sleep(100 * time.Millisecond)

	// Get output after toggle
	finalOutput := ""
	teatest.WaitFor(t, tm.Output(), func(bts []byte) bool {
		finalOutput = string(bts)
		return strings.Contains(finalOutput, "🚫")
	}, teatest.WithDuration(500*time.Millisecond))

	t.Logf("Final output contains blocked indicator: %v", strings.Contains(finalOutput, "🚫"))

	// Verify the toggle worked
	assert.Contains(t, finalOutput, "🚫", "should show blocked indicator after toggle")
	assert.True(t, testModel.projects[0].IsBlocked, "assistant project should be blocked")

	tm.Quit()
}

// xKeyIntegrationModel simulates controller behavior
type xKeyIntegrationModel struct {
	nav      *NavigationComponent
	projects []*model.Project
}

func (m *xKeyIntegrationModel) Init() tea.Cmd {
	return m.nav.Init()
}

func (m *xKeyIntegrationModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case ToggleBlockedMsg:
		// Simulate controller behavior
		if msg.Worktree != nil {
			msg.Worktree.IsBlocked = !msg.Worktree.IsBlocked
		} else {
			msg.Project.IsBlocked = !msg.Project.IsBlocked
		}
		// Force refresh display (simulating what controller does)
		m.nav.RefreshDisplay()
		return m, nil
	}

	// Pass through to navigation
	updatedNav, cmd := m.nav.Update(msg)
	m.nav = updatedNav.(*NavigationComponent)
	return m, cmd
}

func (m *xKeyIntegrationModel) View() string {
	return m.nav.View()
}
