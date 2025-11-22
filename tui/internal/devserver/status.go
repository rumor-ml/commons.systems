// Package devserver provides dev server management for the ICF TUI.
package devserver

// ServerStatus represents the current state of the dev server
type ServerStatus string

const (
	StatusStopped    ServerStatus = "stopped"
	StatusStarting   ServerStatus = "starting"
	StatusRunning    ServerStatus = "running"
	StatusRestarting ServerStatus = "restarting"
	StatusError      ServerStatus = "error"
)

// StatusInfo contains the current status and metadata of the dev server
type StatusInfo struct {
	Status       ServerStatus
	CurrentPath  string
	Port         int
	PID          int
	Error        error
	ValidModules int // Number of valid modules loaded
	TotalModules int // Total number of modules discovered
}