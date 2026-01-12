package dedup

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestGenerateFingerprint(t *testing.T) {
	tests := []struct {
		name        string
		date        string
		amount      float64
		description string
	}{
		{
			name:        "basic transaction",
			date:        "2025-01-15",
			amount:      -50.00,
			description: "Whole Foods",
		},
		{
			name:        "case insensitivity",
			date:        "2025-01-15",
			amount:      -50.00,
			description: "WHOLE FOODS",
		},
		{
			name:        "whitespace trimming",
			date:        "2025-01-15",
			amount:      -50.00,
			description: "  Whole Foods  ",
		},
		{
			name:        "positive amount",
			date:        "2025-01-15",
			amount:      1000.00,
			description: "Salary",
		},
		{
			name:        "floating point precision",
			amount:      -123.456,
			date:        "2025-01-15",
			description: "Test",
		},
		{
			name:        "floating point rounding",
			amount:      -123.455,
			date:        "2025-01-15",
			description: "Test",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := GenerateFingerprint(tt.date, tt.amount, tt.description)

			// Verify it's a valid hex string of correct length (SHA256 = 64 hex chars)
			if len(got) != 64 {
				t.Errorf("GenerateFingerprint() returned hash of length %d, want 64", len(got))
			}

			// Verify determinism: same inputs produce same output
			got2 := GenerateFingerprint(tt.date, tt.amount, tt.description)
			if got != got2 {
				t.Errorf("GenerateFingerprint() is not deterministic: %s != %s", got, got2)
			}
		})
	}
}

func TestGenerateFingerprint_Uniqueness(t *testing.T) {
	// Test that different inputs produce different fingerprints
	fp1 := GenerateFingerprint("2025-01-15", -50.00, "Whole Foods")
	fp2 := GenerateFingerprint("2025-01-16", -50.00, "Whole Foods") // Different date
	fp3 := GenerateFingerprint("2025-01-15", -51.00, "Whole Foods") // Different amount
	fp4 := GenerateFingerprint("2025-01-15", -50.00, "Target")      // Different description

	fingerprints := []string{fp1, fp2, fp3, fp4}
	seen := make(map[string]bool)

	for _, fp := range fingerprints {
		if seen[fp] {
			t.Errorf("Duplicate fingerprint detected: %s", fp)
		}
		seen[fp] = true
	}
}

func TestNewState(t *testing.T) {
	state := NewState()

	if state.Version != CurrentVersion {
		t.Errorf("NewState() version = %d, want %d", state.Version, CurrentVersion)
	}

	if state.fingerprints == nil {
		t.Error("NewState() fingerprints map is nil")
	}

	if len(state.fingerprints) != 0 {
		t.Errorf("NewState() fingerprints map length = %d, want 0", len(state.fingerprints))
	}

	if state.TotalFingerprints() != 0 {
		t.Errorf("NewState() TotalFingerprints() = %d, want 0", state.TotalFingerprints())
	}
}

func TestIsDuplicate(t *testing.T) {
	state := NewState()
	fp := "abc123"

	// Should not be duplicate initially
	if state.IsDuplicate(fp) {
		t.Error("IsDuplicate() returned true for non-existent fingerprint")
	}

	// Add fingerprint
	state.fingerprints[fp] = &FingerprintRecord{
		FirstSeen:     time.Now(),
		LastSeen:      time.Now(),
		Count:         1,
		TransactionID: "txn-001",
	}

	// Should be duplicate now
	if !state.IsDuplicate(fp) {
		t.Error("IsDuplicate() returned false for existing fingerprint")
	}
}

