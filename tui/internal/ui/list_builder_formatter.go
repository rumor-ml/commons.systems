// list_builder_formatter.go - Formatting logic for list builder

package ui

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// ListBuilderFormatter handles all formatting operations for list items
type ListBuilderFormatter struct {
	logger log.Logger
}

// NewListBuilderFormatter creates a new formatter
func NewListBuilderFormatter() *ListBuilderFormatter {
	return &ListBuilderFormatter{
		logger: log.Get(),
	}
}

// Project formatting methods

func (lbf *ListBuilderFormatter) FormatProjectTitle(project *model.Project, key rune) string {
	// For compatibility with existing tests, don't include icon in project titles
	nameWithHotkey := addHotkeyIndicator(project.Name, key)

	// Add current branch indicator if available
	if project.CurrentBranch != "" {
		nameWithHotkey += fmt.Sprintf(" (%s)", project.CurrentBranch)
	}

	// Add status indicator and muted color based on project status
	// Priority: blocked > testing
	if project.Status == model.ProjectStatusBlocked {
		blockedIndicator := " 🚫" // Blocked icon
		title := nameWithHotkey + blockedIndicator

		// Apply muted color (dark gray)
		return "\x1b[38;5;239m" + title + "\x1b[0m"
	}

	if project.Status == model.ProjectStatusTesting {
		testingIndicator := " 🧪" // Testing icon (test tube)
		title := nameWithHotkey + testingIndicator

		// Apply muted color (dark gray)
		return "\x1b[38;5;239m" + title + "\x1b[0m"
	}

	return nameWithHotkey
}

func (lbf *ListBuilderFormatter) FormatProjectDescription(project *model.Project) string {
	desc := filepath.Base(project.Path)
	
	// Add URL if available
	if url := lbf.GetProjectURL(project); url != "" {
		desc += fmt.Sprintf(" • %s", url)
	}
	
	return desc
}

// Worktree formatting methods

func (lbf *ListBuilderFormatter) FormatWorktreeTitle(worktree *model.Worktree) string {
	nameWithHotkey := addHotkeyIndicator(worktree.Name, worktree.KeyBinding)
	// Use tree-like structure indicator (├── or └──) to show hierarchy
	baseTitle := fmt.Sprintf("  ├─ %s%s", lbf.getWorktreeIcon(), nameWithHotkey)

	// Add status indicator and muted color based on worktree status
	// Priority: blocked > testing
	if worktree.Status == model.ProjectStatusBlocked {
		blockedIndicator := " 🚫"
		title := baseTitle + blockedIndicator

		// Apply muted color (dark gray)
		return "\x1b[38;5;239m" + title + "\x1b[0m"
	}

	if worktree.Status == model.ProjectStatusTesting {
		testingIndicator := " 🧪" // Testing icon (test tube)
		title := baseTitle + testingIndicator

		// Apply muted color (dark gray)
		return "\x1b[38;5;239m" + title + "\x1b[0m"
	}

	return baseTitle
}

func (lbf *ListBuilderFormatter) FormatWorktreeDescription(worktree *model.Worktree) string {
	desc := filepath.Base(worktree.Path)
	
	// Add URL if available
	if url := lbf.GetWorktreeURL(worktree); url != "" {
		desc += fmt.Sprintf(" • %s", url)
	}
	
	return desc
}

// Pane formatting methods

func (lbf *ListBuilderFormatter) FormatPaneTitle(pane *terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) string {
	icon := lbf.GetPaneIcon(pane, claudeStatus)
	title := lbf.GetPaneDisplayTitle(pane)
	
	fullTitle := fmt.Sprintf("    %s%s", icon, title)
	
	// Add duration for Claude panes when available
	if pane.ShellType == model.ShellTypeClaude && claudeStatus != nil {
		tmuxTarget := pane.GetTmuxTarget()
		duration := claudeStatus.GetPaneDuration(tmuxTarget)
		if duration != "" {
			fullTitle += fmt.Sprintf(" (%s)", duration)
		}
	}
	
	// Check if pane should be muted due to blocked or testing parent
	shouldMute := false
	if pane.Project != nil && (pane.Project.Status == model.ProjectStatusBlocked || pane.Project.Status == model.ProjectStatusTesting) {
		shouldMute = true
	}
	if pane.Worktree != nil && (pane.Worktree.Status == model.ProjectStatusBlocked || pane.Worktree.Status == model.ProjectStatusTesting) {
		shouldMute = true
	}
	
	if shouldMute {
		// Apply muted color (dark gray) - takes precedence over Claude highlighting
		fullTitle = "\x1b[38;5;239m" + fullTitle + "\x1b[0m"
	} else {
		// Apply highlighting for Claude panes if not muted
		if pane.ShellType == model.ShellTypeClaude && claudeStatus != nil {
			tmuxTarget := pane.GetTmuxTarget()
			if claudeStatus.ShouldHighlightByType(tmuxTarget, string(pane.ShellType)) {
				// Apply orange highlighting using raw ANSI codes
				fullTitle = "\x1b[38;5;208m" + fullTitle + "\x1b[0m"
			}
		}
	}
	
	return fullTitle
}

