package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/commons-systems/tmux-tui/internal/daemon"
	"github.com/commons-systems/tmux-tui/internal/debug"
	"github.com/commons-systems/tmux-tui/internal/namespace"
)

func main() {
	// Check for health subcommand
	if len(os.Args) > 1 && os.Args[1] == "health" {
		if err := showHealth(); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to get health status: %v\n", err)
			os.Exit(1)
		}
		os.Exit(0)
	}

	// Auto-detect namespace from $TMUX environment variable
	ns := namespace.GetSessionNamespace()
	debug.Log("DAEMON_MAIN namespace=%s", ns)

	// Check if daemon is already running
	socketPath := namespace.DaemonSocket()
	if _, err := os.Stat(socketPath); err == nil {
		// Socket exists - daemon may be running
		// Try to connect to verify
		if isDaemonRunning(socketPath) {
			fmt.Fprintf(os.Stderr, "Daemon already running at %s\n", socketPath)
			os.Exit(0)
		}
		// Stale socket - remove it
		debug.Log("DAEMON_MAIN removing stale socket=%s", socketPath)
		os.Remove(socketPath)
	}

	// Create and start daemon
	d, err := daemon.NewAlertDaemon()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create daemon: %v\n", err)
		os.Exit(1)
	}

	if err := d.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start daemon: %v\n", err)
		os.Exit(1)
	}

	// Handle signals for graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	fmt.Printf("Daemon started (namespace: %s)\n", ns)
	debug.Log("DAEMON_MAIN started namespace=%s", ns)

	// Wait for signal
	sig := <-sigCh
	debug.Log("DAEMON_MAIN signal=%v", sig)
	fmt.Printf("Received signal %v, shutting down...\n", sig)

	// Stop daemon
	if err := d.Stop(); err != nil {
		fmt.Fprintf(os.Stderr, "Error stopping daemon: %v\n", err)
		os.Exit(1)
	}

	debug.Log("DAEMON_MAIN stopped")
	fmt.Println("Daemon stopped")
}

// isDaemonRunning checks if the daemon is running by attempting to connect to the socket.
func isDaemonRunning(socketPath string) bool {
	// Simple check - try to create a client and connect
	client := daemon.NewDaemonClient()
	if err := client.Connect(); err == nil {
		client.Close()
		return true
	}
	return false
}

// showHealth connects to the daemon and displays health metrics
func showHealth() error {
	socketPath := namespace.DaemonSocket()

	// Connect to daemon socket
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		return fmt.Errorf("failed to connect to daemon: %w", err)
	}
	defer conn.Close()

	encoder := json.NewEncoder(conn)
	decoder := json.NewDecoder(conn)

	// Send health query
	query := daemon.Message{
		Type: daemon.MsgTypeHealthQuery,
	}
	if err := encoder.Encode(query); err != nil {
		return fmt.Errorf("failed to send health query: %w", err)
	}

	// Wait for response with timeout
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var msg daemon.Message
	if err := decoder.Decode(&msg); err != nil {
		return fmt.Errorf("failed to receive health response: %w", err)
	}

	if msg.Type != daemon.MsgTypeHealthResponse {
		return fmt.Errorf("unexpected response type: %s", msg.Type)
	}
	if msg.HealthStatus == nil {
		return fmt.Errorf("health response missing status data")
	}

	// Display health status
	displayHealthStatus(*msg.HealthStatus)
	return nil
}

// displayHealthStatus formats and prints health metrics
func displayHealthStatus(status daemon.HealthStatus) {
	fmt.Printf("Daemon Health Status (as of %s)\n", status.Timestamp.Format("2006-01-02 15:04:05"))
	fmt.Println("============================================================")
	fmt.Println()

	// Connections
	fmt.Println("Connections:")
	fmt.Printf("  Connected Clients: %d\n", status.ConnectedClients)
	fmt.Printf("  Broadcast Failures: %d\n", status.BroadcastFailures)
	if status.LastBroadcastError != "" {
		fmt.Printf("  Last Broadcast Error: %s\n", status.LastBroadcastError)
	}
	fmt.Println()

	// Watchers
	fmt.Println("Watchers:")
	fmt.Printf("  Watcher Errors: %d\n", status.WatcherErrors)
	if status.LastWatcherError != "" {
		fmt.Printf("  Last Watcher Error: %s\n", status.LastWatcherError)
	}
	fmt.Println()

	// State
	fmt.Println("State:")
	fmt.Printf("  Active Alerts: %d\n", status.ActiveAlerts)
	fmt.Printf("  Blocked Branches: %d\n", status.BlockedBranches)
	fmt.Println()

	// Health assessment
	assessment := assessHealth(status)
	if assessment == "healthy" {
		fmt.Println("Status: ✓ Healthy")
	} else {
		fmt.Printf("Status: ⚠ %s\n", assessment)
	}
}

// assessHealth determines overall health based on thresholds
func assessHealth(status daemon.HealthStatus) string {
	warnings := []string{}

	if status.BroadcastFailures > 10 {
		warnings = append(warnings, "High broadcast failures")
	}
	if status.WatcherErrors > 5 {
		warnings = append(warnings, "High watcher errors")
	}
	if status.ConnectedClients == 0 {
		warnings = append(warnings, "No connected clients")
	}

	if len(warnings) == 0 {
		return "healthy"
	}
	return fmt.Sprintf("Warning: %s", warnings[0])
}