func TestRecordTransaction(t *testing.T) {
	state := NewState()
	fp := "abc123"
	txnID := "txn-001"
	ts := time.Date(2025, 1, 15, 10, 30, 0, 0, time.UTC)

	// First record
	err := state.RecordTransaction(fp, txnID, ts)
	if err != nil {
		t.Fatalf("RecordTransaction() error = %v", err)
	}

	record := state.fingerprints[fp]
	if record == nil {
		t.Fatal("RecordTransaction() did not create record")
	}

	if record.Count != 1 {
		t.Errorf("RecordTransaction() count = %d, want 1", record.Count)
	}

	if !record.FirstSeen.Equal(ts) {
		t.Errorf("RecordTransaction() firstSeen = %v, want %v", record.FirstSeen, ts)
	}

	if !record.LastSeen.Equal(ts) {
		t.Errorf("RecordTransaction() lastSeen = %v, want %v", record.LastSeen, ts)
	}

	if record.TransactionID != txnID {
		t.Errorf("RecordTransaction() transactionID = %s, want %s", record.TransactionID, txnID)
	}

	// Second record (duplicate)
	ts2 := time.Date(2025, 1, 16, 11, 0, 0, 0, time.UTC)
	err = state.RecordTransaction(fp, "txn-002", ts2)
	if err != nil {
		t.Fatalf("RecordTransaction() error on duplicate = %v", err)
	}

	record = state.fingerprints[fp]
	if record.Count != 2 {
		t.Errorf("RecordTransaction() count after duplicate = %d, want 2", record.Count)
	}

	if !record.FirstSeen.Equal(ts) {
		t.Errorf("RecordTransaction() firstSeen changed = %v, want %v", record.FirstSeen, ts)
	}

	if !record.LastSeen.Equal(ts2) {
		t.Errorf("RecordTransaction() lastSeen = %v, want %v", record.LastSeen, ts2)
	}

	// TransactionID should remain from first record
	if record.TransactionID != txnID {
		t.Errorf("RecordTransaction() transactionID changed = %s, want %s", record.TransactionID, txnID)
	}
}

func TestRecordTransaction_Errors(t *testing.T) {
	state := NewState()
	ts := time.Now()

	tests := []struct {
		name          string
		fingerprint   string
		transactionID string
		wantErr       bool
	}{
		{
			name:          "empty fingerprint",
			fingerprint:   "",
			transactionID: "txn-001",
			wantErr:       true,
		},
		{
			name:          "empty transaction ID",
			fingerprint:   "abc123",
			transactionID: "",
			wantErr:       true,
		},
		{
			name:          "valid inputs",
			fingerprint:   "abc123",
			transactionID: "txn-001",
			wantErr:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := state.RecordTransaction(tt.fingerprint, tt.transactionID, ts)
			if (err != nil) != tt.wantErr {
				t.Errorf("RecordTransaction() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestSaveAndLoadState(t *testing.T) {
	// Create temp directory
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "state.json")

	// Create and populate state
	original := NewState()
	fp1 := "abc123"
	fp2 := "def456"
	ts := time.Date(2025, 1, 15, 10, 30, 0, 0, time.UTC)

	original.RecordTransaction(fp1, "txn-001", ts)
	original.RecordTransaction(fp2, "txn-002", ts)

	// Save state
	err := SaveState(original, stateFile)
	if err != nil {
		t.Fatalf("SaveState() error = %v", err)
	}

	// Verify file exists
	if _, err := os.Stat(stateFile); os.IsNotExist(err) {
		t.Fatal("SaveState() did not create file")
	}

	// Load state
	loaded, err := LoadState(stateFile)
	if err != nil {
		t.Fatalf("LoadState() error = %v", err)
	}

	// Verify version
	if loaded.Version != original.Version {
		t.Errorf("LoadState() version = %d, want %d", loaded.Version, original.Version)
	}

	// Verify fingerprints count
	if len(loaded.fingerprints) != len(original.fingerprints) {
		t.Errorf("LoadState() fingerprints count = %d, want %d", len(loaded.fingerprints), len(original.fingerprints))
	}

	// Verify specific fingerprint
	record := loaded.fingerprints[fp1]
	if record == nil {
		t.Fatal("LoadState() missing fingerprint abc123")
	}

	if record.Count != 1 {
		t.Errorf("LoadState() record.Count = %d, want 1", record.Count)
	}

	if record.TransactionID != "txn-001" {
		t.Errorf("LoadState() record.TransactionID = %s, want txn-001", record.TransactionID)
	}

	// Verify metadata was updated during save
	if loaded.TotalFingerprints() != 2 {
		t.Errorf("LoadState() TotalFingerprints() = %d, want 2", loaded.TotalFingerprints())
	}
}

func TestLoadState_FileNotExists(t *testing.T) {
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "nonexistent.json")

	_, err := LoadState(stateFile)
	if err == nil {
		t.Error("LoadState() expected error for non-existent file")
	}

	if !os.IsNotExist(err) {
		t.Errorf("LoadState() error type = %T, want os.PathError", err)
	}
}

func TestLoadState_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "invalid.json")

	// Write invalid JSON
	err := os.WriteFile(stateFile, []byte("{invalid json}"), 0644)
	if err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	_, err = LoadState(stateFile)
	if err == nil {
		t.Error("LoadState() expected error for invalid JSON")
	}
}

