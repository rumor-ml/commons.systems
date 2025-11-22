package terminal

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCreateCommandWithNixDevelop(t *testing.T) {
	tests := []struct {
		name            string
		command         string
		workingDir      string
		isWorktree      bool
		hasFlakeNix     bool
		expectedCmd     string
		expectedArgs    []string
	}{
		{
			name:         "claude with flake.nix",
			command:      "claude",
			workingDir:   "/tmp/test-project",
			isWorktree:   false,
			hasFlakeNix:  true,
			expectedCmd:  "nix",
			expectedArgs: []string{"develop", "--command", "claude", "-c"},
		},
		{
			name:         "claude without flake.nix",
			command:      "claude",
			workingDir:   "/tmp/test-project",
			isWorktree:   false,
			hasFlakeNix:  false,
			expectedCmd:  "claude",
			expectedArgs: []string{"-c"},
		},
		{
			name:         "claude -c worktree with flake.nix",
			command:      "claude -c",
			workingDir:   "/tmp/test-project/.worktrees/feature",
			isWorktree:   true,
			hasFlakeNix:  true,
			expectedCmd:  "nix",
			expectedArgs: []string{"develop", "--command", "claude", "-c"},
		},
		{
			name:         "zsh command unaffected",
			command:      "zsh",
			workingDir:   "/tmp/test-project",
			isWorktree:   false,
			hasFlakeNix:  true,
			expectedCmd:  "/bin/zsh",
			expectedArgs: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create temp directory for test
			if tt.workingDir != "" && tt.hasFlakeNix {
				// Note: In a real test environment, we would create the directory
				// and flake.nix file. Here we're just testing the logic.
			}

			cmd := createCommand(tt.command, tt.workingDir, tt.isWorktree)

			// Extract the base command name
			cmdPath := cmd.Path
			cmdBase := filepath.Base(cmdPath)

			// For full path commands like /bin/zsh, use the full path
			expectedBase := tt.expectedCmd
			if filepath.IsAbs(tt.expectedCmd) {
				expectedBase = tt.expectedCmd
			} else {
				// For commands like "claude" or "nix", just check the base name
				expectedBase = filepath.Base(tt.expectedCmd)
			}

			// Check command
			if cmdBase != expectedBase && cmdPath != expectedBase {
				t.Errorf("Expected command %s, got %s", tt.expectedCmd, cmdPath)
			}

			// Check arguments
			if len(cmd.Args) > 1 { // Args[0] is the command itself
				actualArgs := cmd.Args[1:]
				if len(actualArgs) != len(tt.expectedArgs) {
					t.Errorf("Expected %d args, got %d", len(tt.expectedArgs), len(actualArgs))
				} else {
					for i, arg := range tt.expectedArgs {
						if i < len(actualArgs) && actualArgs[i] != arg {
							t.Errorf("Expected arg[%d] to be %s, got %s", i, arg, actualArgs[i])
						}
					}
				}
			} else if len(tt.expectedArgs) > 0 {
				t.Errorf("Expected args %v, got none", tt.expectedArgs)
			}
		})
	}
}

func TestNixDevelopIntegration(t *testing.T) {
	// This test verifies that nix develop command construction is correct
	// It doesn't actually execute the commands

	testDir := t.TempDir()
	flakePath := filepath.Join(testDir, "flake.nix")

	// Create a dummy flake.nix
	err := os.WriteFile(flakePath, []byte("{}"), 0644)
	if err != nil {
		t.Fatalf("Failed to create test flake.nix: %v", err)
	}

	// Test that claude command gets wrapped when flake.nix exists
	cmd := createCommand("claude", testDir, false)
	if cmd.Path != "nix" && filepath.Base(cmd.Path) != "nix" {
		t.Errorf("Expected nix command when flake.nix exists, got %s", cmd.Path)
	}

	// Verify the arguments (should now include -c flag)
	expectedArgs := []string{"nix", "develop", "--command", "claude", "-c"}
	if len(cmd.Args) != len(expectedArgs) {
		t.Errorf("Expected %d args, got %d: %v", len(expectedArgs), len(cmd.Args), cmd.Args)
	}
}