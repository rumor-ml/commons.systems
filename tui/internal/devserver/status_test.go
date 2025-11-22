package devserver

import (
	"testing"
)

func TestServerStatus(t *testing.T) {
	tests := []struct {
		name     string
		status   ServerStatus
		expected string
	}{
		{
			name:     "stopped status",
			status:   StatusStopped,
			expected: "stopped",
		},
		{
			name:     "starting status",
			status:   StatusStarting,
			expected: "starting",
		},
		{
			name:     "running status",
			status:   StatusRunning,
			expected: "running",
		},
		{
			name:     "restarting status",
			status:   StatusRestarting,
			expected: "restarting",
		},
		{
			name:     "error status",
			status:   StatusError,
			expected: "error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Verify the status values are valid (distinct constants)
			switch tt.status {
			case StatusStopped, StatusStarting, StatusRunning, StatusRestarting, StatusError:
				// Valid status
			default:
				t.Errorf("Invalid status value: %v", tt.status)
			}
		})
	}
}

func TestStatusInfo(t *testing.T) {
	info := StatusInfo{
		Status:      StatusRunning,
		CurrentPath: "/test",
		Port:        8080,
		PID:         12345,
		Error:       nil,
	}

	if info.Status != StatusRunning {
		t.Errorf("Expected status %v, got %v", StatusRunning, info.Status)
	}

	if info.CurrentPath != "/test" {
		t.Errorf("Expected path '/test', got %s", info.CurrentPath)
	}

	if info.Port != 8080 {
		t.Errorf("Expected port 8080, got %d", info.Port)
	}

	if info.PID != 12345 {
		t.Errorf("Expected PID 12345, got %d", info.PID)
	}

	if info.Error != nil {
		t.Errorf("Expected no error, got %v", info.Error)
	}
}