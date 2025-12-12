package ui

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/commons-systems/tmux-tui/internal/tmux"
	"github.com/commons-systems/tmux-tui/internal/watcher"
)

const (
	Branch   = "├── "
	LastItem = "└── "
	Pipe     = "│   "
	Space    = "    "

	// Alert type icons
	StopIcon        = "●" // U+25CF BLACK CIRCLE
	PermissionIcon  = "⚠" // U+26A0 WARNING SIGN
	IdleIcon        = "⏸" // U+23F8 DOUBLE VERTICAL BAR
	ElicitationIcon = "❓" // U+2753 BLACK QUESTION MARK ORNAMENT
)

var bellStyle = lipgloss.NewStyle().
	Foreground(lipgloss.Color("0")).
	Background(lipgloss.Color("1")).
	Bold(true)

var activeStyle = lipgloss.NewStyle().
	Background(lipgloss.Color("240"))

var blockedStyle = lipgloss.NewStyle().
	Foreground(lipgloss.Color("245")) // Muted gray text

var blockedActiveStyle = lipgloss.NewStyle().
	Foreground(lipgloss.Color("245")). // Muted gray text
	Background(lipgloss.Color("240"))  // Active background highlight

var headerStyle = lipgloss.NewStyle().
	Foreground(lipgloss.Color("244")).
	Bold(true)

var repoStyle = lipgloss.NewStyle().
	Foreground(lipgloss.Color("14")).
	Bold(true)

// iconForAlertType returns the appropriate icon for a given alert type
func iconForAlertType(alertType string) string {
	switch alertType {
	case watcher.EventTypePermission:
		return PermissionIcon
	case watcher.EventTypeIdle:
		return IdleIcon
	case watcher.EventTypeElicitation:
		return ElicitationIcon
	case watcher.EventTypeStop:
		return StopIcon
	default:
		// Default to stop icon for unknown types
		return StopIcon
	}
}

// TreeRenderer renders a tmux.RepoTree as a hierarchical tree
type TreeRenderer struct {
	width        int
	height       int
	headerHeight int
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
	// Header takes 2 lines: the actual header + separator newline
	r.headerHeight = 2
}

// RenderHeader returns a formatted date/time header
func (r *TreeRenderer) RenderHeader() string {
	now := time.Now()
	timeStr := now.Format("Mon Jan 2 15:04:05")
	return headerStyle.Render(timeStr)
}

// Render converts a RepoTree into a formatted tree string
func (r *TreeRenderer) Render(tree tmux.RepoTree, claudeAlerts map[string]string, blockedBranches map[string]string) string {
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
		lines = append(lines, r.renderRepo(repo, tree[repo], isLastRepo, claudeAlerts, blockedBranches)...)
		// Add blank line separator between repos for visual clarity
		if !isLastRepo {
			lines = append(lines, "")
		}
	}

	// Limit and pad output to fill height (accounting for header)
	targetLines := r.height - r.headerHeight

	// Truncate if content exceeds available height
	if len(lines) > targetLines {
		lines = lines[:targetLines]
	}

	// Pad if content is less than available height
	for len(lines) < targetLines {
		lines = append(lines, "")
	}

	return strings.Join(lines, "\n")
}

