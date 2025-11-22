// list_builder_project_processor.go - Project-level processing for list builder

package ui

import (
	"path/filepath"

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
	pp.AddProjectItemsWithHierarchy(items, project, false, keyMgr, tmuxPanes, claudeStatus)
}

// AddProjectItemsWithHierarchy adds all items for a single project with hierarchy indication
func (pp *ListBuilderProjectProcessor) AddProjectItemsWithHierarchy(items *[]list.Item, project *model.Project, isChildModule bool, keyMgr *model.KeyBindingManager, tmuxPanes map[string]*terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) {
	if project == nil {
		return
	}

	// Add project header
	projectKey := pp.getProjectKey(project, keyMgr)
	projectTitle := pp.formatter.FormatProjectTitle(project, projectKey)

	// Add visual hierarchy indicator for child modules
	if isChildModule {
		projectTitle = "  └─ " + projectTitle
	}

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

	// Check for duplicate projects (error only)
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

	// Find the monorepo root (project that contains other projects as subdirectories)
	var monorepoRoot *model.Project
	for _, p := range projects {
		if p.Path != "" {
			childCount := 0
			for _, other := range projects {
				if other.Path != p.Path && len(other.Path) > len(p.Path) {
					// Check if 'other' is a subdirectory of 'p'
					if filepath.HasPrefix(other.Path, p.Path+string(filepath.Separator)) {
						childCount++
					}
				}
			}
			if childCount >= 2 {
				monorepoRoot = p
				// Removed: High-frequency DEBUG log (fires on every list build)
				break
			}
		}
	}

	// Build items for each project
	for _, project := range projects {
		// Skip worktree projects - they should only appear nested under their parent
		if project.IsWorktree {
			continue
		}

		// Check if this is a child module of the monorepo
		isChildModule := false
		if monorepoRoot != nil && project.Path != monorepoRoot.Path {
			if filepath.HasPrefix(project.Path, monorepoRoot.Path+string(filepath.Separator)) {
				isChildModule = true
			}
		}

		pp.AddProjectItemsWithHierarchy(&items, project, isChildModule, keyMgr, tmuxPanes, claudeStatus)
	}

	return items
}

// getProjectKey gets the key binding for a project
func (pp *ListBuilderProjectProcessor) getProjectKey(project *model.Project, keyMgr *model.KeyBindingManager) rune {
	return project.KeyBinding
}