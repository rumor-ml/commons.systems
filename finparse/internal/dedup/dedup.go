// Package dedup provides transaction deduplication via SHA256 fingerprinting and state persistence.
package dedup

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// State represents the deduplication state with fingerprint history.
type State struct {
	Version      int                           `json:"version"`
	Fingerprints map[string]*FingerprintRecord `json:"fingerprints"`
	Metadata     StateMetadata                 `json:"metadata"`
}

// FingerprintRecord tracks a transaction fingerprint across multiple observations.
type FingerprintRecord struct {
	FirstSeen     time.Time `json:"firstSeen"`
	LastSeen      time.Time `json:"lastSeen"`
	Count         int       `json:"count"`
	TransactionID string    `json:"transactionId"`
}

// StateMetadata contains aggregate statistics about the state.
type StateMetadata struct {
	LastUpdated       time.Time `json:"lastUpdated"`
	TotalFingerprints int       `json:"totalFingerprints"`
}

const (
	// CurrentVersion is the current state file format version
	CurrentVersion = 1
)

// NewState creates an empty deduplication state with version 1.
func NewState() *State {
	return &State{
		Version:      CurrentVersion,
		Fingerprints: make(map[string]*FingerprintRecord),
		Metadata: StateMetadata{
			LastUpdated:       time.Now(),
			TotalFingerprints: 0,
		},
	}
}

// GenerateFingerprint creates a SHA256 hash of date, amount, and description.
// Format: SHA256("{date}|{amount}|{normalizedDescription}")
// Amount is formatted with 2 decimal places for consistency.
// Description is normalized: lowercase and trimmed.
func GenerateFingerprint(date string, amount float64, description string) string {
	// Normalize description
	normalizedDesc := strings.ToLower(strings.TrimSpace(description))

	// Format amount with 2 decimal places
	formattedAmount := fmt.Sprintf("%.2f", amount)

	// Create fingerprint input
	input := fmt.Sprintf("%s|%s|%s", date, formattedAmount, normalizedDesc)

	// Hash with SHA256
	hash := sha256.Sum256([]byte(input))
	return hex.EncodeToString(hash[:])
}

// LoadState loads a state file from disk.
// Returns os.IsNotExist error if file doesn't exist (caller should handle).
func LoadState(filePath string) (*State, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err // Preserve os.IsNotExist for caller
	}

	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, fmt.Errorf("failed to parse state file: %w", err)
	}

	// Validate version
	if state.Version != CurrentVersion {
		return nil, fmt.Errorf("unsupported state file version %d (current version: %d)", state.Version, CurrentVersion)
	}

	// Ensure fingerprints map is initialized
	if state.Fingerprints == nil {
		state.Fingerprints = make(map[string]*FingerprintRecord)
	}

	return &state, nil
}

// SaveState atomically writes the state to disk.
// Uses atomic write pattern: write to temp file, then rename.
// Ensures parent directory exists.
func SaveState(state *State, filePath string) error {
	// Ensure directory exists
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Update metadata
	state.Metadata.LastUpdated = time.Now()
	state.Metadata.TotalFingerprints = len(state.Fingerprints)

	// Marshal to JSON with indentation for readability
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal state: %w", err)
	}

	// Atomic write pattern: write to temp file, then rename
	tempFile := filePath + ".tmp"
	if err := os.WriteFile(tempFile, data, 0644); err != nil {
		return fmt.Errorf("failed to write temp file: %w", err)
	}

	if err := os.Rename(tempFile, filePath); err != nil {
		// Clean up temp file on error
		os.Remove(tempFile)
		return fmt.Errorf("failed to rename temp file: %w", err)
	}

	return nil
}

// IsDuplicate checks if a fingerprint exists in the state.
func (s *State) IsDuplicate(fingerprint string) bool {
	_, exists := s.Fingerprints[fingerprint]
	return exists
}

// RecordTransaction records a transaction fingerprint in the state.
// If new: creates record with firstSeen=timestamp, count=1.
// If exists: updates lastSeen=timestamp, increments count.
func (s *State) RecordTransaction(fingerprint, transactionID string, timestamp time.Time) error {
	if fingerprint == "" {
		return fmt.Errorf("fingerprint cannot be empty")
	}
	if transactionID == "" {
		return fmt.Errorf("transaction ID cannot be empty")
	}

	if record, exists := s.Fingerprints[fingerprint]; exists {
		// Update existing record
		record.LastSeen = timestamp
		record.Count++
	} else {
		// Create new record
		s.Fingerprints[fingerprint] = &FingerprintRecord{
			FirstSeen:     timestamp,
			LastSeen:      timestamp,
			Count:         1,
			TransactionID: transactionID,
		}
	}

	return nil
}