func TestLoadState_PartialCorruption(t *testing.T) {
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "corrupted.json")

	// Write truncated JSON (simulates crash during write)
	truncatedJSON := `{
		"version": 1,
		"fingerprints": {
			"abc123": {
				"firstSeen": "2025-01-15T10:30:00Z",
				"lastSeen": "2025-01-15T10:30:00Z",
				"count": 1,
				"trans`
	// Note: Intentionally truncated mid-field

	err := os.WriteFile(stateFile, []byte(truncatedJSON), 0644)
	if err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	_, err = LoadState(stateFile)
	if err == nil {
		t.Error("LoadState() expected error for truncated JSON")
	}

	// Error should be meaningful JSON parse error
	if err != nil && !strings.Contains(err.Error(), "failed to parse state file") {
		t.Errorf("LoadState() error message = %v, should mention 'failed to parse state file'", err)
	}
}

func TestLoadState_MissingFields(t *testing.T) {
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "missing-fields.json")

	// Write state with missing fingerprints field
	stateWithoutFingerprints := `{
		"version": 1,
		"metadata": {
			"lastUpdated": "2025-01-15T10:30:00Z",
			"totalFingerprints": 0
		}
	}`

	err := os.WriteFile(stateFile, []byte(stateWithoutFingerprints), 0644)
	if err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	state, err := LoadState(stateFile)
	if err != nil {
		t.Fatalf("LoadState() should handle missing fingerprints field gracefully, got error: %v", err)
	}

	if state.fingerprints == nil {
		t.Error("LoadState() did not initialize nil fingerprints map")
	}

	if len(state.fingerprints) != 0 {
		t.Errorf("LoadState() fingerprints length = %d, want 0", len(state.fingerprints))
	}
}

func TestLoadState_UnsupportedVersion(t *testing.T) {
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "version2.json")

	// Write state with unsupported version
	invalidState := `{
		"version": 2,
		"fingerprints": {},
		"metadata": {
			"lastUpdated": "2025-01-15T10:30:00Z",
			"totalFingerprints": 0
		}
	}`

	err := os.WriteFile(stateFile, []byte(invalidState), 0644)
	if err != nil {
		t.Fatalf("Failed to write test file: %v", err)
	}

	_, err = LoadState(stateFile)
	if err == nil {
		t.Error("LoadState() expected error for unsupported version")
	}
}

func TestLoadState_FutureVersionMigration(t *testing.T) {
	// Test documents expected behavior when v2 state files are encountered
	// Current behavior: reject any version != CurrentVersion
	// Future consideration: implement migration path or provide upgrade tool
	tmpDir := t.TempDir()

	t.Run("v1 state file loads successfully", func(t *testing.T) {
		stateFile := filepath.Join(tmpDir, "v1.json")
		v1State := `{
			"version": 1,
			"fingerprints": {
				"abc123": {
					"firstSeen": "2025-01-15T10:30:00Z",
					"lastSeen": "2025-01-15T10:30:00Z",
					"count": 1,
					"transactionId": "txn-001"
				}
			},
			"metadata": {
				"lastUpdated": "2025-01-15T10:30:00Z"
			}
		}`

		err := os.WriteFile(stateFile, []byte(v1State), 0644)
		if err != nil {
			t.Fatalf("Failed to write test file: %v", err)
		}

		state, err := LoadState(stateFile)
		if err != nil {
			t.Errorf("LoadState() should load v1 state file, got error: %v", err)
		}
		if state != nil && state.Version != 1 {
			t.Errorf("LoadState() version = %d, want 1", state.Version)
		}
	})

	t.Run("v2 state file is rejected with clear error", func(t *testing.T) {
		stateFile := filepath.Join(tmpDir, "v2.json")
		v2State := `{
			"version": 2,
			"fingerprints": {},
			"metadata": {
				"lastUpdated": "2025-01-15T10:30:00Z"
			}
		}`

		err := os.WriteFile(stateFile, []byte(v2State), 0644)
		if err != nil {
			t.Fatalf("Failed to write test file: %v", err)
		}

		_, err = LoadState(stateFile)
		if err == nil {
			t.Error("LoadState() should reject v2 state file")
		}
		if err != nil && !strings.Contains(err.Error(), "unsupported state file version") {
			t.Errorf("LoadState() error should mention 'unsupported state file version', got: %v", err)
		}
	})

	// TODO: When v2 is implemented, add tests for:
	// - Automatic migration (if supported)
	// - Manual migration tool (if provided)
	// - Breaking changes that require state reset
}

