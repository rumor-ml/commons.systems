package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestMain_RequiredFlags tests that missing -input flag shows error and usage
func TestMain_RequiredFlags(t *testing.T) {
	// Build the binary
	tmpBin := filepath.Join(t.TempDir(), "finparse")
	buildCmd := exec.Command("go", "build", "-o", tmpBin, ".")
	buildCmd.Dir = filepath.Join("..", "..", "cmd", "finparse")
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to build binary: %v\nOutput: %s", err, output)
	}

	// Run without -input flag
	cmd := exec.Command(tmpBin)
	output, err := cmd.CombinedOutput()

	// Should exit with error
	if err == nil {
		t.Fatal("Expected non-zero exit code when -input flag missing")
	}

	// Check exit code is 1
	exitErr, ok := err.(*exec.ExitError)
	if !ok {
		t.Fatalf("Expected ExitError, got %T", err)
	}
	if exitErr.ExitCode() != 1 {
		t.Errorf("Expected exit code 1, got %d", exitErr.ExitCode())
	}

	// Should show error message
	outputStr := string(output)
	if !strings.Contains(outputStr, "Error: -input flag is required") {
		t.Errorf("Expected error message about required -input flag, got:\n%s", outputStr)
	}

	// Should show usage
	if !strings.Contains(outputStr, "Usage:") {
		t.Errorf("Expected usage message, got:\n%s", outputStr)
	}
}

// TestMain_VersionFlag tests that -version prints version and exits 0
func TestMain_VersionFlag(t *testing.T) {
	// Build the binary
	tmpBin := filepath.Join(t.TempDir(), "finparse")
	buildCmd := exec.Command("go", "build", "-o", tmpBin, ".")
	buildCmd.Dir = filepath.Join("..", "..", "cmd", "finparse")
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to build binary: %v\nOutput: %s", err, output)
	}

	// Run with -version flag
	cmd := exec.Command(tmpBin, "-version")
	output, err := cmd.CombinedOutput()

	// Should exit with success
	if err != nil {
		t.Fatalf("Expected zero exit code for -version flag, got error: %v\nOutput:\n%s", err, output)
	}

	// Should print version
	outputStr := string(output)
	if !strings.Contains(outputStr, "finparse version") {
		t.Errorf("Expected version output, got:\n%s", outputStr)
	}
	if !strings.Contains(outputStr, "0.1.0") {
		t.Errorf("Expected version 0.1.0 in output, got:\n%s", outputStr)
	}
}

// TestMain_ErrorExitCode tests that run() errors cause main() to exit with code 1
func TestMain_ErrorExitCode(t *testing.T) {
	// Build the binary
	tmpBin := filepath.Join(t.TempDir(), "finparse")
	buildCmd := exec.Command("go", "build", "-o", tmpBin, ".")
	buildCmd.Dir = filepath.Join("..", "..", "cmd", "finparse")
	if output, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("Failed to build binary: %v\nOutput: %s", err, output)
	}

	// Run with invalid directory (this triggers run() error -> os.Exit(1) path)
	cmd := exec.Command(tmpBin, "-input", "/nonexistent/path")
	err := cmd.Run()

	// Should exit with error
	exitErr, ok := err.(*exec.ExitError)
	if !ok {
		t.Fatal("Expected ExitError for invalid directory")
	}
	if exitErr.ExitCode() != 1 {
		t.Errorf("Expected exit code 1, got %d", exitErr.ExitCode())
	}
}

// withFlags is a test helper that temporarily sets flag values and restores them after the test.
func withFlags(t *testing.T, input string, dryRunVal, verboseVal bool) func() {
	t.Helper()
	origInput := *inputDir
	origDryRun := *dryRun
	origVerbose := *verbose

	*inputDir = input
	*dryRun = dryRunVal
	*verbose = verboseVal

	return func() {
		*inputDir = origInput
		*dryRun = origDryRun
		*verbose = origVerbose
	}
}

// TestRun_InvalidInputDir tests error handling for invalid input directories
func TestRun_InvalidInputDir(t *testing.T) {
	defer withFlags(t, "", true, false)()

	t.Run("non-existent directory", func(t *testing.T) {
		*inputDir = "/nonexistent/directory/that/does/not/exist"

		// Run should fail
		err := run()
		if err == nil {
			t.Error("Expected error for non-existent directory, got nil")
		}
		if err != nil && !strings.Contains(err.Error(), "failed to scan directory") {
			t.Errorf("Expected error containing 'failed to scan directory', got: %v", err)
		}
	})
}

