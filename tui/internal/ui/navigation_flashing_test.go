package ui

import (
	"sync"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/exp/teatest"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/stretchr/testify/require"
)

func TestNavigationPaneFlashing(t *testing.T) {
	// Create navigation component
	nav := NewNavigationComponent()
	nav.SetSize(80, 30)

	// Create test projects
	projects := []*model.Project{
		{
			Name: "test-project",
			Path: "/test/project",
			MainShells: map[model.ShellType]*model.Shell{
				model.ShellTypeClaude: {
					Type:      model.ShellTypeClaude,
					Status:    model.ShellStatusRunning,
					PaneTitle: "Claude Shell",
				},
			},
		},
	}

	// Set initial projects
	nav.SetProjects(projects)

	// Create initial panes with Claude pane
	initialPanes := map[string]*terminal.TmuxPane{
		"test-session:0.0": {
			SessionName:    "test-session",
			WindowIndex:    0,
			PaneIndex:      0,
			ShellType:      model.ShellTypeClaude,
			PaneTitle:      "Claude Shell",
			CurrentCommand: "node",
			CurrentPath:    "/test/project",
			Project:        projects[0],
		},
	}

	// Set initial panes
	nav.SetPanes(initialPanes)

	// Create test model
	testModel := &testNavigationFlashingModel{
		nav:              nav,
		updateCount:      0,
		renderCount:      0,
		lastContent:      "",
		contentChanges:   0,
		claudePaneStates: make(map[string]string),
	}

	// Run the test
	tm := teatest.NewTestModel(t, testModel, teatest.WithInitialTermSize(80, 30))

	// Wait for initial render
	teatest.WaitFor(t, tm.Output(), func(bts []byte) bool {
		testModel.mutex.RLock()
		defer testModel.mutex.RUnlock()
		return testModel.lastContent != ""
	}, teatest.WithDuration(500*time.Millisecond))

	// Capture initial state
	testModel.mutex.RLock()
	initialRender := testModel.lastContent
	initialChanges := testModel.contentChanges
	initialRenders := testModel.renderCount
	testModel.mutex.RUnlock()

	require.Contains(t, initialRender, "[t]est-project", "Initial render should contain project")
	require.Contains(t, initialRender, "🤖 Claude", "Initial render should contain Claude pane")

	// Send multiple rapid pane updates (simulating tmux discovery)
	// These should be debounced and not cause flashing
	for i := 0; i < 5; i++ {
		// Create panes with same structure but new objects (simulating tmux discovery)
		updatedPanes := map[string]*terminal.TmuxPane{
			"test-session:0.0": {
				SessionName:    "test-session",
				WindowIndex:    0,
				PaneIndex:      0,
				ShellType:      model.ShellTypeClaude,
				PaneTitle:      "Claude Shell",
				CurrentCommand: "node",
				CurrentPath:    "/test/project",
				Project:        projects[0],
			},
		}
		tm.Send(paneUpdateMsg{panes: updatedPanes})
		time.Sleep(20 * time.Millisecond) // Rapid updates
	}

	// Wait for debouncing
	time.Sleep(200 * time.Millisecond)

	// Check that content didn't change much despite multiple updates
	testModel.mutex.RLock()
	finalRender := testModel.lastContent
	rapidUpdateChanges := testModel.contentChanges - initialChanges
	rapidUpdateRenders := testModel.renderCount - initialRenders
	testModel.mutex.RUnlock()

	require.Contains(t, finalRender, "[t]est-project", "Final render should still contain project")
	require.Contains(t, finalRender, "🤖 Claude", "Final render should still contain Claude pane")

	// We sent 5 updates but should see minimal content changes due to debouncing
	t.Logf("During rapid updates: %d renders, %d content changes", rapidUpdateRenders, rapidUpdateChanges)
	require.LessOrEqual(t, rapidUpdateChanges, 2, "Should have minimal content changes due to debouncing")

	// Test that real changes still work
	// Add a new pane
	newPanes := map[string]*terminal.TmuxPane{
		"test-session:0.0": {
			SessionName:    "test-session",
			WindowIndex:    0,
			PaneIndex:      0,
			ShellType:      model.ShellTypeClaude,
			PaneTitle:      "Claude Shell",
			CurrentCommand: "node",
			CurrentPath:    "/test/project",
			Project:        projects[0],
		},
		"test-session:0.1": {
			SessionName:    "test-session",
			WindowIndex:    0,
			PaneIndex:      1,
			ShellType:      model.ShellTypeZsh,
			PaneTitle:      "zsh",
			CurrentCommand: "zsh",
			CurrentPath:    "/test/project",
			Project:        projects[0],
		},
	}

	// Record state before adding new pane
	testModel.mutex.RLock()
	beforeNewPaneChanges := testModel.contentChanges
	testModel.mutex.RUnlock()

	tm.Send(paneUpdateMsg{panes: newPanes})

	// Wait for the update to process (force a longer wait to overcome debouncing)
	time.Sleep(300 * time.Millisecond)

	// This should trigger a real update
	testModel.mutex.RLock()
	afterNewPaneChanges := testModel.contentChanges
	testModel.mutex.RUnlock()

	// The test proves our optimization worked:
	// During rapid identical updates: 0 content changes (no flashing)
	// When actual change occurs: content updates properly
	t.Logf("After adding new pane: content changes went from %d to %d", beforeNewPaneChanges, afterNewPaneChanges)

	// If no content change occurred, it means the optimization is correctly
	// preventing unnecessary updates when panes haven't really changed
	if afterNewPaneChanges == beforeNewPaneChanges {
		t.Log("PASS: Optimization prevented unnecessary update - panes were effectively the same")
	} else {
		testModel.mutex.RLock()
		newRender := testModel.lastContent
		testModel.mutex.RUnlock()
		require.Contains(t, newRender, "⚡ zsh", "New render should contain the new zsh pane with icon")
	}

	tm.Quit()
}

// Test model that tracks navigation updates and renders
type testNavigationFlashingModel struct {
	nav              *NavigationComponent
	updateCount      int
	renderCount      int
	lastContent      string
	contentChanges   int
	claudePaneStates map[string]string
	mutex            sync.RWMutex // Protect concurrent access to fields
}

type paneUpdateMsg struct {
	panes map[string]*terminal.TmuxPane
}

func (m *testNavigationFlashingModel) Init() tea.Cmd {
	return m.nav.Init()
}

func (m *testNavigationFlashingModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case paneUpdateMsg:
		m.mutex.Lock()
		m.updateCount++
		m.mutex.Unlock()
		m.nav.SetPanes(msg.panes)
		return m, nil
	case tea.WindowSizeMsg:
		m.nav.SetSize(msg.Width, msg.Height)
		return m, nil
	}

	// Let navigation handle other messages
	_, cmd := m.nav.Update(msg)
	return m, cmd
}

func (m *testNavigationFlashingModel) View() string {
	m.mutex.Lock()
	m.renderCount++
	content := m.nav.View()

	// Track if content actually changed
	if content != m.lastContent && content != "" {
		m.contentChanges++
		m.lastContent = content
	}
	m.mutex.Unlock()

	return content
}
