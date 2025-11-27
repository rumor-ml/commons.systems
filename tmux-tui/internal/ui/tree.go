package ui

import (
	"fmt"
	"sort"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/commons-systems/tmux-tui/internal/tmux"
)

const (
	Branch   = "├── "
	LastItem = "└── "
	Pipe     = "│   "
	Space    = "    "
)

var bellStyle = lipgloss.NewStyle().
	Foreground(lipgloss.Color("0")).
	Background(lipgloss.Color("1")).
	Bold(true)

var activeStyle = lipgloss.NewStyle().
	Background(lipgloss.Color("240"))

// TreeRenderer renders a tmux.RepoTree as a hierarchical tree
type TreeRenderer struct {
	width  int
	height int
}

// NewTreeRenderer creates a new TreeRenderer with the given width
func NewTreeRenderer(width int) *TreeRenderer {
	return &TreeRenderer{width: width, height: 24}
}

// SetWidth updates the renderer width
func (r *TreeRenderer) SetWidth(width int) {
	r.width = width
}

// SetHeight updates the renderer height
func (r *TreeRenderer) SetHeight(height int) {
	r.height = height
}

// Render converts a RepoTree into a formatted tree string
func (r *TreeRenderer) Render(tree tmux.RepoTree, claudeAlerts map[string]bool) string {
	if tree == nil || len(tree) == 0 {
		return "No panes found in current tmux session"
	}

	var lines []string

	// Sort repos for consistent output
	repos := make([]string, 0, len(tree))
	for repo := range tree {
		repos = append(repos, repo)
	}
	sort.Strings(repos)

	for i, repo := range repos {
		isLastRepo := i == len(repos)-1
		lines = append(lines, r.renderRepo(repo, tree[repo], isLastRepo, claudeAlerts)...)
	}

	// Pad output to fill height
	for len(lines) < r.height {
		lines = append(lines, "")
	}

	return strings.Join(lines, "\n")
}

func (r *TreeRenderer) renderRepo(repoName string, branches map[string][]tmux.Pane, isLastRepo bool, claudeAlerts map[string]bool) []string {
	var lines []string
	lines = append(lines, repoName)

	// Sort branches for consistent output
	branchNames := make([]string, 0, len(branches))
	for branch := range branches {
		branchNames = append(branchNames, branch)
	}
	sort.Strings(branchNames)

	for i, branch := range branchNames {
		isLastBranch := i == len(branchNames)-1
		branchPrefix := Branch
		childPrefix := Pipe
		if isLastBranch {
			branchPrefix = LastItem
			childPrefix = Space
		}

		lines = append(lines, branchPrefix+branch)
		lines = append(lines, r.renderPanes(branches[branch], childPrefix, claudeAlerts)...)
	}

	return lines
}

func (r *TreeRenderer) renderPanes(panes []tmux.Pane, prefix string, claudeAlerts map[string]bool) []string {
	var lines []string

	// Sort panes by window index for consistent output
	sort.Slice(panes, func(i, j int) bool {
		return panes[i].WindowIndex < panes[j].WindowIndex
	})

	for i, pane := range panes {
		isLastPane := i == len(panes)-1
		panePrefix := Branch
		if isLastPane {
			panePrefix = LastItem
		}

		// Build window number portion separately
		windowNumber := fmt.Sprintf("%d:", pane.WindowIndex)

		// Determine if bell should be shown
		showBell := false
		if pane.IsClaudePane {
			// For Claude panes, use persistent alert state
			showBell = claudeAlerts[pane.ID]
		} else {
			// For non-Claude panes, use default tmux bell behavior
			showBell = pane.WindowBell
		}

		// Apply bell style ONLY to window number if bell is active
		if showBell {
			windowNumber = bellStyle.Render(windowNumber)
		}

		// Build command + title portion
		commandTitle := pane.Command
		if pane.Title != "" {
			commandTitle += " " + pane.Title
		}

		// Assemble the line from parts
		line := prefix + panePrefix + windowNumber + commandTitle

		// For active panes: apply activeStyle with full width
		if pane.WindowActive {
			line = activeStyle.Width(r.width).Render(line)
		}

		lines = append(lines, line)
	}

	return lines
}
