package devserver

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/rumor-ml/log/pkg/log"
)

// Manager handles the dev server lifecycle and operations
type Manager struct {
	validator      *ModuleValidator
	generator      *MainGenerator
	gomodGenerator *GoModGenerator
	process        *ProcessManager
	status         ServerStatus
	currentPath    string
	port           int
	tempBinaryPath string
	logCallback    func(string)
	statusCallback func(StatusInfo)
	logger         log.Logger
	mu             sync.RWMutex
	stopCh         chan struct{}
	carrierRoot    string
	validModules   int // Number of valid modules
	totalModules   int // Total number of modules discovered
}

// NewManager creates a new dev server manager
func NewManager(carriercommonsRoot string) *Manager {
	return &Manager{
		validator:      NewModuleValidator(carriercommonsRoot),
		generator:      NewMainGenerator(carriercommonsRoot),
		gomodGenerator: NewGoModGenerator(carriercommonsRoot),
		process:        NewProcessManager(),
		status:         StatusStopped,
		currentPath:    "/",
		port:           8080,
		logger:         log.Get().WithComponent("devserver"),
		stopCh:         make(chan struct{}),
		carrierRoot:    carriercommonsRoot,
	}
}

// SetLogCallback sets the callback for log output
func (m *Manager) SetLogCallback(callback func(string)) {
	m.logCallback = callback
}

// SetStatusCallback sets the callback for status updates
func (m *Manager) SetStatusCallback(callback func(StatusInfo)) {
	m.statusCallback = callback
}

// GetStatus returns the current server status
func (m *Manager) GetStatus() StatusInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return StatusInfo{
		Status:       m.status,
		CurrentPath:  m.currentPath,
		Port:         m.port,
		PID:          m.process.GetPID(),
		ValidModules: m.validModules,
		TotalModules: m.totalModules,
	}
}

