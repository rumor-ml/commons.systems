package finparse_test

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// TestIntegration_DryRun tests the complete flow from CLI invocation through scanning to output
func TestIntegration_DryRun(t *testing.T) {
	// Create temporary directory with test files
	tmpDir := t.TempDir()

	// Create directory structure: {institution}/{account}/{period}/file.ext
	instDir := filepath.Join(tmpDir, "american_express")
	acctDir := filepath.Join(instDir, "2011")
	periodDir := filepath.Join(acctDir, "2025-10")
	if err := os.MkdirAll(periodDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create test OFX file
	testFile := filepath.Join(periodDir, "statement.ofx")
	if err := os.WriteFile(testFile, []byte("test ofx content"), 0644); err != nil {
		t.Fatal(err)
	}

	// Build the binary
	binPath := buildFinparse(t)

	// Run CLI with -dry-run -verbose
	cmd := exec.Command(binPath, "-input", tmpDir, "-dry-run", "-verbose")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("CLI execution failed: %v\nOutput: %s", err, output)
	}

	outputStr := string(output)

	// Verify output contains:
	// - Correct file count
	if !strings.Contains(outputStr, "Found 1 statement files") {
		t.Errorf("Expected 'Found 1 statement files' in output, got:\n%s", outputStr)
	}

	// - Institution metadata
	if !strings.Contains(outputStr, "American Express") {
		t.Errorf("Expected institution name 'American Express' in output, got:\n%s", outputStr)
	}

	// - Account metadata
	if !strings.Contains(outputStr, "2011") {
		t.Errorf("Expected account number '2011' in output, got:\n%s", outputStr)
	}

	// - "Dry run complete" message
	if !strings.Contains(outputStr, "Dry run complete") {
		t.Errorf("Expected 'Dry run complete' message in output, got:\n%s", outputStr)
	}

	// - Shows would process files
	if !strings.Contains(outputStr, "Would process 1 files") {
		t.Errorf("Expected 'Would process 1 files' message in output, got:\n%s", outputStr)
	}
}

// TestIntegration_EmptyDirectory tests that CLI handles empty directories gracefully
func TestIntegration_EmptyDirectory(t *testing.T) {
	// Create empty temporary directory
	tmpDir := t.TempDir()

	// Build the binary
	binPath := buildFinparse(t)

	// Run against empty directory
	cmd := exec.Command(binPath, "-input", tmpDir, "-dry-run", "-verbose")
	output, err := cmd.CombinedOutput()

	// Verify exits without error
	if err != nil {
		t.Errorf("Expected successful exit for empty directory, got error: %v\nOutput: %s", err, output)
	}

	outputStr := string(output)

	// Verify "Found 0 files" message
	if !strings.Contains(outputStr, "Found 0 statement files") {
		t.Errorf("Expected 'Found 0 statement files' in output, got:\n%s", outputStr)
	}

	// Should still show dry run complete
	if !strings.Contains(outputStr, "Dry run complete") {
		t.Errorf("Expected 'Dry run complete' in output, got:\n%s", outputStr)
	}
}

// TestIntegration_MultipleFiles tests scanning multiple files with different institutions
func TestIntegration_MultipleFiles(t *testing.T) {
	tmpDir := t.TempDir()

	// Create multiple institution/account structures
	institutions := []struct {
		name    string
		account string
		format  string
	}{
		{"american_express", "2011", "ofx"},
		{"capital_one", "5678", "csv"},
		{"chase_bank", "9012", "qfx"},
	}

	for _, inst := range institutions {
		acctDir := filepath.Join(tmpDir, inst.name, inst.account)
		if err := os.MkdirAll(acctDir, 0755); err != nil {
			t.Fatal(err)
		}

		testFile := filepath.Join(acctDir, "statement."+inst.format)
		if err := os.WriteFile(testFile, []byte("test content"), 0644); err != nil {
			t.Fatal(err)
		}
	}

	// Build the binary
	binPath := buildFinparse(t)

	// Run with verbose output
	cmd := exec.Command(binPath, "-input", tmpDir, "-dry-run", "-verbose")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("CLI execution failed: %v\nOutput: %s", err, output)
	}

	outputStr := string(output)

	// Verify correct file count
	if !strings.Contains(outputStr, "Found 3 statement files") {
		t.Errorf("Expected 'Found 3 statement files' in output, got:\n%s", outputStr)
	}

	// Verify all institutions are shown
	if !strings.Contains(outputStr, "American Express") {
		t.Errorf("Expected 'American Express' in output, got:\n%s", outputStr)
	}
	if !strings.Contains(outputStr, "Capital One") {
		t.Errorf("Expected 'Capital One' in output, got:\n%s", outputStr)
	}
	if !strings.Contains(outputStr, "Chase Bank") {
		t.Errorf("Expected 'Chase Bank' in output, got:\n%s", outputStr)
	}

	// Verify all accounts are shown
	if !strings.Contains(outputStr, "2011") {
		t.Errorf("Expected account '2011' in output, got:\n%s", outputStr)
	}
	if !strings.Contains(outputStr, "5678") {
		t.Errorf("Expected account '5678' in output, got:\n%s", outputStr)
	}
	if !strings.Contains(outputStr, "9012") {
		t.Errorf("Expected account '9012' in output, got:\n%s", outputStr)
	}
}

