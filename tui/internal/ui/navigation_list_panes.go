package ui

import (
	"github.com/charmbracelet/bubbles/list"
	"github.com/natb1/tui/internal/terminal"
	"github.com/rumor-ml/log/pkg/log"
)

// UpdatePanesOnly updates only the pane information without rebuilding the entire project list
func (n *NavigationListComponent) UpdatePanesOnly(tmuxPanes map[string]*terminal.TmuxPane) {
	logger := log.Get()
	logger.Debug("UpdatePanesOnly called", "paneCount", len(tmuxPanes))

	// Update Claude status manager with new panes via delegation
	if n.claudeStatus != nil && tmuxPanes != nil {
		n.claudeStatus.UpdateClaudePanes(tmuxPanes)
	}

	// Just trigger a refresh of the display with existing projects using delegation
	if n.projects != nil {
		items := n.projectManager.BuildListItems(tmuxPanes)
		
		// Convert []interface{} back to []list.Item for the list
		listItems := make([]list.Item, len(items))
		for i, item := range items {
			listItems[i] = item.(ListItem)
		}
		n.list.SetItems(listItems)
		// Removed: High-frequency DEBUG log (fires on every pane update)
	}
}
