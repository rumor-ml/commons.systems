package ui

import (
	"fmt"
	"testing"

	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
)

func TestClaudeHighlightingVisual(t *testing.T) {
	// Removed short mode skip per user feedback

	// Create test data
	keyMgr := model.NewKeyBindingManager()

	project := &model.Project{
		Name:       "assistant",
		Path:       "/Users/n8/intent/assistant",
		KeyBinding: 'a',
		Expanded:   true,
	}

	// Create Claude panes with different states
	panes := map[string]*terminal.TmuxPane{
		"icf-0:0.0": {
			SessionName:    "icf-0",
			WindowIndex:    0,
			PaneIndex:      0,
			ShellType:      model.ShellTypeClaude,
			PaneTitle:      "Idle Claude",
			CurrentCommand: "node",
			CurrentPath:    "/Users/n8/intent/assistant",
			Project:        project,
		},
		"icf-0:1.0": {
			SessionName:    "icf-0",
			WindowIndex:    1,
			PaneIndex:      0,
			ShellType:      model.ShellTypeClaude,
			PaneTitle:      "Active Claude - Wondering...",
			CurrentCommand: "node",
			CurrentPath:    "/Users/n8/intent/assistant",
			Project:        project,
		},
		"icf-0:2.0": {
			SessionName:    "icf-0",
			WindowIndex:    2,
			PaneIndex:      0,
			ShellType:      model.ShellTypeZsh,
			PaneTitle:      "Regular zsh",
			CurrentCommand: "zsh",
			CurrentPath:    "/Users/n8/intent/assistant",
			Project:        project,
		},
	}

	// Create Claude status manager
	claudeStatus := status.NewClaudeStatusManager()

	// For this test, we'll rely on the default behavior where Claude panes
	// are highlighted by default (idle) unless they show activity

	// Build list items
	items := BuildListItems([]*model.Project{project}, keyMgr, panes, claudeStatus)

	// Print visual output
	fmt.Println("\n=== Visual Test: Claude Pane Highlighting ===")
	fmt.Println("The following lines should show:")
	fmt.Println("1. Project header (normal)")
	fmt.Println("2. Claude pane in ORANGE (idle)")
	fmt.Println("3. Claude pane in normal color (active)")
	fmt.Println("4. Zsh pane in normal color")
	fmt.Println("\nActual output:")
	fmt.Println("─────────────────────────────────────────────")

	for i, item := range items {
		ListItem := item.(ListItem)
		fmt.Printf("%d: %s\n", i+1, ListItem.title)
	}

	fmt.Println("─────────────────────────────────────────────")
	fmt.Println("\nIf Claude pane #2 appears in orange, the highlighting is working!")
}
