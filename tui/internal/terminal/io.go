// io.go - Terminal I/O operations and session communication
//
// ## Metadata
//
// TUI input/output handling for terminal sessions.
//
// ### Purpose
//
// Handle all input/output operations for terminal sessions including reading from PTY,
// writing user input, managing output buffers, and ensuring thread-safe communication
// between the UI layer and terminal processes.
//
// ### Instructions
//
// #### I/O Management
//
// ##### Output Handling
//
// Continuously read output from PTY sessions and maintain buffers for UI consumption
// while managing buffer sizes and ensuring thread-safe access to session output data.
//
// ##### Input Processing
//
// Route user input to appropriate terminal sessions with proper error handling and
// session state validation to ensure reliable terminal interaction.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing integration patterns that inform how terminal I/O
// should be managed and coordinated with the broader multiplexer system.

package terminal

import (
	"bufio"
	"fmt"
	"io"
	"time"
	"unicode/utf8"
)

// handleSessionIO handles input/output for a terminal session with buffered reading
func (m *Manager) handleSessionIO(session *Session) {
	// Use bufio.Reader for buffered I/O
	reader := bufio.NewReaderSize(session.PTY, 4096)

	// Buffer for incomplete UTF-8 sequences
	var incompleteUTF8 []byte

	for {
		select {
		case <-session.ctx.Done():
			return
		default:
			// Read available data with a small timeout
			session.PTY.SetReadDeadline(time.Now().Add(10 * time.Millisecond))

			// Read up to available buffer size
			buffer := make([]byte, 4096)
			n, err := reader.Read(buffer)

			if err != nil {
				if err == io.EOF {
					return // Session ended
				}
				// Handle timeout errors gracefully - this is expected behavior
				if netErr, ok := err.(interface{ Timeout() bool }); ok && netErr.Timeout() {
					// No data available, continue
					time.Sleep(5 * time.Millisecond) // Small sleep to prevent CPU spinning
					continue
				}
				// Other errors - continue but maybe log in the future
				continue
			}

			if n > 0 {
				// Combine with any incomplete UTF-8 sequence from previous read
				data := append(incompleteUTF8, buffer[:n]...)
				incompleteUTF8 = nil

				// Find the last complete UTF-8 character boundary
				validEnd := len(data)
				for i := len(data) - 1; i >= 0 && i >= len(data)-4; i-- {
					if utf8Valid(data[:i+1]) {
						validEnd = i + 1
						break
					}
				}

				// If we have incomplete UTF-8 at the end, save it for next read
				if validEnd < len(data) {
					incompleteUTF8 = make([]byte, len(data)-validEnd)
					copy(incompleteUTF8, data[validEnd:])
					data = data[:validEnd]
				}

				// Write to ring buffer (thread-safe)
				session.Output.Write(data)
			}
		}
	}
}

// WriteToSession writes input to a terminal session
func (m *Manager) WriteToSession(sessionID string, data []byte) error {
	m.mutex.RLock()
	session, exists := m.sessions[sessionID]
	m.mutex.RUnlock()

	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	// Check session state with read lock
	session.mutex.RLock()
	active := session.Active
	pty := session.PTY
	session.mutex.RUnlock()

	if !active {
		return fmt.Errorf("session is not active: %s", sessionID)
	}

	if pty == nil {
		return fmt.Errorf("session PTY is not available: %s", sessionID)
	}

	_, err := pty.Write(data)
	return err
}

// GetSessionOutput returns the current output buffer for a session
func (m *Manager) GetSessionOutput(sessionID string) ([]byte, error) {
	m.mutex.RLock()
	session, exists := m.sessions[sessionID]
	m.mutex.RUnlock()

	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	// Get output from ring buffer (thread-safe)
	return session.Output.Read(), nil
}

// utf8Valid checks if the given byte slice forms valid UTF-8
func utf8Valid(data []byte) bool {
	return utf8.Valid(data)
}