func TestSaveState_CreatesDirectory(t *testing.T) {
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "nested", "dir", "state.json")

	state := NewState()
	err := SaveState(state, stateFile)
	if err != nil {
		t.Fatalf("SaveState() error = %v", err)
	}

	// Verify directory was created
	dir := filepath.Dir(stateFile)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		t.Error("SaveState() did not create parent directory")
	}

	// Verify file exists
	if _, err := os.Stat(stateFile); os.IsNotExist(err) {
		t.Error("SaveState() did not create file")
	}
}

func TestSaveState_UpdatesMetadata(t *testing.T) {
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "state.json")

	state := NewState()
	state.RecordTransaction("abc123", "txn-001", time.Now())
	state.RecordTransaction("def456", "txn-002", time.Now())

	err := SaveState(state, stateFile)
	if err != nil {
		t.Fatalf("SaveState() error = %v", err)
	}

	// Load and verify fingerprints
	loaded, err := LoadState(stateFile)
	if err != nil {
		t.Fatalf("LoadState() error = %v", err)
	}

	if loaded.TotalFingerprints() != 2 {
		t.Errorf("SaveState() TotalFingerprints() = %d, want 2", loaded.TotalFingerprints())
	}
}

func TestSaveState_Atomic(t *testing.T) {
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "state.json")

	// Create initial state
	state1 := NewState()
	state1.RecordTransaction("abc123", "txn-001", time.Now())
	err := SaveState(state1, stateFile)
	if err != nil {
		t.Fatalf("SaveState() initial error = %v", err)
	}

	// Verify no temp file remains
	tempFile := stateFile + ".tmp"
	if _, err := os.Stat(tempFile); !os.IsNotExist(err) {
		t.Error("SaveState() left temp file behind")
	}
}

func TestSaveState_DiskFullDuringWrite(t *testing.T) {
	// Document expected behavior for disk-full scenarios
	// This test is skipped because reliably triggering disk-full requires OS-level mocking
	t.Skip("Disk-full testing requires OS-level mocking or ramfs setup")

	// Expected behavior when disk fills during WriteFile:
	// 1. SaveState should return error (not panic)
	// 2. Temp file may exist with partial data
	// 3. Original state file remains untouched (if it existed)
	// 4. Caller should handle error and retry or alert user
	//
	// Current implementation (dedup.go:193-195):
	// - WriteFile returns error if disk full
	// - Temp file cleanup only happens in Rename failure path
	// - If WriteFile fails, temp file is NOT cleaned up (minor issue)
	//
	// Future improvement: Add defer cleanup after WriteFile
}

func TestGenerateFingerprint_Unicode(t *testing.T) {
	// Test with unicode characters
	fp1 := GenerateFingerprint("2025-01-15", -50.00, "Café Münchën")
	fp2 := GenerateFingerprint("2025-01-15", -50.00, "café münchën")

	// Should be equal after normalization (lowercase)
	if fp1 != fp2 {
		t.Error("GenerateFingerprint() did not normalize unicode correctly")
	}

	// Verify it's a valid hex string
	if len(fp1) != 64 {
		t.Errorf("GenerateFingerprint() returned hash of length %d, want 64", len(fp1))
	}
}

func TestGenerateFingerprint_EmptyDescription(t *testing.T) {
	// Empty description should still generate a valid fingerprint
	fp := GenerateFingerprint("2025-01-15", -50.00, "")
	if len(fp) != 64 {
		t.Errorf("GenerateFingerprint() with empty description returned hash of length %d, want 64", len(fp))
	}

	// Should differ from a non-empty description
	fp2 := GenerateFingerprint("2025-01-15", -50.00, "a")
	if fp == fp2 {
		t.Error("GenerateFingerprint() returned same hash for empty and non-empty description")
	}
}

