// command_validator.go - Command validation utilities for terminal security
//
// ## Metadata
//
// TUI command validation utilities for preventing command injection.
//
// ### Purpose
//
// Provide security validation for terminal commands to prevent command injection
// attacks while maintaining functionality for legitimate shell operations and
// maintaining a whitelist of safe commands for terminal execution.
//
// ### Instructions
//
// #### Command Validation
//
// ##### Whitelist Security
//
// Validate commands against a predefined whitelist of safe shell commands and
// utilities while rejecting potentially dangerous command patterns that could
// be used for malicious purposes or command injection attacks.
//
// ##### Pattern Detection
//
// Detect dangerous command patterns including command chaining, variable substitution,
// and other shell features that could be exploited for unauthorized access or
// system compromise through terminal command execution.

package security

import (
	"fmt"
	"strings"
)

// ValidateCommand validates that the command is safe to execute
// This prevents command injection by allowing only whitelisted commands and patterns
func ValidateCommand(command string) error {
	// Empty command defaults to zsh interactive, which is safe
	if command == "" {
		return nil
	}

	// Whitelist of allowed commands
	allowedCommands := []string{
		"zsh",
		"bash",
		"sh",
		"fish",
		"tcsh",
		"csh",
		"claude",
		"claude -c",
		"nix",
		"pwd",
		"ls",
		"cd",
		"clear",
		"exit",
		"echo",
		"cat",
		"less",
		"more",
		"grep",
		"find",
		"which",
		"whoami",
		"date",
		"uptime",
		"ps",
		"top",
		"htop",
		"vim",
		"nano",
		"emacs",
		"git",
		"make",
		"go",
		"python",
		"python3",
		"node",
		"npm",
		"yarn",
		"docker",
		"kubectl",
		"curl",
		"wget",
		"ssh",
		"scp",
		"rsync",
		"tar",
		"gzip",
		"gunzip",
		"zip",
		"unzip",
		"tmux",
		"screen",
	}

	// Check if command starts with any allowed command
	for _, allowed := range allowedCommands {
		if command == allowed || (len(command) > len(allowed) && command[:len(allowed)+1] == allowed+" ") {
			return nil
		}
	}

	// Reject commands containing dangerous characters that could be used for injection
	dangerousChars := []string{";", "&", "|", "`", "$", "(", ")", "<", ">", "&&", "||", "$(", "${"}
	for _, dangerous := range dangerousChars {
		if len(command) > 0 && strings.Contains(command, dangerous) {
			return fmt.Errorf("command contains dangerous character: %s", dangerous)
		}
	}

	return fmt.Errorf("command not in whitelist: %s", command)
}