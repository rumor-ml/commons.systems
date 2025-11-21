// list_builder_pane_processor.go - Pane processing for list builder

package ui

import (
	"github.com/charmbracelet/bubbles/list"
	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// ListBuilderPaneProcessor handles pane-level list building operations
type ListBuilderPaneProcessor struct {
	logger    log.Logger
	formatter *ListBuilderFormatter
}

// NewListBuilderPaneProcessor creates a new pane processor
func NewListBuilderPaneProcessor(formatter *ListBuilderFormatter) *ListBuilderPaneProcessor {
	return &ListBuilderPaneProcessor{
		logger:    log.Get(),
		formatter: formatter,
	}
}

// AddProjectPanes adds panes that belong to the project root (not in worktrees)
func (pap *ListBuilderPaneProcessor) AddProjectPanes(items *[]list.Item, project *model.Project, tmuxPanes map[string]*terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) {
	if tmuxPanes == nil {
		return
	}

	for _, pane := range tmuxPanes {
		if pane.Project == project && pane.Worktree == nil {
			pap.AddPaneItem(items, project, nil, pane, claudeStatus)
		}
	}
}

// AddWorktreePanes adds panes that belong to a specific worktree
func (pap *ListBuilderPaneProcessor) AddWorktreePanes(items *[]list.Item, project *model.Project, worktree *model.Worktree, tmuxPanes map[string]*terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) {
	if tmuxPanes == nil {
		return
	}

	for _, pane := range tmuxPanes {
		if pane.Project == project && pane.Worktree == worktree {
			pap.AddPaneItem(items, project, worktree, pane, claudeStatus)
		}
	}
}

// AddPaneItem adds a single pane item to the list
func (pap *ListBuilderPaneProcessor) AddPaneItem(items *[]list.Item, project *model.Project, worktree *model.Worktree, pane *terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) {
	// Skip boring panes (but never skip Claude or nvim panes)
	if pane.ShellType != model.ShellTypeClaude && pane.ShellType != model.ShellTypeNvim {
		displayInfo := pap.formatter.GetPaneDisplayTitle(pane)
		// Only skip if the final display info is boring
		// This allows meaningful pane titles to override boring commands
		if isBoringPaneTitle(displayInfo) {
			projectName := "unknown"
			if project != nil {
				projectName = project.Name
			}
			pap.logger.Debug("Skipping boring pane",
				"project", projectName,
				"pane", pane.GetTmuxTarget(),
				"shellType", pane.ShellType,
				"paneTitle", pane.PaneTitle,
				"currentCommand", pane.CurrentCommand,
				"displayInfo", displayInfo)
			return
		}
	}

	title := pap.formatter.FormatPaneTitle(pane, claudeStatus)
	description := pap.formatter.FormatPaneDescription(pane)

	*items = append(*items, ListItem{
		title:       title,
		description: description,
		Project:     project,
		Worktree:    worktree,
		paneTarget:  pane.GetTmuxTarget(),
		IsWorktree:  false,
		keyBinding:  0,
	})
}

// AddOrphanedPanes adds orphaned panes (those without associated projects) in a dedicated section
func (pap *ListBuilderPaneProcessor) AddOrphanedPanes(items *[]list.Item, tmuxPanes map[string]*terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) {
	if tmuxPanes == nil {
		return
	}

	// First, identify orphaned panes
	var orphanedPanes []*terminal.TmuxPane
	for _, pane := range tmuxPanes {
		if pane.Project == nil {
			orphanedPanes = append(orphanedPanes, pane)
		}
	}

	// If no orphaned panes, don't add the section
	if len(orphanedPanes) == 0 {
		return
	}

	pap.logger.Debug("Found orphaned panes", "count", len(orphanedPanes))

	// Add section header for orphaned shells
	*items = append(*items, ListItem{
		title:       "Orphaned Shells",
		description: "Shells without associated projects",
		Project:     nil,
		IsWorktree:  false,
		keyBinding:  0,
	})

	// Add each orphaned pane
	for _, pane := range orphanedPanes {
		pap.AddPaneItem(items, nil, nil, pane, claudeStatus)
	}
}