func TestGenerateFingerprint_LargeAmounts(t *testing.T) {
	tests := []struct {
		name   string
		amount float64
	}{
		{"million dollars", 1000000.00},
		{"negative million", -1000000.00},
		{"ten million", 10000000.00},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fp1 := GenerateFingerprint("2025-01-15", tt.amount, "Large Transaction")
			fp2 := GenerateFingerprint("2025-01-15", tt.amount, "Large Transaction")

			// Verify determinism
			if fp1 != fp2 {
				t.Errorf("Fingerprint not deterministic for amount %f", tt.amount)
			}

			// Verify valid hex string
			if len(fp1) != 64 {
				t.Errorf("Expected 64-char hash, got %d for amount %f", len(fp1), tt.amount)
			}
		})
	}
}

func TestGenerateFingerprint_NormalizationCollisions(t *testing.T) {
	t.Run("different amounts should produce different hashes", func(t *testing.T) {
		// Amounts that round to different 2-decimal values
		fp1 := GenerateFingerprint("2025-01-15", -123.454, "Whole Foods")
		fp2 := GenerateFingerprint("2025-01-15", -123.456, "Whole Foods")

		// -123.454 rounds to -123.45
		// -123.456 rounds to -123.46
		// These MUST produce different fingerprints
		if fp1 == fp2 {
			t.Error("Amounts rounding to different 2-decimal values should produce different fingerprints")
		}
	})

	t.Run("same rounded amounts should produce same hash", func(t *testing.T) {
		// Amounts that round to same 2-decimal value
		fp1 := GenerateFingerprint("2025-01-15", -50.001, "Target")
		fp2 := GenerateFingerprint("2025-01-15", -50.004, "Target")

		// Both round to -50.00
		// These MUST produce same fingerprint (intentional dedup)
		if fp1 != fp2 {
			t.Error("Amounts rounding to same 2-decimal value should produce same fingerprint")
		}
	})

	t.Run("whitespace normalization creates intentional collisions", func(t *testing.T) {
		// Test that extra whitespace is normalized away (TrimSpace behavior)
		fp1 := GenerateFingerprint("2025-01-15", -50.00, "Target  Store") // 2 spaces
		fp2 := GenerateFingerprint("2025-01-15", -50.00, "Target Store")  // 1 space

		// Current implementation uses TrimSpace but doesn't collapse internal spaces
		// These WILL be different because internal spaces are preserved
		if fp1 == fp2 {
			t.Error("Internal whitespace differences should be preserved (TrimSpace only affects edges)")
		}

		// But leading/trailing spaces should be normalized
		fp3 := GenerateFingerprint("2025-01-15", -50.00, "  Target Store  ")
		fp4 := GenerateFingerprint("2025-01-15", -50.00, "Target Store")

		if fp3 != fp4 {
			t.Error("Leading/trailing whitespace should be normalized away")
		}
	})

	t.Run("case normalization prevents collisions", func(t *testing.T) {
		// Different case should produce SAME fingerprint (intentional)
		fp1 := GenerateFingerprint("2025-01-15", -50.00, "WHOLE FOODS")
		fp2 := GenerateFingerprint("2025-01-15", -50.00, "whole foods")
		fp3 := GenerateFingerprint("2025-01-15", -50.00, "Whole Foods")

		if fp1 != fp2 || fp2 != fp3 {
			t.Error("Case differences should be normalized (all lowercase)")
		}
	})
}

