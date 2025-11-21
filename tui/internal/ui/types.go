package ui

// WorktreeProgress tracks the progress of worktree creation
type WorktreeProgress struct {
	InProgress  bool
	ProjectName string
}

// WorktreeProgressUpdateMsg is sent to update worktree creation progress
type WorktreeProgressUpdateMsg struct {
	InProgress  bool
	ProjectName string
}

// PaneManagementModeMsg is sent when switching pane management modes
type PaneManagementModeMsg struct {
	Mode string // "unsplit" or "grouped"
}
