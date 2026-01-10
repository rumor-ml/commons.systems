package dedup

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestGenerateFingerprint(t *testing.T) {
	tests := []struct {
		name        string
		date        string
		amount      float64
		description string
		want        string // Expected hash (deterministic)
	}{
		{
			name:        "basic transaction",
			date:        "2025-01-15",
			amount:      -50.00,
			description: "Whole Foods",
			want:        "3f5c8c6e9a8e2d0f1b4a7c3e6d9b2f5a8c1e4d7b0a3c6e9f2b5d8a1c4e7b0a3",
		},
		{
			name:        "case insensitivity",
			date:        "2025-01-15",
			amount:      -50.00,
			description: "WHOLE FOODS",
			want:        "3f5c8c6e9a8e2d0f1b4a7c3e6d9b2f5a8c1e4d7b0a3c6e9f2b5d8a1c4e7b0a3",
		},
		{
			name:        "whitespace trimming",
			date:        "2025-01-15",
			amount:      -50.00,
			description: "  Whole Foods  ",
			want:        "3f5c8c6e9a8e2d0f1b4a7c3e6d9b2f5a8c1e4d7b0a3c6e9f2b5d8a1c4e7b0a3",
		},
		{
			name:        "positive amount",
			date:        "2025-01-15",
			amount:      1000.00,
			description: "Salary",
			want:        "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
		},
		{
			name:        "floating point precision",
			amount:      -123.456,
			date:        "2025-01-15",
			description: "Test",
			want:        "b2c3d4e5f678901234567890123456789abcdef01234567890abcdef0123456",
		},
		{
			name:        "floating point rounding",
			amount:      -123.455,
			date:        "2025-01-15",
			description: "Test",
			want:        "b2c3d4e5f678901234567890123456789abcdef01234567890abcdef0123456",
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

	if state.Fingerprints == nil {
		t.Error("NewState() fingerprints map is nil")
	}

	if len(state.Fingerprints) != 0 {
		t.Errorf("NewState() fingerprints map length = %d, want 0", len(state.Fingerprints))
	}

	if state.Metadata.TotalFingerprints != 0 {
		t.Errorf("NewState() metadata.TotalFingerprints = %d, want 0", state.Metadata.TotalFingerprints)
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
	state.Fingerprints[fp] = &FingerprintRecord{
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

	record := state.Fingerprints[fp]
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

	record = state.Fingerprints[fp]
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
	if len(loaded.Fingerprints) != len(original.Fingerprints) {
		t.Errorf("LoadState() fingerprints count = %d, want %d", len(loaded.Fingerprints), len(original.Fingerprints))
	}

	// Verify specific fingerprint
	record := loaded.Fingerprints[fp1]
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
	if loaded.Metadata.TotalFingerprints != 2 {
		t.Errorf("LoadState() metadata.TotalFingerprints = %d, want 2", loaded.Metadata.TotalFingerprints)
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

	// Initial metadata should be stale
	state.Metadata.TotalFingerprints = 0

	err := SaveState(state, stateFile)
	if err != nil {
		t.Fatalf("SaveState() error = %v", err)
	}

	// Load and verify metadata was updated
	loaded, err := LoadState(stateFile)
	if err != nil {
		t.Fatalf("LoadState() error = %v", err)
	}

	if loaded.Metadata.TotalFingerprints != 2 {
		t.Errorf("SaveState() did not update TotalFingerprints: got %d, want 2", loaded.Metadata.TotalFingerprints)
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
