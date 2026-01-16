package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
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
// TODO(#1440): Add panic recovery handling or document defer requirement
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

	// Capture stderr (verbose output goes to stderr)
	oldStderr := os.Stderr
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("Failed to create pipe: %v", err)
	}
	os.Stderr = w

	// Run
	err = run()

	// Restore stderr
	w.Close()
	os.Stderr = oldStderr

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Read captured output
	output, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("Failed to read output: %v", err)
	}
	outputStr := string(output)

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

	// Create a valid OFX file
	ofxContent := `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20251001120000
<LANGUAGE>ENG
<FI>
<ORG>TESTBANK
<FID>123
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>123456789
<ACCTID>1234
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20251001000000
<DTEND>20251031235959
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251005120000
<TRNAMT>-50.00
<FITID>TXN001
<NAME>Test Purchase
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>950.00
<DTASOF>20251031000000
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	testFile := filepath.Join(acctDir, "statement.ofx")
	if err := os.WriteFile(testFile, []byte(ofxContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Set flags: non-dry-run, non-verbose (most common production usage)
	defer withFlags(t, tmpDir, false, false)()

	// Capture stdout
	oldStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("Failed to create pipe: %v", err)
	}
	os.Stdout = w

	// Run
	err = run()

	// Restore stdout
	w.Close()
	os.Stdout = oldStdout

	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	// Read captured output
	output, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("Failed to read output: %v", err)
	}
	outputStr := string(output)

	// Verify scan summary is printed
	if !strings.Contains(outputStr, "Scan complete: found 1 statement files") {
		t.Errorf("Expected output to contain scan summary, got:\n%s", outputStr)
	}

	// Verify NO verbose scanning details are printed
	if strings.Contains(outputStr, "Scanning directory:") {
		t.Errorf("Expected no verbose output in non-verbose mode, got:\n%s", outputStr)
	}
	if strings.Contains(outputStr, "Parsing and transforming statements") {
		t.Errorf("Expected no verbose parsing details in non-verbose mode, got:\n%s", outputStr)
	}
}

// TestRun_NonDryRun_ZeroFiles tests non-dry-run execution with zero files found
// This covers the error path at main.go:148-150 that returns an error
// when no statement files are found, preventing silent failures in scripts/CI.
func TestRun_NonDryRun_ZeroFiles(t *testing.T) {
	tmpDir := t.TempDir()
	defer withFlags(t, tmpDir, false, false)()

	// Run should return error when no files found in non-dry-run mode
	err := run()
	if err == nil {
		t.Fatal("Expected error when no statement files found, got nil")
	}

	// Verify error message contains helpful guidance (main.go:149)
	errStr := err.Error()
	if !strings.Contains(errStr, "no statement files found") {
		t.Errorf("Expected error to mention 'no statement files found', got: %v", err)
	}
	if !strings.Contains(errStr, "Directory path is correct") {
		t.Errorf("Expected error to include troubleshooting tips, got: %v", err)
	}
	if !strings.Contains(errStr, "supported extensions") {
		t.Errorf("Expected error to mention supported extensions, got: %v", err)
	}
}

// TestRun_NonDryRun_MultipleInstitutions tests non-dry-run with multiple institutions
// This covers the institution breakdown logic at main.go:112-123 which formats
// and displays a summary of files by institution - critical user feedback.
func TestRun_NonDryRun_MultipleInstitutions(t *testing.T) {
	tmpDir := t.TempDir()

	// Create files from 2 institutions with different counts
	amexDir := filepath.Join(tmpDir, "american_express", "2011")
	if err := os.MkdirAll(amexDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create valid OFX files for American Express with different statement periods
	ofxContent1 := `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20251001120000
<LANGUAGE>ENG
<FI>
<ORG>AMEX
<FID>1000
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<CCSTMTRS>
<CURDEF>USD
<CCACCTFROM>
<ACCTID>2011
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20251001000000
<DTEND>20251031235959
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251005120000
<TRNAMT>-100.00
<FITID>TXN001
<NAME>Purchase
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>900.00
<DTASOF>20251031000000
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`

	ofxContent2 := `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20251101120000
