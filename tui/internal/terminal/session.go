// session.go - Terminal session lifecycle management
//
// Handles PTY session creation, management, resizing, monitoring, and cleanup
// with ICF application detection and proper resource safety.

package terminal

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/creack/pty"
	"github.com/google/uuid"
	"github.com/natb1/tui/internal/terminal/security"
	"github.com/natb1/tui/pkg/model"
)

// CreateSession creates a new terminal session
func (m *Manager) CreateSession(project *model.Project, command string) tea.Cmd {
	return func() tea.Msg {
		session, err := m.createSession(project, command)
		if err != nil {
			return err
		}

		return SessionCreatedMsg{Session: session}
	}
}
// CreateWorktreeSession creates a new terminal session in a worktree
func (m *Manager) CreateWorktreeSession(project *model.Project, worktreeID, worktreePath, command string) tea.Cmd {
	return func() tea.Msg {
		session, err := m.createWorktreeSession(project, worktreeID, worktreePath, command)
		if err != nil {
			return err
		}

		return SessionCreatedMsg{Session: session}
	}
}
// createSession performs the actual session creation
func (m *Manager) createSession(project *model.Project, command string) (*Session, error) {
	workingDir := ""
	if project != nil {
		workingDir = project.Path
	}
	cmd, err := validateAndCreateCommand(command, workingDir, false)
	if err != nil {
		return nil, err
	}
	if project != nil {
		cmd.Dir = project.Path
	}

	cmd.Env = buildEnvironment()

	ptyFile, err := startPTYWithDefaultSize(cmd)
	if err != nil {
		return nil, err
	}

	session := m.createSessionObject(project, ptyFile, cmd, "", "")

	m.startSessionMonitoring(session)

	return session, nil
}
// createWorktreeSession performs the actual session creation for a worktree
func (m *Manager) createWorktreeSession(project *model.Project, worktreeID, worktreePath, command string) (*Session, error) {
	cmd, err := validateAndCreateCommand(command, worktreePath, true)
	if err != nil {
		return nil, err
	}
	cmd.Dir = worktreePath

	// Set up process group for proper signal handling
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
		Pgid:    0,
	}

	cmd.Env = buildEnvironment()

	ptyFile, err := startPTYWithDefaultSize(cmd)
	if err != nil {
		return nil, err
	}

	session := m.createSessionObject(project, ptyFile, cmd, worktreeID, worktreePath)

	m.startSessionMonitoring(session)

	return session, nil
}

// ResizeSessionImmediate immediately resizes a specific session (synchronous)
func (m *Manager) ResizeSessionImmediate(sessionID string, width, height int) error {
	m.mutex.RLock()
	session, exists := m.sessions[sessionID]
	m.mutex.RUnlock()

	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	if !session.Active || session.PTY == nil {
		return fmt.Errorf("session is not active: %s", sessionID)
	}

	err := resizePTY(session.PTY, width, height)
	if err != nil {
		return fmt.Errorf("failed to resize PTY: %w", err)
	}

	// Send SIGWINCH to notify the shell process about the resize
	if session.Command != nil && session.Command.Process != nil {
		session.Command.Process.Signal(syscall.SIGWINCH)
	}

	return nil
}

// resizeSession resizes a terminal session
func (m *Manager) resizeSession(session *Session, width, height int) tea.Cmd {
	return func() tea.Msg {
		if session.PTY != nil {
			err := resizePTY(session.PTY, width, height)
			if err != nil {
				return err
			}

			// Send SIGWINCH to notify the shell about the resize
			if session.Command != nil && session.Command.Process != nil {
				session.Command.Process.Signal(syscall.SIGWINCH)
			}
		}
		return nil
	}
}

// monitorSession monitors session process lifecycle
func (m *Manager) monitorSession(session *Session) {
	defer func() {
		// Ensure cleanup with proper synchronization
		session.mutex.Lock()
		session.Active = false
		cancel := session.cancel
		ptyFile := session.PTY
		session.mutex.Unlock()

		if cancel != nil {
			cancel()
		}

		if ptyFile != nil {
			ptyFile.Close()
		}
	}()

	// Create a channel to wait for process exit
	exitChan := make(chan error, 1)
	go func() {
		defer close(exitChan)
		exitChan <- session.Command.Wait()
	}()

	var exitCode int

	// Wait for either process exit or context cancellation
	select {
	case <-session.ctx.Done():
		// Context cancelled, forcefully terminate process
		if session.Command != nil && session.Command.Process != nil {
			session.Command.Process.Kill()
		}
		exitCode = -1
	case err := <-exitChan:
		// Process exited normally
		if err != nil {
			if exitError, ok := err.(*exec.ExitError); ok {
				exitCode = exitError.ExitCode()
			} else {
				exitCode = -1
			}
		}
	}

	// Send termination message
	m.mutex.RLock()
	shuttingDown := m.shuttingDown
	m.mutex.RUnlock()
	
	if !shuttingDown {
		select {
		case <-m.ctx.Done():
		case m.eventChan <- SessionTerminatedMsg{SessionID: session.ID, ExitCode: exitCode}:
		default:
		}
	}
}

// generateSessionID generates a unique session identifier
func (m *Manager) generateSessionID() string {
	return "session-" + uuid.New().String()
}

