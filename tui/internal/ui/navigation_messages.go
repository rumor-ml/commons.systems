// navigation_messages.go - Message types for navigation component communication

package ui

import (
	"github.com/natb1/tui/pkg/model"
)

// Message types for navigation actions

// ProjectDashboardMsg triggers dashboard view for a project
type ProjectDashboardMsg struct{ Project *model.Project }

// ProjectShellMsg triggers shell creation/attachment for a project
type ProjectShellMsg struct {
	Project   *model.Project
	ShellType model.ShellType
}

// WorktreeShellMsg triggers shell creation/attachment for a worktree
type WorktreeShellMsg struct {
	Project   *model.Project
	Worktree  *model.Worktree
	ShellType model.ShellType
}

// SwitchToMuxMsg triggers switch to terminal mux mode
type SwitchToMuxMsg struct{}

// Dev server message types

// DevServerPathMsg triggers path input modal for dev server
type DevServerPathMsg struct{}

// Blocked state management

// ToggleBlockedMsg toggles blocked state of project or worktree
type ToggleBlockedMsg struct {
	Project  *model.Project
	Worktree *model.Worktree // nil for project-level blocking
}

// Testing state management

// ToggleTestingMsg toggles testing state of project or worktree
type ToggleTestingMsg struct {
	Project  *model.Project
	Worktree *model.Worktree // nil for project-level testing
}

// Claude status integration

// ClaudeStatusUpdateMsg notifies of Claude pane status changes
type ClaudeStatusUpdateMsg struct {
	PaneID       string
	Active       bool
	DurationText string
}

// Worktree creation messages

// CreateWorktreeMsg triggers the worktree creation flow
type CreateWorktreeMsg struct {
	Project   *model.Project
	ShellType model.ShellType // The shell type requested (claude or zsh)
}

// SelectRemoteBranchMsg shows the remote branch selection UI
type SelectRemoteBranchMsg struct {
	Project   *model.Project
	ShellType model.ShellType
}

// RemoteBranchSelectedMsg indicates a remote branch was selected
type RemoteBranchSelectedMsg struct {
	Project    *model.Project
	BranchName string
	ShellType  model.ShellType
}

// WorktreeCreatedMsg indicates a worktree was successfully created
type WorktreeCreatedMsg struct {
	Project      *model.Project
	WorktreePath string
	BranchName   string
}