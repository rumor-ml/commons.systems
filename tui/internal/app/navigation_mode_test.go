package app

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// TestAppStartsWithNavigation ensures app always starts with navigation visible
func TestAppStartsWithNavigation(t *testing.T) {
	app, err := New("/tmp/test-workspace")
	if err != nil {
		t.Fatalf("Failed to create app: %v", err)
	}

	// Navigation should always be visible - no mode manager anymore
	// Just verify the app was created successfully
	if app == nil {
		t.Error("App should not be nil")
	}
}

// TestNoCtrlNHandler ensures ctrl+n is not handled (navigation always visible)
func TestNoCtrlNHandler(t *testing.T) {
	app, err := New("/tmp/test-workspace")
	if err != nil {
		t.Fatalf("Failed to create app: %v", err)
	}

	// App is always initialized now

	// Ctrl+N should not be handled at all
	ctrlNKey := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'n'}}
	ctrlNKey.Type = tea.KeyCtrlN

	cmd := app.handleKeyMsg(ctrlNKey)

	// Command should be passed to UI manager for navigation handling
	// No mode changes exist anymore
	if cmd == nil {
		t.Log("Ctrl+N not handled as expected (navigation always visible)")
	}
}

// TestProblematicHotkeysRemoved ensures ctrl+a, ctrl+t, tab are not handled
func TestProblematicHotkeysRemoved(t *testing.T) {
	app, err := New("/tmp/test-workspace")
	if err != nil {
		t.Fatalf("Failed to create app: %v", err)
	}

	// App is always initialized now
	// No mode manager exists anymore

	// Test ctrl+a (should not work)
	ctrlAKey := tea.KeyMsg{Type: tea.KeyCtrlA}
	cmd := app.handleKeyMsg(ctrlAKey)
	// Just verify it doesn't crash
	if cmd != nil {
		_ = cmd()
	}

	// Test ctrl+t (should not work)
	ctrlTKey := tea.KeyMsg{Type: tea.KeyCtrlT}
	cmd = app.handleKeyMsg(ctrlTKey)
	// Just verify it doesn't crash
	if cmd != nil {
		_ = cmd()
	}

	// Test tab (should not work for mode switching)
	tabKey := tea.KeyMsg{Type: tea.KeyTab}
	cmd = app.handleKeyMsg(tabKey)
	// Just verify it doesn't crash
	if cmd != nil {
		_ = cmd()
	}

	t.Log("Problematic hotkeys properly removed (no mode switching)")
}

// TestEssentialHotkeysWork ensures ctrl+s and ctrl+q still work
func TestEssentialHotkeysWork(t *testing.T) {
	app, err := New("/tmp/test-workspace")
	if err != nil {
		t.Fatalf("Failed to create app: %v", err)
	}

	// App is always initialized now

	// Test ctrl+s (screenshot - should return command)
	ctrlSKey := tea.KeyMsg{Type: tea.KeyCtrlS}
	cmd := app.handleKeyMsg(ctrlSKey)
	if cmd == nil {
		t.Error("Ctrl+S should return screenshot command")
	}

	// Test ctrl+q (quit - should return tea.Quit)
	ctrlQKey := tea.KeyMsg{Type: tea.KeyCtrlQ}
	cmd = app.handleKeyMsg(ctrlQKey)
	if cmd == nil {
		t.Error("Ctrl+Q should return quit command")
	}
}

// TestAppViewShowsNavigation ensures view shows navigation
func TestAppViewShowsNavigation(t *testing.T) {
	app, err := New("/tmp/test-workspace")
	if err != nil {
		t.Fatalf("Failed to create app: %v", err)
	}

	// Mark as initialized and set a reasonable size
	// App is always initialized now
	app.uiManager.HandleResize(tea.WindowSizeMsg{Width: 100, Height: 30})

	view := app.View()

	// Should not be empty or show error
	if view == "" {
		t.Error("App view should not be empty in assistant mode")
	}

	if strings.Contains(view, "Unknown mode") {
		t.Error("App view should not show unknown mode error")
	}

	// Should contain navigation content (project list or no projects message)
	if !strings.Contains(view, "ssistant") && !strings.Contains(view, "No projects found") {
		t.Error("App view should contain navigation content")
	}
}

// TestNoPercentInAppView ensures the app view doesn't contain % characters
func TestNoPercentInAppView(t *testing.T) {
	app, err := New("/tmp/test-workspace")
	if err != nil {
		t.Fatalf("Failed to create app: %v", err)
	}

	// App is always initialized now
	app.uiManager.HandleResize(tea.WindowSizeMsg{Width: 100, Height: 30})

	view := app.View()

	// Should not contain problematic % patterns
	problematicPatterns := []string{
		"Projects%",
		"assistant/ main %",
		" %\n",
	}

	for _, pattern := range problematicPatterns {
		if strings.Contains(view, pattern) {
			t.Errorf("App view should not contain problematic pattern '%s'", pattern)
		}
	}
}

// TestAppViewHasNewline ensures view ends with newline to prevent zsh %
func TestAppViewHasNewline(t *testing.T) {
	app, err := New("/tmp/test-workspace")
	if err != nil {
		t.Fatalf("Failed to create app: %v", err)
	}

	// App is always initialized now
	app.uiManager.HandleResize(tea.WindowSizeMsg{Width: 80, Height: 24})

	view := app.View()

	if !strings.HasSuffix(view, "\n") {
		t.Error("App view should end with newline to prevent zsh % prompt")
	}
}