// buildEnvironment creates the environment slice for tmux-like behavior
func buildEnvironment() []string {
	return []string{
		"PATH=" + os.Getenv("PATH"),
		"HOME=" + os.Getenv("HOME"),
		"USER=" + os.Getenv("USER"),
		"SHELL=" + os.Getenv("SHELL"),
		"TERM=screen-256color",
		"TMUX=/tmp/tmux-501/default,12345,0", // Fake tmux session to trigger proper mode
		"TMUX_PANE=%0",
		fmt.Sprintf("COLUMNS=%d", DefaultPTYColumns),
		fmt.Sprintf("LINES=%d", DefaultPTYRows),
		"SHLVL=1",
	}
}

// createCommand creates an exec.Cmd based on the command string
func createCommand(command string, workingDir string, isWorktree bool) *exec.Cmd {
	if command == "claude -c" || command == "claude" {
		// Check if flake.nix exists in the working directory
		if workingDir != "" {
			flakePath := workingDir + "/flake.nix"
			if _, err := os.Stat(flakePath); err == nil {
				// flake.nix exists, wrap claude in nix develop
				return exec.Command("nix", "develop", "--command", "claude", "-c")
			}
		}
		// No flake.nix, fall back to direct claude execution
		claudePath, err := exec.LookPath("claude")
		if err != nil {
			claudePath = "claude"
		}
		return exec.Command(claudePath, "-c")
	} else if command == "nvim" && !isWorktree {
		nvimPath, err := exec.LookPath("nvim")
		if err != nil {
			nvimPath = "nvim"		}
		return exec.Command(nvimPath)
	} else if command == "zsh" || command == "" {
		zshPath, err := exec.LookPath("zsh")
		if err != nil {
			zshPath = "/bin/zsh"		}
		if isWorktree {
			return exec.Command(zshPath, "-i")
		}
		return exec.Command(zshPath)
	} else {
		return exec.Command("zsh", "-c", command)
	}
}

// startPTYWithDefaultSize starts a PTY and sets it to default size
func startPTYWithDefaultSize(cmd *exec.Cmd) (*os.File, error) {
	ptyFile, err := pty.Start(cmd)
	if err != nil {
		return nil, fmt.Errorf("failed to start PTY: %w", err)
	}

	err = pty.Setsize(ptyFile, &pty.Winsize{
		Rows: DefaultPTYRows,
		Cols: DefaultPTYColumns,
		X:    16 * DefaultPTYColumns,
		Y:    16 * DefaultPTYRows,
	})
	if err != nil {
	}

	return ptyFile, nil
}

// resizePTY resizes a PTY to the given dimensions
func resizePTY(ptyFile *os.File, width, height int) error {
	return pty.Setsize(ptyFile, &pty.Winsize{
		Rows: uint16(height),
		Cols: uint16(width),
		X:    16 * uint16(width),
		Y:    16 * uint16(height),
	})
}

// startSessionMonitoring starts the monitoring and I/O handling goroutines
func (m *Manager) startSessionMonitoring(session *Session) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
			}
		}()
		m.monitorSession(session)
	}()
	go func() {
		defer func() {
			if r := recover(); r != nil {
			}
		}()
		m.handleSessionIO(session)
	}()
}

// createSessionObject creates and initializes a Session object
func (m *Manager) createSessionObject(project *model.Project, ptyFile *os.File, cmd *exec.Cmd, worktreeID, worktreePath string) *Session {
	sessionID := m.generateSessionID()
	sessionCtx, sessionCancel := context.WithCancel(m.ctx)

	session := &Session{
		ID:           sessionID,
		Project:      project,
		PTY:          ptyFile,
		Command:      cmd,
		WorktreeID:   worktreeID,
		WorktreePath: worktreePath,
		Active:       true,
		Output:       NewRingBuffer(65536),
		ctx:          sessionCtx,
		cancel:       sessionCancel,
	}

	m.mutex.Lock()
	m.sessions[sessionID] = session
	m.mutex.Unlock()

	return session
}

// validateAndCreateCommand validates a command and creates the exec.Cmd
func validateAndCreateCommand(command string, workingDir string, isWorktree bool) (*exec.Cmd, error) {
	if err := security.ValidateCommand(command); err != nil {
		return nil, fmt.Errorf("invalid command: %w", err)
	}
	return createCommand(command, workingDir, isWorktree), nil
}

// GetSessions returns all active sessions
func (m *Manager) GetSessions() map[string]*Session {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	// Return a copy to prevent race conditions
	sessions := make(map[string]*Session)
	for id, session := range m.sessions {
		sessions[id] = session
	}
	return sessions
}

// GetActiveSession returns the currently active session
func (m *Manager) GetActiveSession() *Session {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	for _, session := range m.sessions {
		if session.Active {
			return session
		}
	}
	return nil
}

// handleSessionCreated processes new session creation
func (m *Manager) handleSessionCreated(msg SessionCreatedMsg) tea.Cmd {
	// Store the session in the manager's sessions map
	m.mutex.Lock()
	m.sessions[msg.Session.ID] = msg.Session

	// Set as the active session if it's the first one
	if len(m.sessions) == 1 {
		msg.Session.Active = true
	}
	m.mutex.Unlock()

	return nil
}

// handleSessionTerminated processes session termination
func (m *Manager) handleSessionTerminated(msg SessionTerminatedMsg) tea.Cmd {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	// Clean up session resources
	if session, exists := m.sessions[msg.SessionID]; exists {
		// Ensure session is marked inactive
		session.mutex.Lock()
		session.Active = false
		session.mutex.Unlock()

		// Cancel session context if not already cancelled
		if session.cancel != nil {
			session.cancel()
		}

		// Close PTY if still open
		if session.PTY != nil {
			session.PTY.Close()
		}

		// Remove from sessions map
		delete(m.sessions, msg.SessionID)
	}
	return nil
}

