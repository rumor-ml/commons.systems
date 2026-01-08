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

// TestRun_InvalidInputDir tests error handling for invalid input directories
func TestRun_InvalidInputDir(t *testing.T) {
	// Save original flags
	origInput := *inputDir
	origDryRun := *dryRun
	origVerbose := *verbose
	defer func() {
		*inputDir = origInput
		*dryRun = origDryRun
		*verbose = origVerbose
	}()

	t.Run("non-existent directory", func(t *testing.T) {
		// Set flags
		*inputDir = "/nonexistent/directory/that/does/not/exist"
		*dryRun = true
		*verbose = false

		// Run should fail
		err := run()
		if err == nil {
			t.Error("Expected error for non-existent directory, got nil")
		}
		if err != nil && !strings.Contains(err.Error(), "scan failed") {
			t.Errorf("Expected error containing 'scan failed', got: %v", err)
		}
	})
}

// TestRun_ValidDirectory tests successful execution with valid directory
func TestRun_ValidDirectory(t *testing.T) {
	// Save original flags
	origInput := *inputDir
	origDryRun := *dryRun
	origVerbose := *verbose
	defer func() {
		*inputDir = origInput
		*dryRun = origDryRun
		*verbose = origVerbose
	}()

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

	// Set flags
	*inputDir = tmpDir
	*dryRun = true
	*verbose = false

	// Run should succeed
	err := run()
	if err != nil {
		t.Errorf("Expected no error with valid directory, got: %v", err)
	}
}

// TestRun_EmptyDirectory tests execution with empty directory
func TestRun_EmptyDirectory(t *testing.T) {
	// Save original flags
	origInput := *inputDir
	origDryRun := *dryRun
	origVerbose := *verbose
	defer func() {
		*inputDir = origInput
		*dryRun = origDryRun
		*verbose = origVerbose
	}()

	tmpDir := t.TempDir()

	// Set flags
	*inputDir = tmpDir
	*dryRun = true
	*verbose = false

	// Run should succeed (no files found is not an error)
	err := run()
	if err != nil {
		t.Errorf("Expected no error with empty directory, got: %v", err)
	}
}

// TestRun_VerboseOutput tests verbose flag produces output
func TestRun_VerboseOutput(t *testing.T) {
	// Save original flags
	origInput := *inputDir
	origDryRun := *dryRun
	origVerbose := *verbose
	defer func() {
		*inputDir = origInput
		*dryRun = origDryRun
		*verbose = origVerbose
	}()

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

	// Capture stdout
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	// Set flags
	*inputDir = tmpDir
	*dryRun = true
	*verbose = true

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
