// tmux_executor.go - Tmux command execution interface and mock implementation

package terminal

import (
	"os/exec"
	"strings"
)

// TmuxExecutor provides an interface for executing tmux commands
// This allows for mocking tmux commands in tests
type TmuxExecutor interface {
	Execute(args ...string) ([]byte, error)
	ExecuteWithInput(input string, args ...string) ([]byte, error)
	Run(args ...string) error
}

// RealTmuxExecutor executes actual tmux commands
type RealTmuxExecutor struct {
	tmuxPath string
}

// NewRealTmuxExecutor creates a new real tmux executor
func NewRealTmuxExecutor(tmuxPath string) *RealTmuxExecutor {
	return &RealTmuxExecutor{
		tmuxPath: tmuxPath,
	}
}

// Execute runs a tmux command and returns the output
func (r *RealTmuxExecutor) Execute(args ...string) ([]byte, error) {
	cmd := exec.Command(r.tmuxPath, args...)
	return cmd.Output()
}

// ExecuteWithInput runs a tmux command with input and returns the output
func (r *RealTmuxExecutor) ExecuteWithInput(input string, args ...string) ([]byte, error) {
	cmd := exec.Command(r.tmuxPath, args...)
	cmd.Stdin = strings.NewReader(input)
	return cmd.Output()
}

// Run executes a tmux command without capturing output
func (r *RealTmuxExecutor) Run(args ...string) error {
	cmd := exec.Command(r.tmuxPath, args...)
	return cmd.Run()
}

// MockTmuxExecutor provides a mock implementation for testing
type MockTmuxExecutor struct {
	// Commands maps command strings to their expected outputs
	Commands map[string][]byte
	// Errors maps command strings to their expected errors
	Errors map[string]error
	// ExecutedCommands tracks what commands were executed
	ExecutedCommands [][]string
	// RunResults maps command strings to run results (success/failure)
	RunResults map[string]error
}

// NewMockTmuxExecutor creates a new mock tmux executor
func NewMockTmuxExecutor() *MockTmuxExecutor {
	return &MockTmuxExecutor{
		Commands:         make(map[string][]byte),
		Errors:          make(map[string]error),
		ExecutedCommands: make([][]string, 0),
		RunResults:      make(map[string]error),
	}
}

// Execute mocks a tmux command execution
func (m *MockTmuxExecutor) Execute(args ...string) ([]byte, error) {
	cmdStr := strings.Join(args, " ")
	m.ExecutedCommands = append(m.ExecutedCommands, args)
	
	if err, exists := m.Errors[cmdStr]; exists {
		return nil, err
	}
	
	if output, exists := m.Commands[cmdStr]; exists {
		return output, nil
	}
	
	// Default empty response
	return []byte{}, nil
}

// ExecuteWithInput mocks a tmux command execution with input
func (m *MockTmuxExecutor) ExecuteWithInput(input string, args ...string) ([]byte, error) {
	// For now, just delegate to Execute - can be enhanced later if needed
	return m.Execute(args...)
}

// Run mocks a tmux command run without output capture
func (m *MockTmuxExecutor) Run(args ...string) error {
	cmdStr := strings.Join(args, " ")
	m.ExecutedCommands = append(m.ExecutedCommands, args)
	
	if err, exists := m.RunResults[cmdStr]; exists {
		return err
	}
	
	return nil // Default success
}

// SetCommandOutput sets the expected output for a command
func (m *MockTmuxExecutor) SetCommandOutput(command string, output []byte) {
	m.Commands[command] = output
}

// SetCommandError sets the expected error for a command
func (m *MockTmuxExecutor) SetCommandError(command string, err error) {
	m.Errors[command] = err
}

// SetRunResult sets the expected result for a run command
func (m *MockTmuxExecutor) SetRunResult(command string, err error) {
	m.RunResults[command] = err
}

// GetExecutedCommands returns all executed commands for verification in tests
func (m *MockTmuxExecutor) GetExecutedCommands() [][]string {
	return m.ExecutedCommands
}

// Reset clears all mock data
func (m *MockTmuxExecutor) Reset() {
	m.Commands = make(map[string][]byte)
	m.Errors = make(map[string]error)
	m.ExecutedCommands = make([][]string, 0)
	m.RunResults = make(map[string]error)
}