// TestRun_ValidDirectory tests successful execution with valid directory
func TestRun_ValidDirectory(t *testing.T) {
	// Create temp directory structure
	tmpDir := t.TempDir()
	instDir := filepath.Join(tmpDir, "test_bank")
	acctDir := filepath.Join(instDir, "1234")
	if err := os.MkdirAll(acctDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a test statement file
	testFile := filepath.Join(acctDir, "statement.ofx")
	if err := os.WriteFile(testFile, []byte("test content"), 0644); err != nil {
		t.Fatal(err)
	}

	defer withFlags(t, tmpDir, true, false)()

	// Run should succeed
	err := run()
	if err != nil {
		t.Errorf("Expected no error with valid directory, got: %v", err)
	}
}

// TestRun_EmptyDirectory tests execution with empty directory
func TestRun_EmptyDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	defer withFlags(t, tmpDir, true, false)()

	// Run should succeed (no files found is not an error)
	err := run()
	if err != nil {
		t.Errorf("Expected no error with empty directory, got: %v", err)
	}
}

// TestRun_VerboseOutput tests verbose flag produces output
func TestRun_VerboseOutput(t *testing.T) {
	// Create temp directory structure
	tmpDir := t.TempDir()
	instDir := filepath.Join(tmpDir, "test_bank")
	acctDir := filepath.Join(instDir, "1234")
	if err := os.MkdirAll(acctDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a test statement file
	testFile := filepath.Join(acctDir, "statement.csv")
	if err := os.WriteFile(testFile, []byte("test content"), 0644); err != nil {
		t.Fatal(err)
	}

	defer withFlags(t, tmpDir, true, true)()

	// Capture stdout
	// TODO(#1278): Check errors from pipe creation and reading
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	// Run
	err := run()

	// Restore stdout
	w.Close()
	os.Stdout = oldStdout

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Read captured output
	output := make([]byte, 4096)
	n, _ := r.Read(output)
	outputStr := string(output[:n])

	// Verify verbose output
	if !strings.Contains(outputStr, "Scanning directory:") {
		t.Errorf("Expected verbose output to contain 'Scanning directory:', got:\n%s", outputStr)
	}
	if !strings.Contains(outputStr, "Found") && !strings.Contains(outputStr, "statement files") {
		t.Errorf("Expected verbose output to show file count, got:\n%s", outputStr)
	}
}

// TestRun_NonVerboseSuccess tests the default non-verbose success path
func TestRun_NonVerboseSuccess(t *testing.T) {
	// Create temp directory structure
	tmpDir := t.TempDir()
	instDir := filepath.Join(tmpDir, "test_bank")
	acctDir := filepath.Join(instDir, "1234")
	if err := os.MkdirAll(acctDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a test statement file
	testFile := filepath.Join(acctDir, "statement.ofx")
	if err := os.WriteFile(testFile, []byte("test content"), 0644); err != nil {
		t.Fatal(err)
	}

	// Set flags: non-dry-run, non-verbose (most common production usage)
	defer withFlags(t, tmpDir, false, false)()

	// Capture stdout
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	// Run
	err := run()

	// Restore stdout
	w.Close()
	os.Stdout = oldStdout

	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	// Read captured output
	output := make([]byte, 4096)
	n, _ := r.Read(output)
	outputStr := string(output[:n])

	// Verify the "Parsing not yet implemented" message is printed
	// This protects against accidental removal of the message (main.go:110)
	if !strings.Contains(outputStr, "Parsing not yet implemented") {
		t.Errorf("Expected output to contain 'Parsing not yet implemented', got:\n%s", outputStr)
	}

	// Verify NO verbose scanning details are printed
	if strings.Contains(outputStr, "Scanning directory:") {
		t.Errorf("Expected no verbose output in non-verbose mode, got:\n%s", outputStr)
	}
	if strings.Contains(outputStr, "Found") && strings.Contains(outputStr, "statement files") {
		t.Errorf("Expected no verbose file count in non-verbose mode, got:\n%s", outputStr)
	}
}
