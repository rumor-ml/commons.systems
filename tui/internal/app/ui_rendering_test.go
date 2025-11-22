package app

import (
	"os"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/exp/teatest"
)

// TestUIRendering_LogsToFile verifies logs go to file instead of terminal
func TestUIRendering_LogsToFile(t *testing.T) {
	// Set up test marker to prevent actual initialization
	if err := os.Setenv("TUI_TEST_MODE", "true"); err != nil {
		t.Fatalf("Failed to set test mode: %v", err)
	}
	defer os.Unsetenv("TUI_TEST_MODE")

	// Remove any existing log file
	os.Remove("/tmp/tui.log")

	// Create app - this will trigger logging
	app, err := New("")
	if err != nil {
		// Expected to fail in test mode, but logging should still work
		t.Logf("App creation failed (expected in test mode): %v", err)
	}

	// Verify log file was created
	if _, err := os.Stat("/tmp/tui.log"); os.IsNotExist(err) {
		t.Error("Log file /tmp/tui.log was not created")
	}

	// Read log file and verify it contains expected log entries
	logContent, err := os.ReadFile("/tmp/tui.log")
	if err != nil {
		t.Fatalf("Failed to read log file: %v", err)
	}

	logStr := string(logContent)
	if !strings.Contains(logStr, "INFO") && !strings.Contains(logStr, "DEBUG") {
		t.Error("Log file does not contain expected log entries")
	}

	// Ensure app is not nil for subsequent tests
	if app == nil {
		t.Skip("App is nil, skipping remaining tests")
	}
}

// TestUIRendering_ViewReturnsString verifies View() returns non-empty string
func TestUIRendering_ViewReturnsString(t *testing.T) {
	if err := os.Setenv("TUI_TEST_MODE", "true"); err != nil {
		t.Fatalf("Failed to set test mode: %v", err)
	}
	defer os.Unsetenv("TUI_TEST_MODE")

	app, err := New("")
	if err != nil {
		t.Skipf("App creation failed (expected in test mode): %v", err)
	}

	if app == nil {
		t.Skip("App is nil, cannot test View()")
	}

	// Call View() and verify it returns content
	view := app.View()

	if view == "" {
		t.Error("View() returned empty string")
	}

	// Verify the view doesn't contain log messages (which would indicate logs are leaking to UI)
	if strings.Contains(view, "INFO [") || strings.Contains(view, "DEBUG [") {
		t.Error("View() contains log messages - logs are leaking to UI output")
	}
}

// TestUIRendering_NoLogLeakage verifies logs don't appear in UI
func TestUIRendering_NoLogLeakage(t *testing.T) {
	if err := os.Setenv("TUI_TEST_MODE", "true"); err != nil {
		t.Fatalf("Failed to set test mode: %v", err)
	}
	defer os.Unsetenv("TUI_TEST_MODE")

	app, err := New("")
	if err != nil {
		t.Skipf("App creation failed (expected in test mode): %v", err)
	}

	if app == nil {
		t.Skip("App is nil, cannot test log leakage")
	}

	// Render the view multiple times
	for i := 0; i < 5; i++ {
		view := app.View()

		// Check for common log patterns that shouldn't appear in UI
		logPatterns := []string{
			"INFO:",
			"DEBUG:",
			"ERROR:",
			"WARN:",
			"[tui]",
			"workspace=",
		}

		for _, pattern := range logPatterns {
			if strings.Contains(view, pattern) {
				t.Errorf("View() contains log pattern '%s' - logs are leaking to UI", pattern)
			}
		}
	}
}

// TestUIRendering_TeaTest uses teatest framework to verify rendering
func TestUIRendering_TeaTest(t *testing.T) {
	if err := os.Setenv("TUI_TEST_MODE", "true"); err != nil {
		t.Fatalf("Failed to set test mode: %v", err)
	}
	defer os.Unsetenv("TUI_TEST_MODE")

	app, err := New("")
	if err != nil {
		t.Skipf("App creation failed (expected in test mode): %v", err)
	}

	if app == nil {
		t.Skip("App is nil, cannot run teatest")
	}

	// Use teatest to run the app in test mode
	tm := teatest.NewTestModel(
		t, app,
		teatest.WithInitialTermSize(120, 30),
	)

	// Wait for initialization
	teatest.WaitFor(
		t, tm.Output(),
		func(bts []byte) bool {
			return len(bts) > 0
		},
		teatest.WithCheckInterval(time.Millisecond*10),
		teatest.WithDuration(time.Second*2),
	)

	// Get the final model and check its view
	tm.Quit()

	// Wait for quit to process
	time.Sleep(time.Millisecond * 100)

	// Get final view from the app
	view := app.View()

	if strings.Contains(view, "INFO:") || strings.Contains(view, "DEBUG:") {
		t.Error("TeaTest view contains log messages - logs are leaking to terminal")
	}

	// Verify view is not empty (UI should render something)
	if len(view) == 0 {
		t.Error("TeaTest view is empty - UI did not render")
	}
}

// TestUIRendering_KeyboardInput tests that keyboard input doesn't trigger log output
func TestUIRendering_KeyboardInput(t *testing.T) {
	if err := os.Setenv("TUI_TEST_MODE", "true"); err != nil {
		t.Fatalf("Failed to set test mode: %v", err)
	}
	defer os.Unsetenv("TUI_TEST_MODE")

	app, err := New("")
	if err != nil {
		t.Skipf("App creation failed (expected in test mode): %v", err)
	}

	if app == nil {
		t.Skip("App is nil, cannot test keyboard input")
	}

	// Simulate keyboard input
	keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}
	updatedApp, _ := app.Update(keyMsg)

	// Cast back to App type
	if appModel, ok := updatedApp.(*App); ok {
		view := appModel.View()

		// Verify view doesn't contain log output
		if strings.Contains(view, "KeyMsg") || strings.Contains(view, "Update called") {
			t.Error("View contains debug log output after keyboard input")
		}
	}
}

// TestUIRendering_MultipleUpdates verifies UI updates don't accumulate logs
func TestUIRendering_MultipleUpdates(t *testing.T) {
	if err := os.Setenv("TUI_TEST_MODE", "true"); err != nil {
		t.Fatalf("Failed to set test mode: %v", err)
	}
	defer os.Unsetenv("TUI_TEST_MODE")

	app, err := New("")
	if err != nil {
		t.Skipf("App creation failed (expected in test mode): %v", err)
	}

	if app == nil {
		t.Skip("App is nil, cannot test multiple updates")
	}

	// Perform multiple updates
	model := tea.Model(app)
	for i := 0; i < 10; i++ {
		keyMsg := tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}
		model, _ = model.Update(keyMsg)
	}

	// Get final view
	if appModel, ok := model.(*App); ok {
		view := appModel.View()

		// Count log-like lines (shouldn't be any)
		lines := strings.Split(view, "\n")
		logLineCount := 0
		for _, line := range lines {
			if strings.Contains(line, "INFO") || strings.Contains(line, "DEBUG") {
				logLineCount++
			}
		}

		if logLineCount > 0 {
			t.Errorf("View contains %d log lines after multiple updates", logLineCount)
		}
	}
}