func (r *TreeRenderer) renderRepo(repoName string, branches map[string][]tmux.Pane, isLastRepo bool, claudeAlerts map[string]string, blockedBranches map[string]string) []string {
	var lines []string
	lines = append(lines, repoStyle.Render(repoName))

	// Calculate blocked counts: how many branches are blocked BY each branch
	blockedCounts := make(map[string]int)
	for blockedBranch, blockerBranch := range blockedBranches {
		// Only count if both branches exist in this repo
		if _, blocked := branches[blockedBranch]; blocked {
			if _, blocker := branches[blockerBranch]; blocker {
				blockedCounts[blockerBranch]++
			}
		}
	}

	// Sort branches: by blocked count (descending), then alphabetically
	branchNames := make([]string, 0, len(branches))
	for branch := range branches {
		branchNames = append(branchNames, branch)
	}
	sort.Slice(branchNames, func(i, j int) bool {
		countI := blockedCounts[branchNames[i]]
		countJ := blockedCounts[branchNames[j]]
		if countI != countJ {
			return countI > countJ // Descending by blocked count
		}
		return branchNames[i] < branchNames[j] // Ascending alphabetically
	})

	for i, branch := range branchNames {
		isLastBranch := i == len(branchNames)-1
		branchPrefix := Branch
		childPrefix := Pipe
		if isLastBranch {
			branchPrefix = LastItem
			childPrefix = Space
		}

		// Check if this branch is blocked
		_, isBranchBlocked := blockedBranches[branch]

		// Add branch name (muted if blocked)
		branchLine := branchPrefix + branch
		if isBranchBlocked {
			branchLine = blockedStyle.Render(branchLine)
		}
		lines = append(lines, branchLine)

		// Add blocked count on separate line if > 0
		if count := blockedCounts[branch]; count > 0 {
			countText := fmt.Sprintf("%d branches blocked", count)
			lines = append(lines, childPrefix+countText)
		}

		// Add panes
		lines = append(lines, r.renderPanes(branches[branch], childPrefix, claudeAlerts, blockedBranches, branch)...)
	}

	return lines
}

func (r *TreeRenderer) renderPanes(panes []tmux.Pane, prefix string, claudeAlerts map[string]string, blockedBranches map[string]string, currentBranch string) []string {
	var lines []string

	// Sort panes by window index for consistent output
	sort.Slice(panes, func(i, j int) bool {
		return panes[i].WindowIndex < panes[j].WindowIndex
	})

	// Check if the entire branch is blocked
	_, isBranchBlocked := blockedBranches[currentBranch]
	if isBranchBlocked {
		debug.Log("TUI_RENDER_BRANCH_BLOCKED branch=%s blockedBy=%s paneCount=%d",
			currentBranch, blockedBranches[currentBranch], len(panes))
	}

	for i, pane := range panes {
		isLastPane := i == len(panes)-1
		panePrefix := Branch
		if isLastPane {
			panePrefix = LastItem
		}

		// Build window number portion separately
		windowNumber := fmt.Sprintf("%d:", pane.WindowIndex)

		// Determine if bell should be shown and get alert type
		// Blocked branches should NOT show bell/idle highlighting
		var showBell bool
		var alertType string
		if !isBranchBlocked {
			if pane.IsClaudePane {
				// For Claude panes, use persistent alert state
				alertType, showBell = claudeAlerts[pane.ID]
				// Log render state for Claude panes
				debug.Log("TUI_RENDER_PANE id=%s isClaudePane=%v alertType=%s showBell=%v", pane.ID, pane.IsClaudePane, alertType, showBell)
			} else {
				// For non-Claude panes, use default tmux bell behavior
				showBell = pane.WindowBell
				alertType = watcher.EventTypeStop // Default for non-Claude panes
			}
		}

		// Apply bell style with icon ONLY to window number if bell is active
		if showBell {
			icon := iconForAlertType(alertType)
			windowNumber = bellStyle.Render(icon + windowNumber)
		}

		// Build command + title portion
		commandTitle := pane.Command
		if pane.Title != "" {
			commandTitle += " " + pane.Title
		}

		// Assemble the line from parts
		line := prefix + panePrefix + windowNumber + commandTitle

		// Apply appropriate styling
		if isBranchBlocked {
			if pane.WindowActive {
				// Blocked + Active: show background highlight with muted text
				line = blockedActiveStyle.Width(r.width).Render(line)
			} else {
				// Blocked + Idle: only muted text, no highlight
				line = blockedStyle.Render(line)
			}
		} else if pane.WindowActive {
			// Active panes get active style with full width
			line = activeStyle.Width(r.width).Render(line)
		}

		lines = append(lines, line)
	}

	return lines
}
