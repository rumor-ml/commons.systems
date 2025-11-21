// list_builder.go - Navigation list item building logic

package ui

import (
	"github.com/charmbracelet/bubbles/list"
	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// ListBuilder handles the construction of navigation list items using delegation pattern
type ListBuilder struct {
	logger           log.Logger
	
	// Delegated components
	projectProcessor *ListBuilderProjectProcessor
	paneProcessor    *ListBuilderPaneProcessor
	formatter        *ListBuilderFormatter
}

// NewListBuilder creates a new list builder with delegation pattern
func NewListBuilder() *ListBuilder {
	// Create formatter first
	formatter := NewListBuilderFormatter()
	
	// Create processors with dependencies
	paneProcessor := NewListBuilderPaneProcessor(formatter)
	worktreeProcessor := NewListBuilderWorktreeProcessor(paneProcessor, formatter)
	projectProcessor := NewListBuilderProjectProcessor(worktreeProcessor, paneProcessor, formatter)
	
	return &ListBuilder{
		logger:           log.Get(),
		projectProcessor: projectProcessor,
		paneProcessor:    paneProcessor,
		formatter:        formatter,
	}
}

// BuildListItems creates list items from projects and tmux panes using delegation
func (lb *ListBuilder) BuildListItems(projects []*model.Project, keyMgr *model.KeyBindingManager, tmuxPanes map[string]*terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) []list.Item {
	// Delegate main processing to project processor
	items := lb.projectProcessor.ProcessProjectsForItems(projects, keyMgr, tmuxPanes, claudeStatus)

	// Add orphaned panes section ONLY if we have projects
	// When no projects exist, orphaned panes should not be shown
	if len(projects) > 0 {
		lb.paneProcessor.AddOrphanedPanes(&items, tmuxPanes, claudeStatus)
	}

	lb.logger.Debug("BuildListItems complete", "totalItems", len(items))
	return items
}