func TestGenerateFingerprint_SimilarTransactionsCollision(t *testing.T) {
	// Test behavior when different transactions produce same or similar fingerprints
	// This validates the deduplication granularity and business logic

	t.Run("different store numbers produce different fingerprints", func(t *testing.T) {
		// Two different Whole Foods locations, same date/amount
		fp1 := GenerateFingerprint("2025-01-15", -50.00, "Whole Foods Market #123")
		fp2 := GenerateFingerprint("2025-01-15", -50.00, "Whole Foods Market #456")

		// These should be different (internal spaces and numbers preserved)
		if fp1 == fp2 {
			t.Error("Different store numbers should produce different fingerprints")
			t.Log("Business decision: This would cause false positives - two purchases at different stores on same day")
		}
	})

	t.Run("similar descriptions with different suffixes", func(t *testing.T) {
		// Same merchant, different transaction details
		fp1 := GenerateFingerprint("2025-01-15", -50.00, "Amazon.com*ABC123")
		fp2 := GenerateFingerprint("2025-01-15", -50.00, "Amazon.com*XYZ789")

		// These should be different (order IDs preserved)
		if fp1 == fp2 {
			t.Error("Different order IDs should produce different fingerprints")
		}
	})

	t.Run("identical date/amount/description are correctly flagged as duplicates", func(t *testing.T) {
		// True duplicates: exact same transaction
		fp1 := GenerateFingerprint("2025-01-15", -50.00, "Whole Foods")
		fp2 := GenerateFingerprint("2025-01-15", -50.00, "Whole Foods")

		// These MUST be identical (intentional dedup)
		if fp1 != fp2 {
			t.Error("Identical transactions should produce same fingerprint")
		}
	})

	t.Run("edge case: very similar amounts on same day", func(t *testing.T) {
		// Two transactions at same merchant, slightly different amounts
		fp1 := GenerateFingerprint("2025-01-15", -50.00, "Starbucks")
		fp2 := GenerateFingerprint("2025-01-15", -50.01, "Starbucks")

		// These should be different (amounts differ)
		if fp1 == fp2 {
			t.Error("Different amounts should produce different fingerprints")
		}
	})

	// Document current deduplication granularity:
	// - Date: exact match required
	// - Amount: rounded to 2 decimals
	// - Description: case-insensitive, trimmed, internal spaces preserved
	//
	// Business decision: This granularity is acceptable for initial use case.
	// If false positives occur (e.g., two purchases at different stores),
	// consider adding transaction ID to fingerprint input.
}

func TestRecordTransaction_TimestampBeforeFirstSeen(t *testing.T) {
	state := NewState()
	fp := "abc123"
	ts1 := time.Date(2025, 1, 15, 10, 0, 0, 0, time.UTC)
	ts2 := time.Date(2025, 1, 14, 10, 0, 0, 0, time.UTC) // Earlier

	// Record first transaction
	err := state.RecordTransaction(fp, "txn-001", ts1)
	if err != nil {
		t.Fatalf("Failed to record first transaction: %v", err)
	}

	// Attempt to record with earlier timestamp
	err = state.RecordTransaction(fp, "txn-002", ts2)
	if err == nil {
		t.Error("Expected error for timestamp before firstSeen")
	}
	if !strings.Contains(err.Error(), "before first seen") {
		t.Errorf("Error should mention 'before first seen', got: %v", err)
	}
}

func TestNewFingerprintRecord_ZeroTimestamp(t *testing.T) {
	_, err := NewFingerprintRecord("txn-001", time.Time{})
	if err == nil {
		t.Error("Expected error for zero timestamp")
	}
	if !strings.Contains(err.Error(), "timestamp cannot be zero") {
		t.Errorf("Error should mention 'timestamp cannot be zero', got: %v", err)
	}
}

func TestFingerprintRecord_UpdateWithEqualTimestamp(t *testing.T) {
	ts := time.Date(2025, 1, 15, 10, 0, 0, 0, time.UTC)
	record, err := NewFingerprintRecord("txn-001", ts)
	if err != nil {
		t.Fatalf("NewFingerprintRecord() error = %v", err)
	}

	// Same timestamp should be allowed (idempotent re-parse)
	err = record.Update(ts)
	if err != nil {
		t.Errorf("Update with equal timestamp should succeed, got error: %v", err)
	}

	if record.Count != 2 {
		t.Errorf("Count should increment to 2, got %d", record.Count)
	}

	// FirstSeen and LastSeen should both equal original timestamp
	if !record.FirstSeen.Equal(ts) {
		t.Errorf("FirstSeen should remain %v, got %v", ts, record.FirstSeen)
	}
	if !record.LastSeen.Equal(ts) {
		t.Errorf("LastSeen should equal %v, got %v", ts, record.LastSeen)
	}
}

func TestSaveState_RenameFailsWithCleanupFailure(t *testing.T) {
	// This is difficult to test without OS-level mocking, but can be tested
	// by using a read-only directory for the state file location
	tmpDir := t.TempDir()
	readOnlyDir := filepath.Join(tmpDir, "readonly")
	if err := os.MkdirAll(readOnlyDir, 0755); err != nil {
		t.Fatalf("Failed to create read-only directory: %v", err)
	}
	if err := os.Chmod(readOnlyDir, 0555); err != nil {
		t.Fatalf("Failed to set read-only permissions: %v", err)
	}
	defer os.Chmod(readOnlyDir, 0755) // Restore for cleanup

	stateFile := filepath.Join(readOnlyDir, "state.json")
	state := NewState()

	err := SaveState(state, stateFile)
	if err == nil {
		t.Error("Expected error when saving to read-only directory")
	}

	// Verify error handling exists (exact behavior may vary by OS)
	if !strings.Contains(err.Error(), "failed to") {
		t.Errorf("Error should be descriptive, got: %v", err)
	}
}

