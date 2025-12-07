package tmux

import (
	"os/exec"
)

// CommandExecutor abstracts command execution for testing
type CommandExecutor interface {
	// ExecCommand runs a command and returns combined output and error
	ExecCommand(name string, args ...string) ([]byte, error)

	// ExecCommandOutput runs a command and returns stdout only
	ExecCommandOutput(name string, args ...string) ([]byte, error)
}

// RealCommandExecutor implements CommandExecutor using exec.Command
type RealCommandExecutor struct{}

func (r *RealCommandExecutor) ExecCommand(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).CombinedOutput()
}

func (r *RealCommandExecutor) ExecCommandOutput(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).Output()
}

// GitError represents a git command error for testing
type GitError struct {
	NotARepo bool
	Stderr   string
}

func (e *GitError) Error() string {
	return e.Stderr
}
