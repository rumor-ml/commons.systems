package terminal

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestUTF8Valid(t *testing.T) {
	tests := []struct {
		name     string
		input    []byte
		expected bool
	}{
		{
			name:     "valid ASCII",
			input:    []byte("hello world"),
			expected: true,
		},
		{
			name:     "valid UTF-8",
			input:    []byte("hello 世界"),
			expected: true,
		},
		{
			name:     "empty input",
			input:    []byte{},
			expected: true,
		},
		{
			name:     "invalid UTF-8",
			input:    []byte{0xff, 0xfe, 0xfd},
			expected: false,
		},
		{
			name:     "incomplete UTF-8 sequence",
			input:    []byte{0xc2}, // Incomplete 2-byte sequence
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := utf8Valid(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestWriteToSession(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Test writing to non-existent session
	err := manager.WriteToSession("nonexistent", []byte("test"))
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "session not found")

	// Create a mock session
	session := &Session{
		ID:     "write-test",
		Active: true,
		Output: NewRingBuffer(1024),
		ctx:    context.Background(),
		cancel: func() {},
	}

	manager.mutex.Lock()
	manager.sessions[session.ID] = session
	manager.mutex.Unlock()

	// Test writing to session without PTY (will fail but shouldn't panic)
	err = manager.WriteToSession(session.ID, []byte("test"))
	assert.Error(t, err) // Expected to fail without real PTY

	// Test writing to inactive session
	session.mutex.Lock()
	session.Active = false
	session.mutex.Unlock()

	err = manager.WriteToSession(session.ID, []byte("test"))
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "session is not active")
}

func TestGetSessionOutput(t *testing.T) {
	manager := NewManager()
	defer manager.Shutdown()

	// Test getting output from non-existent session
	output, err := manager.GetSessionOutput("nonexistent")
	assert.Error(t, err)
	assert.Empty(t, output)

	// Create a session with output
	session := &Session{
		ID:     "output-test",
		Active: true,
		Output: NewRingBuffer(1024),
		ctx:    context.Background(),
		cancel: func() {},
	}

	// Add some output to the buffer
	session.Output.Write([]byte("test output"))

	manager.mutex.Lock()
	manager.sessions[session.ID] = session
	manager.mutex.Unlock()

	// Get the output
	output, err = manager.GetSessionOutput(session.ID)
	assert.NoError(t, err)
	assert.Equal(t, []byte("test output"), output)

	// Note: Ring buffer Read() doesn't clear data, so getting output again returns the same
	output, err = manager.GetSessionOutput(session.ID)
	assert.NoError(t, err)
	assert.Equal(t, []byte("test output"), output) // Still has the data
}