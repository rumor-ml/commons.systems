// keyboard_sequences.go - Vim-like keyboard sequence handling for navigation

package ui

import (
	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// SequenceState tracks the current state of key sequence input
type SequenceState int

const (
	StateNone           SequenceState = iota
	StateAwaitingAction // After selecting target, waiting for action
)

// sequenceTarget represents what was selected in the first key press
type sequenceTarget struct {
	project  *model.Project
	worktree *model.Worktree
}

// KeySequenceHandler handles vim-like key sequences for project navigation
type KeySequenceHandler struct {
	logger        log.Logger
	sequenceState SequenceState
	pendingTarget *sequenceTarget
	projects      []*model.Project
	keyBindingMgr *model.KeyBindingManager
}

// NewKeySequenceHandler creates a new keyboard sequence handler
func NewKeySequenceHandler() *KeySequenceHandler {
	return &KeySequenceHandler{
		logger:        log.Get(),
		sequenceState: StateNone,
		pendingTarget: nil,
	}
}

// SetProjects updates the projects and keybinding manager
func (ksh *KeySequenceHandler) SetProjects(projects []*model.Project, keyMgr *model.KeyBindingManager) {
	ksh.projects = projects
	ksh.keyBindingMgr = keyMgr
}

// HandleKeySequence handles vim-like key sequences for project navigation
func (ksh *KeySequenceHandler) HandleKeySequence(msg tea.KeyMsg) tea.Cmd {
	if ksh.projects == nil || ksh.keyBindingMgr == nil {
		return nil
	}

	// Get the actual character pressed (ignore modifiers for sequences)
	if len(msg.Runes) == 0 {
		return nil
	}
	char := msg.Runes[0]

	ksh.logger.Debug("Key sequence handler",
		"key", string(char),
		"keyType", msg.Type.String(),
		"keyString", msg.String(),
		"state", int(ksh.sequenceState),
		"pendingTarget", func() string {
			if ksh.pendingTarget != nil {
				if ksh.pendingTarget.worktree != nil {
					return ksh.pendingTarget.worktree.ID
				}
				return ksh.pendingTarget.project.Name
			}
			return "none"
		}())

	switch ksh.sequenceState {
	case StateNone:
		// Check for global dev server commands first
		if char == 'r' {
			// Dev server restart command
			return func() tea.Msg {
				return DevServerRestartMsg{}
			}
		} else if char == '/' {
			// Dev server path input command - activate input mode
			return func() tea.Msg {
				return ActivatePathInputMsg{}
			}
		}

		// First key: try to find a target (project or worktree)
		if target := ksh.findTargetByKey(char); target != nil {
			ksh.sequenceState = StateAwaitingAction
			ksh.pendingTarget = target
			return nil // No command yet, just update state
		}
		return nil

	case StateAwaitingAction:
		// Second key: execute action on pending target
		// Valid action keys: z=zsh, c=claude, C=create worktree (claude), Z=create worktree (zsh), x=toggle blocked, t=toggle testing
		if char == 'z' || char == 'c' || char == 'C' || char == 'Z' || char == 'x' || char == 't' {
			cmd := ksh.executeSequenceAction(char)
			// Reset sequence state after valid action
			ksh.sequenceState = StateNone
			ksh.pendingTarget = nil
			return cmd
		} else {
			// Invalid action key - reset sequence state
			ksh.sequenceState = StateNone
			ksh.pendingTarget = nil
			return nil
		}
	}

	return nil
}

// findTargetByKey finds a project or worktree by its key binding
func (ksh *KeySequenceHandler) findTargetByKey(char rune) *sequenceTarget {
	// First check projects
	for _, project := range ksh.projects {
		if project.KeyBinding == char {
			return &sequenceTarget{
				project:  project,
				worktree: nil,
			}
		}
	}

	// Then check worktrees
	for _, project := range ksh.projects {
		for _, worktree := range project.Worktrees {
			if worktree.KeyBinding == char {
				return &sequenceTarget{
					project:  project,
					worktree: worktree,
				}
			}
		}
	}

	return nil
}

// executeSequenceAction executes the action based on the second key in sequence
func (ksh *KeySequenceHandler) executeSequenceAction(char rune) tea.Cmd {
	if ksh.pendingTarget == nil {
		return nil
	}

	project := ksh.pendingTarget.project
	worktree := ksh.pendingTarget.worktree

	ksh.logger.Debug("Executing sequence action",
		"key", string(char),
		"project", project.Name,
		"worktree", func() string {
			if worktree != nil {
				return worktree.ID
			}
			return "none"
		}())

	switch char {
	case 'z':
		if worktree != nil {
			return func() tea.Msg {
				return WorktreeShellMsg{
					Project:   project,
					Worktree:  worktree,
					ShellType: model.ShellTypeZsh,
				}
			}
		} else {
			return func() tea.Msg {
				return ProjectShellMsg{
					Project:   project,
					ShellType: model.ShellTypeZsh,
				}
			}
		}

	case 'c':
		if worktree != nil {
			return func() tea.Msg {
				return WorktreeShellMsg{
					Project:   project,
					Worktree:  worktree,
					ShellType: model.ShellTypeClaude,
				}
			}
		} else {
			return func() tea.Msg {
				return ProjectShellMsg{
					Project:   project,
					ShellType: model.ShellTypeClaude,
				}
			}
		}

	case 'x':
		return func() tea.Msg {
			return ToggleBlockedMsg{
				Project:  project,
				Worktree: worktree,
			}
		}

	case 't':
		return func() tea.Msg {
			return ToggleTestingMsg{
				Project:  project,
				Worktree: worktree,
			}
		}

	case 'C':
		// Create worktree with Claude shell
		return func() tea.Msg {
			return CreateWorktreeMsg{
				Project:   project,
				ShellType: model.ShellTypeClaude,
			}
		}

	case 'Z':
		// Create worktree with Zsh shell
		return func() tea.Msg {
			return CreateWorktreeMsg{
				Project:   project,
				ShellType: model.ShellTypeZsh,
			}
		}
	}

	return nil
}

// IsInSequence returns true if currently in a key sequence
func (ksh *KeySequenceHandler) IsInSequence() bool {
	return ksh.sequenceState != StateNone
}

// GetSequenceStatus returns the current sequence status for help display
func (ksh *KeySequenceHandler) GetSequenceStatus() (bool, string) {
	if ksh.sequenceState == StateNone {
		return false, ""
	}

	if ksh.sequenceState == StateAwaitingAction && ksh.pendingTarget != nil {
		targetName := ksh.pendingTarget.project.Name
		if ksh.pendingTarget.worktree != nil {
			targetName = ksh.pendingTarget.worktree.ID
		}
		return true, "Selected " + targetName + " - press c=claude, z=zsh, C=new worktree(claude), Z=new worktree(zsh), x=blocked, t=testing"
	}

	return true, "Key sequence active"
}

// ClearSequence resets the sequence state
func (ksh *KeySequenceHandler) ClearSequence() {
	ksh.sequenceState = StateNone
	ksh.pendingTarget = nil
}