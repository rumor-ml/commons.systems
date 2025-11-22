package security

import (
	"path/filepath"
	"testing"
)

func TestShellEscape(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"empty", "", "''"},
		{"simple", "hello", "hello"},
		{"with space", "hello world", "'hello world'"},
		{"with quote", "it's", "'it'\"'\"'s'"},
		{"with semicolon", "cmd1; cmd2", "'cmd1; cmd2'"},
		{"with pipe", "cmd1 | cmd2", "'cmd1 | cmd2'"},
		{"with redirect", "cmd > file", "'cmd > file'"},
		{"with backtick", "cmd `evil`", "'cmd `evil`'"},
		{"with dollar", "cmd $VAR", "'cmd $VAR'"},
		{"path", "/usr/local/bin", "/usr/local/bin"},
		{"complex", "'; rm -rf /; echo '", "''\"'\"'; rm -rf /; echo '\"'\"''"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := ShellEscape(tt.input)
			if result != tt.expected {
				t.Errorf("ShellEscape(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestValidatePath(t *testing.T) {
	// Create a temp directory for testing
	tempDir := t.TempDir()

	tests := []struct {
		name        string
		path        string
		allowedRoot string
		wantErr     bool
		errContains string
	}{
		{
			name:        "valid relative path",
			path:        "subdir/file.txt",
			allowedRoot: tempDir,
			wantErr:     false,
		},
		{
			name:        "valid absolute path",
			path:        filepath.Join(tempDir, "subdir", "file.txt"),
			allowedRoot: tempDir,
			wantErr:     false,
		},
		{
			name:        "directory traversal attempt",
			path:        "../../../etc/passwd",
			allowedRoot: tempDir,
			wantErr:     true,
			errContains: "path traversal detected",
		},
		{
			name:        "sneaky traversal",
			path:        "subdir/../../outside",
			allowedRoot: tempDir,
			wantErr:     true,
			errContains: "path traversal detected",
		},
		{
			name:        "absolute path outside root",
			path:        "/etc/passwd",
			allowedRoot: tempDir,
			wantErr:     true,
			errContains: "path traversal detected",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := ValidatePath(tt.path, tt.allowedRoot)
			if tt.wantErr {
				if err == nil {
					t.Errorf("ValidatePath(%q, %q) expected error, got nil", tt.path, tt.allowedRoot)
				} else if tt.errContains != "" && !contains(err.Error(), tt.errContains) {
					t.Errorf("ValidatePath(%q, %q) error = %v, want error containing %q",
						tt.path, tt.allowedRoot, err, tt.errContains)
				}
			} else {
				if err != nil {
					t.Errorf("ValidatePath(%q, %q) unexpected error: %v", tt.path, tt.allowedRoot, err)
				}
				// Result should be an absolute path within the allowed root
				if result != "" && !filepath.IsAbs(result) {
					t.Errorf("ValidatePath(%q, %q) = %q, expected absolute path",
						tt.path, tt.allowedRoot, result)
				}
			}
		})
	}
}

func TestSanitizeWindowName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"simple", "window1", "window1"},
		{"with dash", "my-window", "my-window"},
		{"with underscore", "my_window", "my_window"},
		{"with space", "my window", "my_window"},
		{"with special", "window!@#$", "window____"},
		{"with semicolon", "win;dow", "win_dow"},
		{"unicode", "fenêtre", "fenêtre"},
		{"mixed", "win-123_test.log", "win-123_test.log"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := SanitizeWindowName(tt.input)
			if result != tt.expected {
				t.Errorf("SanitizeWindowName(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestSanitizeSessionName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{"simple", "session1", "session1"},
		{"with colon", "session:1", "session_1"},
		{"with dot", "session.1", "session_1"},
		{"complex", "my:session.name", "my_session_name"},
		{"icf prefix", "icf-project", "icf-project"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := SanitizeSessionName(tt.input)
			if result != tt.expected {
				t.Errorf("SanitizeSessionName(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestValidateTmuxCommand(t *testing.T) {
	tests := []struct {
		name    string
		command string
		wantErr bool
	}{
		{"list-sessions", "list-sessions", false},
		{"list-windows with args", "list-windows -t session", false},
		{"new-window", "new-window -n mywindow", false},
		{"invalid command", "exec-evil-command", true},
		{"empty", "", true},
		{"rm command", "rm -rf /", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTmuxCommand(tt.command)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateTmuxCommand(%q) error = %v, wantErr %v",
					tt.command, err, tt.wantErr)
			}
		})
	}
}

func contains(s, substr string) bool {
	return len(substr) > 0 && len(s) >= len(substr) &&
		(s == substr || s[0:len(substr)] == substr ||
			s[len(s)-len(substr):] == substr ||
			len(s) > len(substr) && (findSubstring(s, substr) != -1))
}

func findSubstring(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
