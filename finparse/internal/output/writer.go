package output

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
)

// WriteOptions configures how the budget is written
// TODO(#1342): Consider whether inline struct field comments add sufficient value
type WriteOptions struct {
	MergeMode bool   // If true, load existing file and merge
	FilePath  string // Output path (empty = stdout)
}

// WriteBudget serializes Budget to JSON with 2-space indentation
func WriteBudget(budget *domain.Budget, w io.Writer) error {
	if budget == nil {
		return fmt.Errorf("budget cannot be nil")
	}

	encoder := json.NewEncoder(w)
	// TODO(#1345): Comment restates obvious code without adding value
	encoder.SetIndent("", "  ") // 2-space indentation
	if err := encoder.Encode(budget); err != nil {
		return fmt.Errorf("failed to encode budget as JSON: %w", err)
	}

	return nil
}

// WriteBudgetToFile writes Budget to file or stdout based on options
func WriteBudgetToFile(budget *domain.Budget, opts WriteOptions) (err error) {
	if budget == nil {
		return fmt.Errorf("budget cannot be nil")
	}

	// Handle merge mode
	if opts.MergeMode && opts.FilePath != "" {
		existingBudget, err := LoadBudget(opts.FilePath)
		if err != nil {
			// If file doesn't exist, treat as fresh mode
			if !os.IsNotExist(err) {
				return fmt.Errorf("failed to load existing budget for merge: %w", err)
			}
			// File doesn't exist, create new file
			fmt.Fprintf(os.Stderr, "Warning: merge mode requested but %s does not exist, creating new file\n", opts.FilePath)
		} else {
			// Merge new budget into existing budget
			if err := mergeBudgets(existingBudget, budget); err != nil {
				return fmt.Errorf("failed to merge budgets: %w", err)
			}
			budget = existingBudget // Use the merged budget
		}
	}

	// Write to stdout if no file path specified
	if opts.FilePath == "" {
		// For stdout, validate by encoding to buffer first to catch errors
		// before writing any partial output
		var buf bytes.Buffer
		if err := WriteBudget(budget, &buf); err != nil {
			return fmt.Errorf("failed to encode budget (no output written): %w", err)
		}
		// Only write to stdout after successful encoding
		if _, err := os.Stdout.Write(buf.Bytes()); err != nil {
			return fmt.Errorf("failed to write to stdout: %w", err)
		}
		return nil
	}

	// Write to temporary file first for atomic replacement
	tmpFile := opts.FilePath + ".tmp"
	f, err := os.Create(tmpFile)
	if err != nil {
		return fmt.Errorf("failed to create temp file %s: %w", tmpFile, err)
	}

	// Write budget to temp file
	writeErr := WriteBudget(budget, f)
	closeErr := f.Close()

	// Handle write error first
	if writeErr != nil {
		os.Remove(tmpFile) // Clean up on write failure
		return fmt.Errorf("failed to write budget to temp file: %w", writeErr)
	}

	// Then handle close error
	if closeErr != nil {
		os.Remove(tmpFile) // Clean up on close failure
		return fmt.Errorf("failed to close temp file before rename: %w", closeErr)
	}

	// Atomic rename (on Unix systems, this is atomic)
	if err = os.Rename(tmpFile, opts.FilePath); err != nil {
		os.Remove(tmpFile) // Clean up on rename failure
		return fmt.Errorf("failed to rename temp file to %s: %w", opts.FilePath, err)
	}

	return nil
}

// LoadBudget reads existing budget.json for merge mode
func LoadBudget(filePath string) (budget *domain.Budget, err error) {
	if filePath == "" {
		return nil, fmt.Errorf("file path cannot be empty")
	}

	f, err := os.Open(filePath)
	if err != nil {
		// Return unwrapped error so caller can check os.IsNotExist
		// to distinguish "file not found" from other loading errors
		return nil, err
	}
	defer func() {
		if closeErr := f.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("failed to close %s: %w", filePath, closeErr)
		}
	}()

	var b domain.Budget
	decoder := json.NewDecoder(f)
	if err = decoder.Decode(&b); err != nil {
		return nil, fmt.Errorf("failed to decode budget JSON: %w", err)
	}

	return &b, nil
}

// mergeBudgets adds all entities from source into target
// Duplicate institutions/accounts are skipped (idempotent)
// Duplicate statements/transactions return errors (data quality issue)
func mergeBudgets(target, source *domain.Budget) error {
	if target == nil || source == nil {
		return fmt.Errorf("budgets cannot be nil")
	}

	// Merge institutions (idempotent)
	for _, inst := range source.GetInstitutions() {
		if err := target.AddInstitution(inst); err != nil {
			// Continue if error is the specific "already exists" error (idempotent)
			// Return error for any other failure (e.g., validation errors)
			if !errors.Is(err, domain.ErrAlreadyExists) {
				return fmt.Errorf("failed to merge institution %s: %w", inst.ID, err)
			}
		}
	}

	// Merge accounts (idempotent)
	for _, acc := range source.GetAccounts() {
		if err := target.AddAccount(acc); err != nil {
			// Continue if error is the specific "already exists" error (idempotent)
			// Return error for any other failure (e.g., validation errors)
			if !errors.Is(err, domain.ErrAlreadyExists) {
				return fmt.Errorf("failed to merge account %s: %w", acc.ID, err)
			}
		}
	}

	// Merge statements (fail on duplicates)
	for _, stmt := range source.GetStatements() {
		if err := target.AddStatement(stmt); err != nil {
			return fmt.Errorf("failed to merge statement %s: %w", stmt.ID, err)
		}
	}

	// Merge transactions (fail on duplicates)
	for _, txn := range source.GetTransactions() {
		if err := target.AddTransaction(txn); err != nil {
			return fmt.Errorf("failed to merge transaction %s: %w", txn.ID, err)
		}
	}

	return nil
}