// Start starts the dev server with the specified path
func (m *Manager) Start(path string) error {
	// Check status and update to Starting (with lock)
	m.mu.Lock()
	if m.status == StatusRunning {
		m.mu.Unlock()
		return fmt.Errorf("server already running")
	}

	// If already starting (from SetPathAsync), just continue with the start
	// Otherwise, set status to Starting (handles both Stopped and Error states)
	if m.status != StatusStarting {
		m.logger.Info("Starting dev server", "path", path, "carrierRoot", m.carrierRoot)
		m.updateStatus(StatusStarting, path)
	}
	port := m.port
	m.mu.Unlock()

	// Clean any existing process on the port (without lock)
	if err := KillPortProcess(port); err != nil {
		m.logger.Warn("Failed to clean port", "error", err)
	}

	// Validate modules with enhanced compilation checks (without lock)
	m.logger.Info("🔍 Validating modules...")
	ctx := context.Background()
	result, err := m.validator.DiscoverAndValidateWithDetails(ctx)
	if err != nil {
		m.logger.Error("Module discovery failed", "error", err)
		m.mu.Lock()
		m.updateStatusWithError(StatusError, err)
		m.mu.Unlock()
		return fmt.Errorf("module discovery failed: %w", err)
	}

	// Log excluded modules at ERROR level for TUI log display visibility
	for _, invalid := range result.Invalid {
		// Format error to mimic Go compiler output
		m.logger.Error(fmt.Sprintf("../%s/...: %s", invalid.Module, invalid.Error))
	}

	// Log summary of excluded modules
	if len(result.Invalid) > 0 {
		m.logger.Warn(fmt.Sprintf("Excluded %d module(s) due to compilation errors", len(result.Invalid)))
	}

	// Allow zero modules - server will start in minimal mode
	validModules := result.Valid
	totalModules := len(result.Valid) + len(result.Invalid)

	// Store module counts for status reporting (with lock)
	m.mu.Lock()
	m.validModules = len(validModules)
	m.totalModules = totalModules
	m.mu.Unlock()

	if len(validModules) == 0 {
		m.logger.Warn("No valid modules found - starting server with base functionality only")
	} else {
		m.logger.Info(fmt.Sprintf("✓ Found valid modules: %s", strings.Join(validModules, ", ")))
	}

	// Generate main.go using Go generator (without lock)
	m.logger.Info("📝 Generating main.go...")
	m.generator.SetValidModules(validModules)
	if err := m.generator.GenerateMainGo(); err != nil {
		m.logger.Error("Failed to generate main.go", "error", err)
		m.mu.Lock()
		m.updateStatusWithError(StatusError, err)
		m.mu.Unlock()
		return fmt.Errorf("failed to generate main.go: %w", err)
	}

	// Generate go.mod with valid modules (without lock)
	m.logger.Info("📝 Generating go.mod...")
	m.gomodGenerator.SetValidModules(validModules)
	if err := m.gomodGenerator.GenerateGoMod(); err != nil {
		m.logger.Error("Failed to generate go.mod", "error", err)
		// Restore both files on failure
		m.generator.RestoreOriginalMain()
		m.gomodGenerator.RestoreOriginalGoMod()
		m.mu.Lock()
		m.updateStatusWithError(StatusError, err)
		m.mu.Unlock()
		return fmt.Errorf("failed to generate go.mod: %w", err)
	}

	// Run go mod tidy to update dependencies based on new main.go and go.mod (without lock)
	m.logger.Info("📦 Updating dependencies...")
	serverDir := filepath.Join(m.carrierRoot, "server")
	tidyCmd := exec.Command("go", "mod", "tidy")
	tidyCmd.Dir = serverDir
	tidyCmd.Env = os.Environ()
	tidyOutput, err := tidyCmd.CombinedOutput()
	if err != nil {
		m.logger.Error("Failed to run go mod tidy", "error", err)
		if len(tidyOutput) > 0 {
			m.logger.Error(string(tidyOutput))
		}
		// Don't fail on tidy errors, try building anyway
	}

	// Build server (without lock)
	m.logger.Info("🔨 Building server...")
	binaryPath, err := m.buildServer()
	if err != nil {
		// Restore both files on build failure
		m.generator.RestoreOriginalMain()
		m.gomodGenerator.RestoreOriginalGoMod()
		m.mu.Lock()
		m.updateStatusWithError(StatusError, err)
		m.mu.Unlock()
		return fmt.Errorf("failed to build server: %w", err)
	}

	// Store binary path (with lock for tempBinaryPath)
	m.mu.Lock()
	m.tempBinaryPath = binaryPath
	m.mu.Unlock()

	// Restore both original files after successful build
	if err := m.generator.RestoreOriginalMain(); err != nil {
		m.logger.Warn("Failed to restore original main.go", "error", err)
	}
	if err := m.gomodGenerator.RestoreOriginalGoMod(); err != nil {
		m.logger.Warn("Failed to restore original go.mod", "error", err)
	}

	// Launch server process (without lock)
	m.mu.Lock()
	port = m.port
	m.mu.Unlock()

	cmd := exec.Command(binaryPath,
		"-dev",
		"-port", fmt.Sprintf("%d", port),
		"-initial-path", path)

	// Inherit environment variables from TUI process (includes TMDB_API_KEY, etc.)
	// Always enable debug logging for dev server
	env := os.Environ()
	env = append(env, "DEBUG=1")
	cmd.Env = env

	// Set up log capture
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		m.mu.Lock()
		m.updateStatusWithError(StatusError, err)
		m.mu.Unlock()
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		m.mu.Lock()
		m.updateStatusWithError(StatusError, err)
		m.mu.Unlock()
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start the process
	if err := m.process.Start(cmd); err != nil {
		m.mu.Lock()
		m.updateStatusWithError(StatusError, err)
		m.mu.Unlock()
		return fmt.Errorf("failed to start server: %w", err)
	}

	// Start log capture goroutines
	go m.captureOutput(stdout, "stdout")
	go m.captureOutput(stderr, "stderr")

	// Monitor process health
	go m.monitorProcess()

	// Wait a moment for server to start
	time.Sleep(2 * time.Second)

	// Check if server started successfully
	if !m.process.IsRunning() {
		err := fmt.Errorf("server failed to start")
		m.logger.Error("❌ Server failed to start")
		m.mu.Lock()
		m.updateStatusWithError(StatusError, err)
		m.mu.Unlock()
		return err
	}

	m.mu.Lock()
	m.updateStatus(StatusRunning, path)
	m.mu.Unlock()
	m.logger.Info(fmt.Sprintf("✅ Dev server running on http://localhost:%d%s", port, path))

	// Browser will be opened automatically by the server with -dev flag

	return nil
}