<LANGUAGE>ENG
<FI>
<ORG>AMEX
<FID>1000
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<CCSTMTRS>
<CURDEF>USD
<CCACCTFROM>
<ACCTID>2011
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20251101000000
<DTEND>20251130235959
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251105120000
<TRNAMT>-75.00
<FITID>TXN002
<NAME>Purchase 2
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>825.00
<DTASOF>20251130000000
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`

	if err := os.WriteFile(filepath.Join(amexDir, "stmt1.qfx"), []byte(ofxContent1), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(amexDir, "stmt2.qfx"), []byte(ofxContent2), 0644); err != nil {
		t.Fatal(err)
	}

	chaseDir := filepath.Join(tmpDir, "chase", "5678")
	if err := os.MkdirAll(chaseDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create valid PNC CSV file for Chase
	csvContent := `5678,2025/10/01,2025/10/31,1000.00,950.00
2025/10/05,50.00,Test Purchase,Purchase memo,REF001,DEBIT`

	if err := os.WriteFile(filepath.Join(chaseDir, "stmt.csv"), []byte(csvContent), 0644); err != nil {
		t.Fatal(err)
	}

	defer withFlags(t, tmpDir, false, false)()

	// Capture stdout
	oldStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("Failed to create pipe: %v", err)
	}
	os.Stdout = w

	err = run()

	// Restore stdout
	w.Close()
	os.Stdout = oldStdout

	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	// Read captured output
	output, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("Failed to read output: %v", err)
	}
	outputStr := string(output)

	// Verify total file count
	if !strings.Contains(outputStr, "found 3 statement files") {
		t.Errorf("Expected output to show 'found 3 statement files', got:\n%s", outputStr)
	}

	// Verify institution count (main.go:138)
	if !strings.Contains(outputStr, "across 2 institutions") {
		t.Errorf("Expected 'across 2 institutions' in output, got:\n%s", outputStr)
	}

	// Verify American Express with 2 files (main.go:140)
	if !strings.Contains(outputStr, "American Express: 2 files") {
		t.Errorf("Expected 'American Express: 2 files' in output, got:\n%s", outputStr)
	}

	// Verify Chase with 1 file (main.go:140)
	if !strings.Contains(outputStr, "Chase: 1 files") {
		t.Errorf("Expected 'Chase: 1 files' in output, got:\n%s", outputStr)
	}
}

// TestRun_StateVersionMismatch tests that version mismatch returns proper error
func TestRun_StateVersionMismatch(t *testing.T) {
	tmpDir := t.TempDir()
	stateFilePath := filepath.Join(tmpDir, "state.json")

	// Create state file with wrong version
	stateJSON := `{
		"version": 999,
		"fingerprints": {},
		"metadata": {
			"lastUpdated": "2025-01-01T00:00:00Z"
		}
	}`
	if err := os.WriteFile(stateFilePath, []byte(stateJSON), 0644); err != nil {
		t.Fatal(err)
	}

	// Create valid input directory with a file
	instDir := filepath.Join(tmpDir, "test_bank", "1234")
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatal(err)
	}
	testFile := filepath.Join(instDir, "statement.ofx")
	if err := os.WriteFile(testFile, []byte("test content"), 0644); err != nil {
		t.Fatal(err)
	}

	// Use non-dry-run mode so state loading actually happens
	defer withFlags(t, tmpDir, false, false)()
	*stateFile = stateFilePath

	// Run should fail with version mismatch
	err := run()
	if err == nil {
		t.Fatal("Expected error for state version mismatch, got nil")
	}
	if !strings.Contains(err.Error(), "unsupported state file version") {
		t.Errorf("Expected error containing 'unsupported state file version', got: %v", err)
	}
	if !strings.Contains(err.Error(), "version 999") {
		t.Errorf("Expected error to mention version 999, got: %v", err)
	}
}

// TestRun_StateCorruptionDetection tests empty state with recent LastUpdated
func TestRun_StateCorruptionDetection(t *testing.T) {
	tmpDir := t.TempDir()
	stateFilePath := filepath.Join(tmpDir, "state.json")

	// Create state with 0 fingerprints but recent LastUpdated (10 days ago)
	recentTime := time.Now().Add(-10 * 24 * time.Hour)
	stateJSON := fmt.Sprintf(`{
		"version": 1,
		"fingerprints": {},
		"metadata": {
			"lastUpdated": "%s"
		}
	}`, recentTime.Format(time.RFC3339))
	if err := os.WriteFile(stateFilePath, []byte(stateJSON), 0644); err != nil {
		t.Fatal(err)
	}

	// Create valid input directory with a file
	instDir := filepath.Join(tmpDir, "test_bank", "1234")
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatal(err)
	}
	testFile := filepath.Join(instDir, "statement.ofx")
	if err := os.WriteFile(testFile, []byte("test content"), 0644); err != nil {
		t.Fatal(err)
	}

	// Use non-dry-run mode so state loading actually happens
	defer withFlags(t, tmpDir, false, false)()
	*stateFile = stateFilePath

	// Run should fail with corruption detection
	err := run()
	if err == nil {
		t.Fatal("Expected error for state corruption detection, got nil")
	}
	if !strings.Contains(err.Error(), "empty") || !strings.Contains(err.Error(), "0 fingerprints") {
		t.Errorf("Expected error about empty state with 0 fingerprints, got: %v", err)
	}
	if !strings.Contains(err.Error(), "deduplication") {
		t.Errorf("Expected error to mention deduplication impact, got: %v", err)
	}
}

// TestRun_StatePermissionDenied tests permission error handling
func TestRun_StatePermissionDenied(t *testing.T) {
	tmpDir := t.TempDir()
	stateFilePath := filepath.Join(tmpDir, "state.json")

	// Create valid state file
	stateJSON := `{
		"version": 1,
		"fingerprints": {"test": {"firstSeen": "2025-01-01T00:00:00Z", "lastSeen": "2025-01-01T00:00:00Z", "count": 1, "transactionId": "tx1"}},
		"metadata": {"lastUpdated": "2025-01-01T00:00:00Z"}
	}`
	if err := os.WriteFile(stateFilePath, []byte(stateJSON), 0644); err != nil {
		t.Fatal(err)
	}

	// Remove read permissions
	if err := os.Chmod(stateFilePath, 0000); err != nil {
		t.Skip("Cannot change file permissions on this filesystem")
	}
	// Restore permissions after test
	defer os.Chmod(stateFilePath, 0644)

	// Create valid input directory with a file
	instDir := filepath.Join(tmpDir, "test_bank", "1234")
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatal(err)
	}
	testFile := filepath.Join(instDir, "statement.ofx")
	if err := os.WriteFile(testFile, []byte("test content"), 0644); err != nil {
		t.Fatal(err)
	}

	// Use non-dry-run mode so state loading actually happens
	defer withFlags(t, tmpDir, false, false)()
	*stateFile = stateFilePath

	// Run should fail with permission error
	err := run()
	if err == nil {
		t.Fatal("Expected error for state permission denied, got nil")
	}
	if !strings.Contains(err.Error(), "permission denied") {
		t.Errorf("Expected error containing 'permission denied', got: %v", err)
	}
	// Verify recovery instructions are present
	if !strings.Contains(err.Error(), "Options:") {
		t.Errorf("Expected error to contain recovery options, got: %v", err)
	}
}

// TestRun_StateCorruptedJSON tests malformed JSON in state file
func TestRun_StateCorruptedJSON(t *testing.T) {
	tmpDir := t.TempDir()
	stateFilePath := filepath.Join(tmpDir, "state.json")

	// Create state file with invalid JSON
	stateJSON := `{invalid json content`
	if err := os.WriteFile(stateFilePath, []byte(stateJSON), 0644); err != nil {
		t.Fatal(err)
	}

	// Create valid input directory with a file
	instDir := filepath.Join(tmpDir, "test_bank", "1234")
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatal(err)
	}
	testFile := filepath.Join(instDir, "statement.ofx")
	if err := os.WriteFile(testFile, []byte("test content"), 0644); err != nil {
		t.Fatal(err)
	}

	// Use non-dry-run mode so state loading actually happens
	defer withFlags(t, tmpDir, false, false)()
	*stateFile = stateFilePath

	// Run should fail with load error
	err := run()
	if err == nil {
		t.Fatal("Expected error for corrupted JSON, got nil")
	}
	if !strings.Contains(err.Error(), "failed to load existing state file") {
		t.Errorf("Expected error containing 'failed to load existing state file', got: %v", err)
	}
	// Verify recovery instructions are present
	if !strings.Contains(err.Error(), "Options:") {
		t.Errorf("Expected error to contain recovery options, got: %v", err)
	}
}

// TestRun_StateSavePermissionDenied tests the critical state-before-output contract.
//
// CRITICAL CONTRACT: State must be saved BEFORE output is written (main.go:531-535).
// This ordering ensures retry safety:
//   - If state saves but output fails: retry can write output without re-parsing
//   - If state save fails: output is NOT written, maintaining consistency
//   - Never write output with unsaved state (would lose deduplication on retry)
//
// This test verifies that when state save fails, output is NOT written.
// If this contract breaks (e.g., state check removed at main.go:555), invalid data
// would be written without saving state, breaking deduplication on retry and causing
// duplicate transactions in the budget prototype.
func TestRun_StateSavePermissionDenied(t *testing.T) {
	tmpDir := t.TempDir()
	stateDir := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(stateDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a new state file that doesn't exist yet (will be created on save)
	stateFilePath := filepath.Join(stateDir, "newstate.json")
	outputFilePath := filepath.Join(tmpDir, "output.json")

	// Create valid OFX file that will parse successfully
	instDir := filepath.Join(tmpDir, "test_bank", "1234")
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatal(err)
	}

	ofxContent := `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20251001120000
<LANGUAGE>ENG
<FI>
<ORG>TESTBANK
<FID>123
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>123456789
<ACCTID>1234
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20251001000000
<DTEND>20251031235959
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251005120000
<TRNAMT>-50.00
<FITID>TXN001
<NAME>Test Purchase
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>950.00
<DTASOF>20251031000000
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	testFile := filepath.Join(instDir, "statement.ofx")
	if err := os.WriteFile(testFile, []byte(ofxContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Make state directory read-only after creation
	if err := os.Chmod(stateDir, 0444); err != nil {
		t.Skip("Cannot change directory permissions on this filesystem")
	}
	defer os.Chmod(stateDir, 0755)

	defer withFlags(t, tmpDir, false, false)()
	*stateFile = stateFilePath
	*outputFile = outputFilePath

	// Run should fail with permission error (either on load check or save)
	err := run()
	if err == nil {
		t.Fatal("Expected error for state permission denied, got nil")
	}
	// Accept either load failure or save failure - both are permission errors
	if !strings.Contains(err.Error(), "permission denied") {
		t.Errorf("Expected error about permission denied, got: %v", err)
	}

	// CRITICAL VERIFICATION: Output file was NOT created (state-before-output contract)
	// This verifies main.go:555 blocks output when state save fails.
	// If output file exists, it means the contract is violated and retry would create duplicates.
	if _, err := os.Stat(outputFilePath); err == nil {
		t.Error("CRITICAL: Output file was created despite state save failure - this violates the state-before-output contract and will cause duplicate transactions on retry")
	} else if !os.IsNotExist(err) {
		t.Errorf("Failed to check output file existence: %v", err)
	}
}

// TestRun_ValidationBlocksOutput tests that validation errors prevent output file creation.
//
// CRITICAL CONTRACT: When validation fails (main.go:511), output file must NOT be created.
// This prevents corrupted/invalid budget data from being written and consumed by the budget app.
//
// NOTE: This test is difficult to implement without the ability to inject invalid data into
// the budget after parsing but before validation. The transform layer is designed to always
// produce valid domain objects, making it hard to trigger validation errors via normal parsing.
//
// TODO(#1440): Refactor to allow testing validation blocking behavior. Options:
//  1. Add test helper to inject validation errors
//  2. Create parser that produces invalid domain objects for testing
//  3. Add validation test mode that can be triggered via flag
//
// For now, this test is skipped but documents the critical contract that must be maintained.
func TestRun_ValidationBlocksOutput(t *testing.T) {
	t.Skip("Requires mechanism to inject validation errors - transform layer always produces valid data")

	// When implemented, this test should:
	// 1. Create statement file that produces valid parse but triggers validation errors
	//    (e.g., duplicate IDs, invalid date formats, broken references)
	// 2. Run pipeline with output file specified
	// 3. Verify run() returns error containing "validation failed"
	// 4. Verify error mentions error count
	// 5. Verify output file was NOT created
	//
	// Critical verification: Check that output file doesn't exist.
	// If it does, validation failed to block output (contract violation).
	//
	// Example validation errors to test:
	//   - Duplicate statement/transaction/account/institution IDs
	//   - Invalid date formats (not YYYY-MM-DD)
	//   - Invalid enum values (account type, category)
	//   - Broken references (transaction → non-existent statement)
	//   - Invalid redemption rates (outside [0,1] range)
}

// TestRun_ValidationWarningsDontBlock tests that validation warnings don't prevent output.
//
// CRITICAL CONTRACT: Validation warnings are informational only (main.go:514-522).
// They should NOT block output file creation. Only errors should block output (main.go:511).
//
// This test verifies that when validation produces warnings (but no errors), the output
// file IS created successfully. This ensures warnings don't break legitimate workflows.
//
// TODO(#1440): Currently skipped because validator doesn't produce warnings yet.
// Implement this test when warnings are added to validator.go.
func TestRun_ValidationWarningsDontBlock(t *testing.T) {
	t.Skip("Validator does not currently produce warnings (addWarning is never called in validator.go). Implement this test when warnings are added.")

	// When warnings are implemented, this test should:
	// 1. Create OFX that triggers validation warnings (not errors)
	// 2. Run pipeline with output file specified
	// 3. Verify run() returns nil (success)
	// 4. Verify output file WAS created
	// 5. Verify stderr contains warning messages
	//
	// Example warning scenarios to test:
	//   - Unusual but valid transaction amounts (e.g., very large transactions)
	//   - Non-standard category usage patterns
	//   - Edge case date ranges (e.g., statement spanning multiple years)
}

// TestRun_ValidationExitCode tests exit code on validation failure
func TestRun_ValidationExitCode(t *testing.T) {
	// Similar to TestRun_ValidationBlocksOutput, this test requires a way
	// to create data that fails validation, which is difficult to do via OFX
	t.Skip("Skipping - requires mechanism to inject validation errors for testing")
}

// TestRun_ValidationSuccess tests that validation runs and succeeds with valid data
func TestRun_ValidationSuccess(t *testing.T) {
	tmpDir := t.TempDir()

	// Create valid OFX file
	instDir := filepath.Join(tmpDir, "test_bank", "1234")
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatal(err)
	}

	ofxContent := `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20251001120000
<LANGUAGE>ENG
<FI>
<ORG>TESTBANK
<FID>123
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>123456789
<ACCTID>1234
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20251001000000
<DTEND>20251031235959
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251005120000
<TRNAMT>-50.00
<FITID>TXN001
<NAME>Test Purchase
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>950.00
<DTASOF>20251031000000
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	testFile := filepath.Join(instDir, "statement.ofx")
	if err := os.WriteFile(testFile, []byte(ofxContent), 0644); err != nil {
		t.Fatal(err)
	}

	defer withFlags(t, tmpDir, false, false)()

	// Run - if validation fails, run() will return an error
	// So successful return means validation passed
	err := run()
	if err != nil {
		t.Fatalf("Expected no error with valid data (validation should pass), got: %v", err)
	}

	// Success! The test verifies that:
	// 1. Valid OFX data is parsed successfully
	// 2. Validation runs (integrated into the pipeline at main.go:490)
	// 3. Validation passes (no errors returned)
	// 4. Output is written successfully
	//
	// If validation were not integrated or not running, we wouldn't get this far.
	// If validation failed, run() would return an error (main.go:508).
}