func TestState_ConcurrentRecordTransaction(t *testing.T) {
	t.Skip("State is NOT thread-safe by design. CLI uses sequential processing (main.go:211-270). This test documents the limitation and should be enabled when thread-safety is added.")

	// Test concurrent RecordTransaction calls to verify thread-safety
	// Run with: go test -race ./internal/dedup/...
	state := NewState()
	numGoroutines := 10
	opsPerGoroutine := 100
	var wg sync.WaitGroup

	// Launch goroutines that all record transactions
	for i := 0; i < numGoroutines; i++ {
		wg.Add(1)
		go func(goroutineID int) {
			defer wg.Done()
			for j := 0; j < opsPerGoroutine; j++ {
				// Each goroutine uses unique fingerprints to avoid contention
				fp := GenerateFingerprint("2025-01-15", float64(-50.00-goroutineID*100-j), "Transaction")
				txnID := fmt.Sprintf("txn-%d-%d", goroutineID, j)
				ts := time.Now()
				if err := state.RecordTransaction(fp, txnID, ts); err != nil {
					t.Errorf("RecordTransaction failed: %v", err)
				}
			}
		}(i)
	}

	wg.Wait()

	// Verify total count
	expectedCount := numGoroutines * opsPerGoroutine
	if state.TotalFingerprints() != expectedCount {
		t.Errorf("TotalFingerprints() = %d, want %d", state.TotalFingerprints(), expectedCount)
	}
}

func TestState_ConcurrentReadWrite(t *testing.T) {
	t.Skip("State is NOT thread-safe by design. CLI uses sequential processing (main.go:211-270). This test documents the limitation and should be enabled when thread-safety is added.")

	// Test concurrent reads (IsDuplicate) and writes (RecordTransaction)
	// This validates that read operations don't race with write operations
	state := NewState()
	numReaders := 5
	numWriters := 5
	opsPerGoroutine := 50
	var wg sync.WaitGroup

	// Pre-populate some fingerprints for readers to find
	for i := 0; i < 100; i++ {
		fp := GenerateFingerprint("2025-01-15", float64(-100.00-i), "Initial")
		state.RecordTransaction(fp, fmt.Sprintf("init-%d", i), time.Now())
	}

	// Launch reader goroutines
	for i := 0; i < numReaders; i++ {
		wg.Add(1)
		go func(readerID int) {
			defer wg.Done()
			for j := 0; j < opsPerGoroutine; j++ {
				// Read existing fingerprints
				fp := GenerateFingerprint("2025-01-15", float64(-100.00-j), "Initial")
				_ = state.IsDuplicate(fp) // Should not panic
			}
		}(i)
	}

	// Launch writer goroutines
	for i := 0; i < numWriters; i++ {
		wg.Add(1)
		go func(writerID int) {
			defer wg.Done()
			for j := 0; j < opsPerGoroutine; j++ {
				// Write new fingerprints
				fp := GenerateFingerprint("2025-01-15", float64(-200.00-writerID*100-j), "New")
				txnID := fmt.Sprintf("txn-%d-%d", writerID, j)
				ts := time.Now()
				if err := state.RecordTransaction(fp, txnID, ts); err != nil {
					t.Errorf("RecordTransaction failed: %v", err)
				}
			}
		}(i)
	}

	wg.Wait()

	// Verify state is consistent (no race detector warnings = success)
	expectedTotal := 100 + (numWriters * opsPerGoroutine)
	if state.TotalFingerprints() != expectedTotal {
		t.Errorf("TotalFingerprints() = %d, want %d", state.TotalFingerprints(), expectedTotal)
	}
}