// Restart restarts the server with a new path (or same path if empty)
func (m *Manager) Restart(path string) error {
	m.mu.Lock()

	// If path is empty, use current path
	if path == "" {
		path = m.currentPath
	}

	// Check if server was running or is already restarting
	wasRunning := m.status == StatusRunning || m.status == StatusRestarting
	m.mu.Unlock()

	if wasRunning {
		m.logger.Info("Restarting dev server", "path", path)

		// Update status to restarting
		m.mu.Lock()
		m.updateStatus(StatusRestarting, m.currentPath)
		m.mu.Unlock()

		// Stop the current server
		if err := m.Stop(); err != nil {
			m.logger.Warn("Error stopping server for restart", "error", err)
		}

		// Wait for port to be released
		time.Sleep(500 * time.Millisecond)
	}

	// Start with new path
	return m.Start(path)
}

// Stop stops the running dev server
func (m *Manager) Stop() error {
	m.mu.Lock()
	if m.status == StatusStopped {
		m.mu.Unlock()
		return nil
	}

	currentPath := m.currentPath
	tempBinary := m.tempBinaryPath
	m.mu.Unlock()

	m.logger.Info("Stopping dev server")
	m.logOutput("🛑 Stopping dev server...")

	// Stop the process (without lock - can take up to 5 seconds)
	if err := m.process.Stop(); err != nil {
		m.logger.Error("Failed to stop process", "error", err)
	}

	// Clean up temporary binary (without lock)
	if tempBinary != "" {
		if err := os.Remove(tempBinary); err != nil {
			m.logger.Warn("Failed to remove temp binary", "error", err)
		}
	}

	// Update status (with lock)
	m.mu.Lock()
	m.tempBinaryPath = ""
	m.updateStatus(StatusStopped, currentPath)
	m.mu.Unlock()

	m.logOutput("✅ Dev server stopped")

	return nil
}

// SetPathAsync initiates starting the server and returns immediately
func (m *Manager) SetPathAsync(path string) error {
	// Validate path
	if !strings.HasPrefix(path, "/") {
		return fmt.Errorf("path must start with /")
	}

	m.mu.Lock()
	// Check current status and bail if already starting
	if m.status == StatusStarting || m.status == StatusRestarting {
		m.mu.Unlock()
		return nil // Already in progress
	}

	currentStatus := m.status
	wasRunning := currentStatus == StatusRunning

	// Set pending status immediately for UI feedback
	if wasRunning {
		m.status = StatusRestarting
		m.currentPath = path
		m.logger.Debug("Setting status to Restarting")
	} else {
		// Set StatusStarting immediately for UI feedback
		m.status = StatusStarting
		m.currentPath = path
		m.logger.Debug("Setting status to Starting")
	}

	// Notify callback while still holding lock
	if m.statusCallback != nil {
		m.statusCallback(StatusInfo{
			Status:      m.status,
			CurrentPath: path,
			Port:        m.port,
		})
	}
	m.mu.Unlock()

	// Start the actual operation asynchronously
	go func() {
		if wasRunning {
			// Restart will handle its own status updates
			if err := m.Restart(path); err != nil {
				m.logger.Error("Failed to restart server", "error", err)
			}
		} else {
			// Start will now handle the StatusStarting case properly
			if err := m.Start(path); err != nil {
				m.logger.Error("Failed to start server", "error", err)
			}
		}
	}()

	return nil
}

// SetPath sets a new path and starts/restarts the server (backward compatibility)
func (m *Manager) SetPath(path string) error {
	return m.SetPathAsync(path)
}

// RestartAsync initiates restarting the server and returns immediately
func (m *Manager) RestartAsync(path string) error {
	m.mu.Lock()

	// Check if already in progress
	if m.status == StatusStarting || m.status == StatusRestarting {
		m.mu.Unlock()
		return nil // Already in progress
	}

	// If path is empty, use current path
	if path == "" {
		path = m.currentPath
	}

	currentStatus := m.status
	wasRunning := currentStatus == StatusRunning

	// Set pending status immediately for UI feedback
	if wasRunning {
		m.status = StatusRestarting
		m.currentPath = path
		m.logger.Debug("Setting status to Restarting")
	} else {
		m.status = StatusStarting
		m.currentPath = path
		m.logger.Debug("Setting status to Starting")
	}

	// Notify callback while still holding lock
	if m.statusCallback != nil {
		m.statusCallback(StatusInfo{
			Status:      m.status,
			CurrentPath: path,
			Port:        m.port,
		})
	}
	m.mu.Unlock()

	// Start the actual operation asynchronously
	go func() {
		if wasRunning {
			// Restart will handle stopping and then starting
			if err := m.Restart(path); err != nil {
				m.logger.Error("Failed to restart server", "error", err)
			}
		} else {
			// Start will handle the StatusStarting case properly
			if err := m.Start(path); err != nil {
				m.logger.Error("Failed to start server", "error", err)
			}
		}
	}()

	return nil
}

