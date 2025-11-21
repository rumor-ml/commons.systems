// list_builder_project_processor.go - Project-level processing for list builder

package ui

import (
	"github.com/charmbracelet/bubbles/list"
	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// ListBuilderProjectProcessor handles project-level list building operations
type ListBuilderProjectProcessor struct {
	logger            log.Logger
	worktreeProcessor *ListBuilderWorktreeProcessor
	paneProcessor     *ListBuilderPaneProcessor
	formatter         *ListBuilderFormatter
}

// NewListBuilderProjectProcessor creates a new project processor
func NewListBuilderProjectProcessor(worktreeProcessor *ListBuilderWorktreeProcessor, paneProcessor *ListBuilderPaneProcessor, formatter *ListBuilderFormatter) *ListBuilderProjectProcessor {
	return &ListBuilderProjectProcessor{
		logger:            log.Get(),
		worktreeProcessor: worktreeProcessor,
		paneProcessor:     paneProcessor,
		formatter:         formatter,
	}
}

// AddProjectItems adds all items for a single project (project header, worktrees, panes)
func (pp *ListBuilderProjectProcessor) AddProjectItems(items *[]list.Item, project *model.Project, keyMgr *model.KeyBindingManager, tmuxPanes map[string]*terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) {
	if project == nil {
		return
	}

	pp.logger.Debug("Processing project", "name", project.Name, "path", project.Path)

	// Add project header
	projectKey := pp.getProjectKey(project, keyMgr)
	projectTitle := pp.formatter.FormatProjectTitle(project, projectKey)
	
	*items = append(*items, ListItem{
		title:      projectTitle,
		description: pp.formatter.FormatProjectDescription(project),
		Project:    project,
		IsWorktree: false,
		keyBinding: project.KeyBinding,
	})

	// Add worktrees
	pp.worktreeProcessor.AddWorktreeItems(items, project, keyMgr, tmuxPanes, claudeStatus)

	// Add project-level panes (not in worktrees)
	pp.paneProcessor.AddProjectPanes(items, project, tmuxPanes, claudeStatus)
}

// ProcessProjectsForItems handles validation and processing of all projects
func (pp *ListBuilderProjectProcessor) ProcessProjectsForItems(projects []*model.Project, keyMgr *model.KeyBindingManager, tmuxPanes map[string]*terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) []list.Item {
	var items []list.Item

	pp.logger.Debug("ProcessProjectsForItems called", "projectCount", len(projects), "hasPanes", tmuxPanes != nil)

	// Debug: Check for duplicate projects
	projectPaths := make(map[string]int)
	for i, p := range projects {
		if prevIndex, exists := projectPaths[p.Path]; exists {
			pp.logger.Error("DUPLICATE PROJECT IN ProcessProjectsForItems!",
				"name", p.Name,
				"path", p.Path,
				"firstIndex", prevIndex,
				"duplicateIndex", i)
		}
		projectPaths[p.Path] = i
		pp.logger.Debug("ProcessProjectsForItems project", "index", i, "name", p.Name, "path", p.Path)
	}

	// If no projects, show a placeholder
	if len(projects) == 0 {
		items = append(items, ListItem{
			title:      "No projects found",
			Project:    nil,
			IsWorktree: false,
			keyBinding: 0,
		})
		items = append(items, ListItem{
			title:       "Scanning for projects...",
			description: "Please wait while we discover your projects",
			Project:     nil,
			IsWorktree:  false,
			keyBinding:  0,
		})
		return items
	}

	// Build items for each project
	for _, project := range projects {
		// Skip worktree projects - they should only appear nested under their parent
		if project.IsWorktree {
			continue
		}
		
		pp.AddProjectItems(&items, project, keyMgr, tmuxPanes, claudeStatus)
	}

	return items
}

// getProjectKey gets the key binding for a project
func (pp *ListBuilderProjectProcessor) getProjectKey(project *model.Project, keyMgr *model.KeyBindingManager) rune {
	return project.KeyBinding
}