// TestIntegration_RegistryIntegration tests that scanner metadata integrates with registry
func TestIntegration_RegistryIntegration(t *testing.T) {
	tmpDir := t.TempDir()

	// Create test file
	instDir := filepath.Join(tmpDir, "test_bank")
	acctDir := filepath.Join(instDir, "1234")
	if err := os.MkdirAll(acctDir, 0755); err != nil {
		t.Fatal(err)
	}

	testFile := filepath.Join(acctDir, "statement.ofx")
	if err := os.WriteFile(testFile, []byte("test content"), 0644); err != nil {
		t.Fatal(err)
	}

	// Build the binary
	binPath := buildFinparse(t)

	// Run with verbose to see registry output
	cmd := exec.Command(binPath, "-input", tmpDir, "-dry-run", "-verbose")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("CLI execution failed: %v\nOutput: %s", err, output)
	}

	outputStr := string(output)

	// Verify registry is initialized (shows registered parsers)
	if !strings.Contains(outputStr, "Registered parsers:") {
		t.Errorf("Expected 'Registered parsers:' in output, got:\n%s", outputStr)
	}

	// Verify metadata from scanner is displayed
	if !strings.Contains(outputStr, "Test Bank") {
		t.Errorf("Expected normalized institution name 'Test Bank' in output, got:\n%s", outputStr)
	}
	if !strings.Contains(outputStr, "1234") {
		t.Errorf("Expected account number '1234' in output, got:\n%s", outputStr)
	}
}

// TestIntegration_FileCountDisplay tests the statement file count message formatting
func TestIntegration_FileCountDisplay(t *testing.T) {
	tests := []struct {
		name        string
		fileCount   int
		expectedMsg string
	}{
		{
			name:        "zero files",
			fileCount:   0,
			expectedMsg: "Found 0 statement files",
		},
		{
			name:        "one file",
			fileCount:   1,
			expectedMsg: "Found 1 statement files", // Current implementation doesn't fix pluralization
		},
		{
			name:        "two files",
			fileCount:   2,
			expectedMsg: "Found 2 statement files",
		},
		{
			name:        "five files",
			fileCount:   5,
			expectedMsg: "Found 5 statement files",
		},
		{
			name:        "ten files",
			fileCount:   10,
			expectedMsg: "Found 10 statement files",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tmpDir := t.TempDir()

			// Create specified number of statement files
			for i := 0; i < tt.fileCount; i++ {
				instDir := filepath.Join(tmpDir, fmt.Sprintf("bank_%d", i))
				acctDir := filepath.Join(instDir, strconv.Itoa(1000+i))
				if err := os.MkdirAll(acctDir, 0755); err != nil {
					t.Fatal(err)
				}

				testFile := filepath.Join(acctDir, "statement.ofx")
				if err := os.WriteFile(testFile, []byte("test content"), 0644); err != nil {
					t.Fatal(err)
				}
			}

			// Build the binary
			binPath := buildFinparse(t)

			// Run with verbose to see file count message
			cmd := exec.Command(binPath, "-input", tmpDir, "-dry-run", "-verbose")
			output, err := cmd.CombinedOutput()

			if err != nil {
				t.Fatalf("CLI execution failed: %v\nOutput: %s", err, output)
			}

			outputStr := string(output)

			// Verify expected count message is present
			if !strings.Contains(outputStr, tt.expectedMsg) {
				t.Errorf("Expected message %q in output, got:\n%s", tt.expectedMsg, outputStr)
			}

			// Additional verification: ensure count accuracy by checking actual file list
			if tt.fileCount > 0 {
				// Count the number of institution lines in verbose output
				// Each file should have a line like "  - /path/to/file (institution: X, account: Y)"
				institutionLines := 0
				for _, line := range strings.Split(outputStr, "\n") {
					if strings.Contains(line, "(institution:") && strings.Contains(line, "account:") {
						institutionLines++
					}
				}

				if institutionLines != tt.fileCount {
					t.Errorf("Expected %d institution lines in output, found %d. Output:\n%s",
						tt.fileCount, institutionLines, outputStr)
				}
			}
		})
	}
}

// buildFinparse builds and returns the path to a fresh finparse binary
// Builds to a temporary directory to ensure tests always run against current code
func buildFinparse(t *testing.T) string {
	t.Helper()

	finparseRoot := getFinparseRoot(t)
	tmpBin := filepath.Join(t.TempDir(), "finparse")

	// Build fresh binary for this test
	cmd := exec.Command("go", "build", "-o", tmpBin, "./cmd/finparse")
	cmd.Dir = finparseRoot

	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to build finparse: %v\nOutput: %s", err, output)
	}

	return tmpBin
}

// getFinparseRoot finds the finparse module root directory
func getFinparseRoot(t *testing.T) string {
	t.Helper()

	// Start from current directory
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}

	// Walk up to find the finparse directory containing go.mod
	for {
		// Check if this directory contains finparse-specific go.mod
		goModPath := filepath.Join(dir, "go.mod")
		if _, err := os.Stat(goModPath); err == nil {
			content, err := os.ReadFile(goModPath)
			if err != nil {
				t.Fatal(err)
			}
			// Check if this is finparse module (not the root commons.systems module)
			if strings.Contains(string(content), "module github.com/rumor-ml/commons.systems/finparse") {
				return dir
			}
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("Could not find finparse module root")
		}
		dir = parent
	}
}