// buildServer builds the server binary
func (m *Manager) buildServer() (string, error) {
	tempDir := os.TempDir()
	binaryPath := filepath.Join(tempDir, fmt.Sprintf("icf-dev-server-%d", time.Now().Unix()))

	serverDir := filepath.Join(m.carrierRoot, "server")
	// Use nice to lower CPU priority so build doesn't block UI responsiveness
	cmd := exec.Command("nice", "-n", "10", "go", "build", "-o", binaryPath, ".")
	cmd.Dir = serverDir
	cmd.Env = os.Environ()

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Log build failure as ERROR level
		m.logger.Error("❌ Build failed")

		// Split and log each line of the build output for better visibility
		outputStr := string(output)
		if outputStr != "" {
			lines := strings.Split(strings.TrimSpace(outputStr), "\n")
			for _, line := range lines {
				if line != "" {
					// Log build errors at ERROR level for visibility
					m.logger.Error(line)
				}
			}
		}
		return "", fmt.Errorf("build failed: %w", err)
	}

	m.logger.Info("Server built successfully", "binary", binaryPath)
	return binaryPath, nil
}

// captureOutput captures and logs output from the server process
func (m *Manager) captureOutput(reader io.Reader, source string) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()

		// Skip empty lines to avoid clutter
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Log to database (which will be picked up by UI)
		// Log stderr as ERROR level for better visibility
		if source == "stderr" {
			// Check if it's actually an error or just info written to stderr
			if strings.Contains(strings.ToLower(line), "error") || strings.Contains(strings.ToLower(line), "failed") || strings.Contains(strings.ToLower(line), "fatal") {
				m.logger.Error(line)
			} else {
				m.logger.Warn(line)
			}
		} else {
			m.logger.Info(line)
		}

		// Also send to callback if set
		if m.logCallback != nil {
			m.logCallback(fmt.Sprintf("[%s] %s", source, line))
		}

		// Check for server ready message
		if strings.Contains(line, "Server starting on") {
			m.mu.Lock()
			if m.status == StatusStarting {
				m.updateStatus(StatusRunning, m.currentPath)
			}
			m.mu.Unlock()
		}
	}
}

// monitorProcess monitors the server process health
func (m *Manager) monitorProcess() {
	// Wait for process to exit
	err := m.process.Wait()

	m.mu.Lock()
	defer m.mu.Unlock()

	if m.status == StatusRunning || m.status == StatusStarting {
		// Unexpected exit
		m.logger.Error("Server process exited unexpectedly", "error", err)
		m.updateStatusWithError(StatusError, fmt.Errorf("server crashed: %v", err))
		m.logOutput("❌ Server crashed unexpectedly")
	}
}

// updateStatus updates the server status and notifies callback
func (m *Manager) updateStatus(status ServerStatus, path string) {
	m.status = status
	m.currentPath = path

	if m.statusCallback != nil {
		m.statusCallback(StatusInfo{
			Status:       status,
			CurrentPath:  path,
			Port:         m.port,
			PID:          m.process.GetPID(),
			ValidModules: m.validModules,
			TotalModules: m.totalModules,
		})
	}
}

// updateStatusWithError updates status with an error
func (m *Manager) updateStatusWithError(status ServerStatus, err error) {
	m.status = status

	if m.statusCallback != nil {
		m.statusCallback(StatusInfo{
			Status:       status,
			CurrentPath:  m.currentPath,
			Port:         m.port,
			PID:          0,
			Error:        err,
			ValidModules: m.validModules,
			TotalModules: m.totalModules,
		})
	}
}


// logOutput sends output to the log callback and logger
// Deprecated: Use m.logger directly for proper log levels
func (m *Manager) logOutput(msg string) {
	// Always log to the logger (which goes to database)
	m.logger.Info(msg)
	// Also send to callback if set (for any other use)
	if m.logCallback != nil {
		m.logCallback(msg)
	}
}