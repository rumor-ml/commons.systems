package testutil

import (
	"fmt"
	"strings"
)

// GitError represents a git command error for testing
type GitError struct {
	NotARepo bool
	Stderr   string
}

func (e *GitError) Error() string {
	return e.Stderr
}

// MockCommandExecutor implements CommandExecutor for testing
type MockCommandExecutor struct {
	TmuxOutput string
	GitOutputs map[string]string // key: command args, value: output
	PgrepPIDs  string
	PsCommands map[string]string // key: PID, value: command
}

func (m *MockCommandExecutor) ExecCommand(name string, args ...string) ([]byte, error) {
	return m.ExecCommandOutput(name, args...)
}

func (m *MockCommandExecutor) ExecCommandOutput(name string, args ...string) ([]byte, error) {
	switch name {
	case "tmux":
		if m.TmuxOutput == "" {
			return nil, fmt.Errorf("tmux command failed")
		}
		return []byte(m.TmuxOutput), nil

	case "git":
		key := strings.Join(args, " ")
		if output, ok := m.GitOutputs[key]; ok {
			return []byte(output), nil
		}
		// Return "not a git repository" error
		return nil, &GitError{
			NotARepo: true,
			Stderr:   "fatal: not a git repository",
		}

	case "pgrep":
		if m.PgrepPIDs == "" {
			// No processes found - simulate exit code 1
			return nil, fmt.Errorf("no processes found")
		}
		return []byte(m.PgrepPIDs), nil

	case "ps":
		if len(args) >= 3 {
			pid := args[len(args)-1]
			if cmd, ok := m.PsCommands[pid]; ok {
				return []byte(cmd), nil
			}
		}
		return nil, fmt.Errorf("process not found")
	}

	return nil, fmt.Errorf("unknown command: %s", name)
}