func (lbf *ListBuilderFormatter) FormatPaneDescription(pane *terminal.TmuxPane) string {
	desc := fmt.Sprintf("%s:%d.%d", pane.SessionName, pane.WindowIndex, pane.PaneIndex)
	
	if pane.CurrentCommand != "" && pane.CurrentCommand != "zsh" {
		desc += fmt.Sprintf(" • %s", pane.CurrentCommand)
	}
	
	return desc
}

// Icon methods

func (lbf *ListBuilderFormatter) getProjectIcon(project *model.Project) string {
	if project.IsOtherSessionsProject() {
		return "🔍 "
	}
	return "📂 "
}

func (lbf *ListBuilderFormatter) getWorktreeIcon() string {
	return "🌿 "
}

func (lbf *ListBuilderFormatter) GetPaneIcon(pane *terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) string {
	switch pane.ShellType {
	case model.ShellTypeClaude:
		// Always use robot icon for Claude panes (for compatibility with existing tests)
		// Highlighting is applied separately via ANSI color codes
		return "🤖 "
	case model.ShellTypeZsh:
		return "⚡ "
	case model.ShellTypeNvim:
		return "📝 "
	default:
		return "💻 "
	}
}

func (lbf *ListBuilderFormatter) GetPaneDisplayTitle(pane *terminal.TmuxPane) string {
	// For Claude panes, use simplified display name for compatibility
	if pane.ShellType == model.ShellTypeClaude {
		// If pane title starts with "Claude", just return "Claude"
		if pane.PaneTitle != "" && strings.HasPrefix(pane.PaneTitle, "Claude") {
			return "Claude"
		}
		// If pane title is meaningful, use it (strip any leading symbols)
		if pane.PaneTitle != "" && !isBoringPaneTitle(pane.PaneTitle) {
			// Remove leading symbols like "✳ " from titles
			title := strings.TrimSpace(strings.TrimLeft(pane.PaneTitle, "✳ ▶ ● ◆ ■ ▲ ▼ ◀ ▶ "))
			return title
		}
		// Otherwise use the current command if available
		if pane.CurrentCommand != "" && pane.CurrentCommand != "zsh" {
			return pane.CurrentCommand
		}
		return "Claude"
	}
	
	// Priority 1: Use pane title if it's meaningful
	if pane.PaneTitle != "" && !isBoringPaneTitle(pane.PaneTitle) {
		return stripANSIFromString(pane.PaneTitle)
	}
	
	// Priority 2: Use current command if meaningful
	if pane.CurrentCommand != "" && pane.CurrentCommand != "zsh" {
		return pane.CurrentCommand
	}
	
	// Priority 3: Use session and window info
	return fmt.Sprintf("Session: %s", pane.SessionName)
}

func (lbf *ListBuilderFormatter) IsClaudeActive(pane *terminal.TmuxPane, claudeStatus *status.ClaudeStatusManager) bool {
	if claudeStatus == nil {
		return true // Assume active if no status manager
	}
	
	status := claudeStatus.GetPaneStatus(pane.GetTmuxTarget())
	return status != nil && status.Active
}

// URL methods

func (lbf *ListBuilderFormatter) GetProjectURL(project *model.Project) string {
	if project.HttpServer != nil {
		return fmt.Sprintf("http://localhost:%d", project.HttpServer.Port)
	}
	return ""
}

func (lbf *ListBuilderFormatter) GetWorktreeURL(worktree *model.Worktree) string {
	if worktree.HttpServer != nil {
		return fmt.Sprintf("http://localhost:%d", worktree.HttpServer.Port)
	}
	return ""
}