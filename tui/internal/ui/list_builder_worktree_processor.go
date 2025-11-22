// list_builder_worktree_processor.go - Worktree processing for list builder

package ui

import (
	"github.com/charmbracelet/bubbles/list"
	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// ListBuilderWorktreeProcessor handles worktree-level list building operations
type ListBuilderWorktreeProcessor struct {
	logger        log.Logger
	paneProcessor *ListBuilderPaneProcessor
	formatter     *ListBuilderFormatter
}

// NewListBuilderWorktreeProcessor creates a new worktree processor
func NewListBuilderWorktreeProcessor(paneProcessor *ListBuilderPaneProcessor, formatter *ListBuilderFormatter) *ListBuilderWorktreeProcessor {
	return &ListBuilderWorktreeProcessor{
		logger:        log.Get(),
		paneProcessor: paneProcessor,
		formatter:     formatter,
	}
}

// AddWorktreeItems adds all worktree items for a project
func (wp *ListBuilderWorktreeProcessor) AddWorktreeItems(items *[]list.Item, project *model.Project, keyMgr *model.KeyBindingManager, tmuxPanes map[string]*terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) {
	for _, worktree := range project.Worktrees {
		worktreeTitle := wp.formatter.FormatWorktreeTitle(worktree)
		
		*items = append(*items, ListItem{
			title:      worktreeTitle,
			description: wp.formatter.FormatWorktreeDescription(worktree),
			Project:    project,
			Worktree:   worktree,
			IsWorktree: true,
			keyBinding: worktree.KeyBinding,
		})

		// Add panes for this worktree
		wp.paneProcessor.AddWorktreePanes(items, project, worktree, tmuxPanes, claudeStatus)
	}
}