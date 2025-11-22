package terminal

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMockTmuxExecutor(t *testing.T) {
	mock := NewMockTmuxExecutor()
	
	// Test initial state
	assert.Empty(t, mock.GetExecutedCommands())
	
	// Test setting command output
	mock.SetCommandOutput("list-sessions", []byte("session1\nsession2"))
	
	// Execute the command
	output, err := mock.Execute("list-sessions")
	assert.NoError(t, err)
	assert.Equal(t, []byte("session1\nsession2"), output)
	
	// Verify command was recorded
	commands := mock.GetExecutedCommands()
	assert.Len(t, commands, 1)
	assert.Equal(t, []string{"list-sessions"}, commands[0])
}

func TestMockTmuxExecutorError(t *testing.T) {
	mock := NewMockTmuxExecutor()
	
	// Set an error for a command
	mock.SetCommandError("bad-command", errors.New("command failed"))
	
	// Execute the command
	output, err := mock.Execute("bad-command")
	assert.Error(t, err)
	assert.Equal(t, "command failed", err.Error())
	assert.Empty(t, output)
}

func TestMockTmuxExecutorWithInput(t *testing.T) {
	mock := NewMockTmuxExecutor()
	
	// Set output for command with input
	mock.SetCommandOutput("send-keys", []byte("ok"))
	
	// Execute with input
	output, err := mock.ExecuteWithInput("test input", "send-keys")
	assert.NoError(t, err)
	assert.Equal(t, []byte("ok"), output)
	
	// Verify command was recorded
	commands := mock.GetExecutedCommands()
	assert.Len(t, commands, 1)
	assert.Equal(t, []string{"send-keys"}, commands[0])
}

func TestMockTmuxExecutorRun(t *testing.T) {
	mock := NewMockTmuxExecutor()
	
	// Set run result (nil = success)
	mock.SetRunResult("some-command", nil)
	
	// Test run
	err := mock.Run("some-command")
	assert.NoError(t, err)
	
	// Set run result to error
	mock.SetRunResult("another-command", errors.New("run failed"))
	err = mock.Run("another-command")
	assert.Error(t, err)
	assert.Equal(t, "run failed", err.Error())
}

func TestMockTmuxExecutorReset(t *testing.T) {
	mock := NewMockTmuxExecutor()
	
	// Execute some commands
	mock.Execute("cmd1")
	mock.Execute("cmd2")
	
	// Verify commands were recorded
	assert.Len(t, mock.GetExecutedCommands(), 2)
	
	// Reset
	mock.Reset()
	
	// Verify commands were cleared
	assert.Empty(t, mock.GetExecutedCommands())
}

func TestMockTmuxExecutorUnknownCommand(t *testing.T) {
	mock := NewMockTmuxExecutor()
	
	// Execute command without setting output (should return empty)
	output, err := mock.Execute("unknown-command")
	assert.NoError(t, err)
	assert.Empty(t, output)
}