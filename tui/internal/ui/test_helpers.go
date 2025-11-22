// test_helpers.go - Helper functions for testing
//
// ## Metadata
//
// TUI test helper functions.
//
// ### Purpose
//
// Provide common helper functions for testing terminal components.

package ui

// getTerminalDisplay gets the current display content from a terminal component
func getTerminalDisplay(tc *TerminalComponent) string {
	if tc.emulator != nil {
		return tc.emulator.GetDisplay()
	}
	return tc.viewport.View()
}

// getViewportContent gets the raw viewport content
func getViewportContent(tc *TerminalComponent) string {
	return tc.viewport.View()
}