func TestSaveState_NotConcurrentSafe(t *testing.T) {
	// Document that SaveState is NOT thread-safe
	// Current implementation assumes sequential processing (as in cmd/finparse/main.go)
	// This test verifies the current limitation rather than testing for safety

	// Note: We don't actually test concurrent SaveState calls here because:
	// 1. It would require complex race condition triggering
	// 2. Current CLI design doesn't call SaveState concurrently
	// 3. Test would be flaky and platform-dependent

	// Instead, we document the assumption:
	t.Log("SaveState assumes sequential processing")
	t.Log("CLI processes files one at a time (cmd/finparse/main.go:211-270)")
	t.Log("If parallel processing is added, consider:")
	t.Log("  - Adding mutex to SaveState")
	t.Log("  - Using channel-based serialization")
	t.Log("  - Implementing lock file mechanism")

	// Simple test: verify SaveState works in single-threaded context
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "state.json")
	state := NewState()
	state.RecordTransaction("abc123", "txn-001", time.Now())

	err := SaveState(state, stateFile)
	if err != nil {
		t.Errorf("SaveState failed in single-threaded context: %v", err)
	}
}

func TestState_PerformanceWithLargeDataset(t *testing.T) {
	// Test performance with realistic production dataset size
	// Skip in short mode: go test -short ./internal/dedup/...
	if testing.Short() {
		t.Skip("Skipping performance test in short mode")
	}

	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "large-state.json")

	// Create state with 10,000 fingerprints (simulates 5+ years of transactions)
	state := NewState()
	numFingerprints := 10000
	baseTime := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)

	t.Logf("Generating %d fingerprints...", numFingerprints)
	for i := 0; i < numFingerprints; i++ {
		// Generate unique fingerprints with realistic data distribution
		date := baseTime.AddDate(0, 0, i%1825).Format("2006-01-02") // 5 years
		amount := -50.00 - float64(i%1000)                          // Various amounts
		description := fmt.Sprintf("Transaction %d", i)
		fp := GenerateFingerprint(date, amount, description)
		txnID := fmt.Sprintf("txn-%d", i)
		ts := baseTime.AddDate(0, 0, i%1825)

		if err := state.RecordTransaction(fp, txnID, ts); err != nil {
			t.Fatalf("Failed to record transaction %d: %v", i, err)
		}
	}

	// Measure save performance
	t.Log("Measuring SaveState performance...")
	saveStart := time.Now()
	if err := SaveState(state, stateFile); err != nil {
		t.Fatalf("SaveState failed: %v", err)
	}
	saveDuration := time.Since(saveStart)
	t.Logf("SaveState took: %v", saveDuration)

	// Generous timeout: 500ms (production should be faster, but CI may be slower)
	if saveDuration > 500*time.Millisecond {
		t.Errorf("SaveState too slow: %v (expected < 500ms)", saveDuration)
	}

	// Verify file size
	fileInfo, err := os.Stat(stateFile)
	if err != nil {
		t.Fatalf("Failed to stat state file: %v", err)
	}
	fileSize := fileInfo.Size()
	t.Logf("State file size: %.2f MB", float64(fileSize)/(1024*1024))

	// Expected: ~1.6 MB for 10,000 fingerprints with JSON indentation
	// Allow up to 5 MB to account for metadata and formatting
	maxSize := int64(5 * 1024 * 1024) // 5 MB
	if fileSize > maxSize {
		t.Errorf("State file too large: %d bytes (%.2f MB), expected < %d bytes (%.2f MB)",
			fileSize, float64(fileSize)/(1024*1024),
			maxSize, float64(maxSize)/(1024*1024))
	}

	// Measure load performance
	t.Log("Measuring LoadState performance...")
	loadStart := time.Now()
	loadedState, err := LoadState(stateFile)
	if err != nil {
		t.Fatalf("LoadState failed: %v", err)
	}
	loadDuration := time.Since(loadStart)
	t.Logf("LoadState took: %v", loadDuration)

	// Generous timeout: 250ms
	if loadDuration > 250*time.Millisecond {
		t.Errorf("LoadState too slow: %v (expected < 250ms)", loadDuration)
	}

	// Verify loaded state is correct
	if loadedState.TotalFingerprints() != numFingerprints {
		t.Errorf("LoadState fingerprints count = %d, want %d",
			loadedState.TotalFingerprints(), numFingerprints)
	}

	// Performance optimization opportunities (if tests fail):
	// 1. Remove JSON indentation for production (use json.Marshal instead of MarshalIndent)
	// 2. Implement incremental writes (append-only log with periodic compaction)
	// 3. Use binary format instead of JSON (protobuf, msgpack, gob)
	// 4. Implement LRU eviction for old fingerprints
	// 5. Add compression (gzip)
}
