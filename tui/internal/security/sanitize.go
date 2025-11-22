// Package security provides security utilities for the ICF TUI
package security

import (
	"fmt"
	"path/filepath"
	"strings"
	"unicode"
)

// ShellEscape escapes a string for safe use in shell commands
// This prevents command injection by properly escaping special characters
func ShellEscape(s string) string {
	if s == "" {
		return "''"
	}

	// Check if string needs escaping
	needsEscape := false
	for _, r := range s {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) &&
			r != '-' && r != '_' && r != '.' && r != '/' {
			needsEscape = true
			break
		}
	}

	if !needsEscape {
		return s
	}

	// Use single quotes and escape any single quotes in the string
	// Single quotes prevent all expansions except for the single quote itself
	escaped := strings.ReplaceAll(s, "'", "'\"'\"'")
	return "'" + escaped + "'"
}

// ShellEscapeArgs escapes multiple arguments for shell commands
func ShellEscapeArgs(args []string) []string {
	escaped := make([]string, len(args))
	for i, arg := range args {
		escaped[i] = ShellEscape(arg)
	}
	return escaped
}

// ValidatePath validates and normalizes a file path
// It prevents directory traversal attacks and ensures paths are within bounds
func ValidatePath(path string, allowedRoot string) (string, error) {
	// Clean the allowed root first
	cleanRoot := filepath.Clean(allowedRoot)
	absRoot, err := filepath.Abs(cleanRoot)
	if err != nil {
		return "", fmt.Errorf("invalid root path: %w", err)
	}

	// Clean the path
	cleanPath := filepath.Clean(path)

	// If path is relative, join it with the allowed root
	var absPath string
	if filepath.IsAbs(cleanPath) {
		absPath = cleanPath
	} else {
		// Join relative path with allowed root
		absPath = filepath.Join(absRoot, cleanPath)
	}

	// Normalize the path
	absPath = filepath.Clean(absPath)

	// Check if path is within allowed root
	relPath, err := filepath.Rel(absRoot, absPath)
	if err != nil {
		return "", fmt.Errorf("path validation failed: %w", err)
	}

	// Check for directory traversal
	if strings.HasPrefix(relPath, "..") || strings.Contains(relPath, "../") {
		return "", fmt.Errorf("path traversal detected: %s is outside %s", absPath, absRoot)
	}

	return absPath, nil
}

// ValidateCommand checks if a command is in the allowed list
func ValidateCommand(cmd string, allowedCommands []string) error {
	for _, allowed := range allowedCommands {
		if cmd == allowed {
			return nil
		}
	}
	return fmt.Errorf("command not allowed: %s", cmd)
}

// SanitizeWindowName removes potentially dangerous characters from window names
func SanitizeWindowName(name string) string {
	// Allow only alphanumeric, dash, underscore, and dot
	var result strings.Builder
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) ||
			r == '-' || r == '_' || r == '.' {
			result.WriteRune(r)
		} else {
			result.WriteRune('_')
		}
	}
	return result.String()
}

// SanitizeSessionName removes potentially dangerous characters from session names
func SanitizeSessionName(name string) string {
	// Tmux session names have specific requirements
	// They cannot contain colons or dots
	sanitized := SanitizeWindowName(name)
	sanitized = strings.ReplaceAll(sanitized, ".", "_")
	sanitized = strings.ReplaceAll(sanitized, ":", "_")
	return sanitized
}

// AllowedTmuxCommands defines the whitelist of allowed tmux commands
var AllowedTmuxCommands = []string{
	"list-sessions",
	"list-windows",
	"list-panes",
	"new-session",
	"new-window",
	"kill-session",
	"kill-window",
	"attach-session",
	"switch-client",
	"select-pane",
	"display-message",
	"has-session",
	"bind-key",
	"run-shell", // Careful with this one - validate the shell command separately
}

// ValidateTmuxCommand validates a tmux command is allowed
func ValidateTmuxCommand(cmd string) error {
	// Extract the base command (first argument after tmux)
	parts := strings.Fields(cmd)
	if len(parts) < 1 {
		return fmt.Errorf("empty command")
	}

	baseCmd := parts[0]
	return ValidateCommand(baseCmd, AllowedTmuxCommands)
}
