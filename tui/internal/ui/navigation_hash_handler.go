// navigation_hash_handler.go - Hash utilities for navigation change detection

package ui

import (
	"fmt"
	"hash/fnv"

	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// NavigationHashHandler handles hashing operations for change detection
type NavigationHashHandler struct {
	logger log.Logger
}

// NewNavigationHashHandler creates a new hash handler
func NewNavigationHashHandler() *NavigationHashHandler {
	return &NavigationHashHandler{
		logger: log.Get(),
	}
}

// HashProjects creates a hash of project data for change detection
func (hh *NavigationHashHandler) HashProjects(projects []*model.Project) uint64 {
	h := fnv.New64a()

	for _, project := range projects {
		if project != nil {
			h.Write([]byte(project.Name))
			h.Write([]byte(project.Path))
			h.Write([]byte(fmt.Sprintf("%d", len(project.Worktrees))))

			// Include worktree info in hash
			for _, wt := range project.Worktrees {
				if wt != nil {
					h.Write([]byte(wt.ID))
					h.Write([]byte(wt.Path))
				}
			}
		}
	}

	return h.Sum64()
}

// HashPanes creates a hash of pane data for change detection
func (hh *NavigationHashHandler) HashPanes(panes map[string]*terminal.TmuxPane) uint64 {
	h := fnv.New64a()

	// Sort keys for consistent hashing
	for target, pane := range panes {
		if pane != nil {
			h.Write([]byte(target))
			h.Write([]byte(pane.PaneTitle))
			h.Write([]byte(pane.CurrentCommand))
			h.Write([]byte(pane.CurrentPath))
			h.Write([]byte(fmt.Sprintf("%v", pane.ShellType)))
			h.Write([]byte(fmt.Sprintf("%v", pane.Active)))
		}
	}

	return h.Sum64()
}