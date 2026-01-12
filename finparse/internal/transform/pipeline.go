package transform

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rumor-ml/commons.systems/finparse/internal/dedup"
	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
	"github.com/rumor-ml/commons.systems/finparse/internal/rules"
)

// TransformStats contains statistics from transformation process.
//
// Example slices are capped at 5 items to limit CLI output verbosity while
// still providing useful debugging context. The cap of 5 balances providing
// helpful examples without overwhelming users with excessive output.
//
// Fields use defensive encapsulation: example slices are unexported and
// accessed via methods that return defensive copies to prevent external
// modification of internal state.
type TransformStats struct {
	DuplicatesSkipped            int
	RulesMatched                 int
	RulesUnmatched               int
	unmatchedExamples            []string // unexported, capped at 5 items
	DuplicateInstitutionsSkipped int
	DuplicateAccountsSkipped     int
	duplicateExamples            []string // unexported, capped at 5 items
}

// UnmatchedExamples returns a defensive copy of unmatched transaction examples (max 5 items).
func (s *TransformStats) UnmatchedExamples() []string {
	result := make([]string, len(s.unmatchedExamples))
	copy(result, s.unmatchedExamples)
	return result
}

// DuplicateExamples returns a defensive copy of duplicate transaction examples (max 5 items).
func (s *TransformStats) DuplicateExamples() []string {
	result := make([]string, len(s.duplicateExamples))
	copy(result, s.duplicateExamples)
	return result
}

// addUnmatchedExample adds an example if under the 5-item cap.
func (s *TransformStats) addUnmatchedExample(example string) {
	if len(s.unmatchedExamples) < 5 {
		s.unmatchedExamples = append(s.unmatchedExamples, example)
	}
}

// addDuplicateExample adds an example if under the 5-item cap.
func (s *TransformStats) addDuplicateExample(example string) {
	if len(s.duplicateExamples) < 5 {
		s.duplicateExamples = append(s.duplicateExamples, example)
	}
}

// TransformStatement converts RawStatement to domain types and adds to Budget.
// Institutions and accounts are added idempotently (duplicates are silently skipped).
// Statements and transactions will fail on duplicates (data quality issue).
// Optional state parameter enables deduplication (nil to disable).
// Optional engine parameter enables rule-based categorization (nil to disable).
// Returns statistics about the transformation process.
func TransformStatement(raw *parser.RawStatement, budget *domain.Budget, state *dedup.State, engine *rules.Engine) (*TransformStats, error) {
	if raw == nil {
		return nil, fmt.Errorf("raw statement cannot be nil")
	}
	if budget == nil {
		return nil, fmt.Errorf("budget cannot be nil")
	}

	stats := &TransformStats{
		unmatchedExamples: make([]string, 0, 5),
		duplicateExamples: make([]string, 0, 5),
	}

	institution, err := transformInstitution(&raw.Account)
	if err != nil {
		return nil, fmt.Errorf("failed to transform institution: %w", err)
	}

	// Add institution (idempotent - silently skip if already exists)
	if err := budget.AddInstitution(*institution); err != nil {
		if !errors.Is(err, domain.ErrAlreadyExists) {
			return nil, fmt.Errorf("failed to add institution: %w", err)
		}
		// TODO(#1424): Consider caching strategy
		// Duplicate institutions are expected when processing multiple statements
		// from the same institution. Tracked for debugging but not logged in normal operation.
		stats.DuplicateInstitutionsSkipped++
	}

	account, err := transformAccount(&raw.Account, institution.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to transform account: %w", err)
	}

	// Add account (idempotent - silently skip if already exists)
	if err := budget.AddAccount(*account); err != nil {
		if !errors.Is(err, domain.ErrAlreadyExists) {
			return nil, fmt.Errorf("failed to add account: %w", err)
		}
		// TODO(#1424): Consider caching strategy
		// Duplicate accounts are expected when processing multiple statements
		// from the same account. Tracked for debugging but not logged in normal operation.
		stats.DuplicateAccountsSkipped++
	}

	statement, err := transformStatement(raw, account.ID)
	if err != nil {
		return nil, fmt.Errorf("failed to transform statement: %w", err)
	}

	if err := budget.AddStatement(*statement); err != nil {
		return nil, fmt.Errorf("failed to add statement: %w", err)
	}

	// TODO(#1347): Consider adding benchmark tests for large transaction volumes
	for i, rawTxn := range raw.Transactions {
		// Transform basic transaction
		txn, txnMatched, err := transformTransaction(&rawTxn, statement.ID, engine)
		if err != nil {
			return nil, fmt.Errorf("failed to transform transaction %d/%d (ID: %q, date: %s): %w",
				i+1, len(raw.Transactions), rawTxn.ID(), rawTxn.Date().Format("2006-01-02"), err)
		}

		// Track rule matching statistics
		if engine != nil {
			if txnMatched {
				stats.RulesMatched++
			} else {
				stats.RulesUnmatched++
				stats.addUnmatchedExample(txn.Description)
			}
		}

		// Generate fingerprint for deduplication
		fingerprint := dedup.GenerateFingerprint(txn.Date, txn.Amount, txn.Description)

		// Check for duplicates if state is provided
		if state != nil {
			if state.IsDuplicate(fingerprint) {
				// TODO(#1425): Comment about duplicate detection warns about "noise" but doesn't quantify acceptable noise level
				// Skip duplicate transaction - already processed in a previous run.
				// Duplicate count is tracked in stats for user visibility.
				// Individual duplicates not logged to avoid noise when processing
				// overlapping statement date ranges.
				stats.DuplicatesSkipped++

				// Track first few duplicates for verbose mode debugging
				stats.addDuplicateExample(
					fmt.Sprintf("%s: %s (%.2f)", txn.Date, txn.Description, txn.Amount))

				continue
			}
		}

		// Add transaction to budget
		if err := budget.AddTransaction(*txn); err != nil {
			return nil, fmt.Errorf("failed to add transaction %d/%d (ID: %q): %w",
				i+1, len(raw.Transactions), txn.ID, err)
		}

		// TODO(#1421): Clarify why transaction date isn't sufficient for tracking
		// Record in state if provided. Uses time.Now() to track when we first/last observed
		// this fingerprint during parsing, not the transaction date. This enables:
		//   - Debugging when duplicate detection started (state file history)
		//   - State file cleanup (remove fingerprints not seen in N days)
		//   - Auditing when transactions were processed vs when they occurred
		if state != nil {
			if err := state.RecordTransaction(fingerprint, txn.ID, time.Now()); err != nil {
				return nil, fmt.Errorf("failed to record transaction fingerprint: %w", err)
			}
		}
	}

	return stats, nil
}

// transformInstitution creates a domain Institution from RawAccount
func transformInstitution(raw *parser.RawAccount) (*domain.Institution, error) {
	name := raw.InstitutionName()
	if name == "" {
		return nil, fmt.Errorf("institution name cannot be empty")
	}

	slug, err := SlugifyInstitution(name)
	if err != nil {
		return nil, fmt.Errorf("failed to slugify institution name: %w", err)
	}

	institution, err := domain.NewInstitution(slug, name)
	if err != nil {
		return nil, fmt.Errorf("failed to create institution: %w", err)
	}
	return institution, nil
}

// transformAccount creates a domain Account from RawAccount
func transformAccount(raw *parser.RawAccount, institutionID string) (*domain.Account, error) {
	accountNumber := raw.AccountID()
	if accountNumber == "" {
		return nil, fmt.Errorf("account number cannot be empty")
	}

	// Generate account ID (institutionID is already slugified)
	accountID := GenerateAccountID(institutionID, accountNumber)

	// Map account type
	accountType, err := mapAccountType(raw.AccountType())
	if err != nil {
		return nil, err
	}

	// Create display name from last 4 digits (e.g., "Account 2011")
	// TODO(#1363): Support user-defined account nicknames (e.g., "Primary Checking")
	// instead of generic "Account 2011" names. Would require:
	//   - Config file mapping institution+account -> nickname
	//   - OR extending Account domain model with optional nickname field
	//   - OR external metadata store (separate from statement files)
	accountName := fmt.Sprintf("Account %s", ExtractLast4(accountNumber))

	account, err := domain.NewAccount(accountID, institutionID, accountName, accountType)
	if err != nil {
		return nil, fmt.Errorf("failed to create account: %w", err)
	}
	return account, nil
}

// transformStatement creates a domain Statement from RawStatement
func transformStatement(raw *parser.RawStatement, accountID string) (*domain.Statement, error) {
	periodStart := raw.Period.Start()
	periodEnd := raw.Period.End()

	// Generate statement ID
	statementID := GenerateStatementID(periodStart, accountID)

	// Format dates as YYYY-MM-DD
	startDate := formatDate(periodStart)
	endDate := formatDate(periodEnd)

	statement, err := domain.NewStatement(statementID, accountID, startDate, endDate)
	if err != nil {
		return nil, fmt.Errorf("failed to create statement: %w", err)
	}
	return statement, nil
}

// transformTransaction creates a domain Transaction from RawTransaction.
// Optional engine parameter enables rule-based categorization (nil to disable).
// Returns the transaction, whether a rule matched, and any error.
func transformTransaction(raw *parser.RawTransaction, statementID string, engine *rules.Engine) (*domain.Transaction, bool, error) {
	// Use existing ID from RawTransaction (stable from parser)
	txnID := raw.ID()
	if txnID == "" {
		return nil, false, fmt.Errorf("transaction ID cannot be empty")
	}

	// Format date as YYYY-MM-DD
	date := formatDate(raw.Date())

	description := raw.Description()
	if description == "" {
		return nil, false, fmt.Errorf("transaction description cannot be empty")
	}

	amount := raw.Amount()

	// Create transaction with default category
	txn, err := domain.NewTransaction(txnID, date, description, amount, domain.CategoryOther)
	if err != nil {
		return nil, false, err
	}

	// TODO(#1419): Improve comment to explain validation mechanism
	// Apply rules if engine provided. Match() cannot fail because invalid match types
	// are caught during engine initialization (NewEngine validation). The matched boolean
	// indicates whether any rule matched the description.
	var matched bool
	var result *rules.MatchResult
	if engine != nil {
		result, matched = engine.Match(description)
	}

	if matched {
		// Apply matched rule
		txn.Category = result.Category
		txn.Vacation = result.Vacation
		txn.Transfer = result.Transfer
		if err := txn.SetRedeemable(result.Redeemable, result.RedemptionRate); err != nil {
			return nil, false, fmt.Errorf("failed to set redeemable from rule: %w", err)
		}
	} else {
		// No match or no engine: use defaults
		txn.Vacation = false
		txn.Transfer = false
		if err := txn.SetRedeemable(false, 0.0); err != nil {
			return nil, false, err
		}
	}

	txn.LinkedTransactionID = nil

	// Link transaction to statement
	if err := txn.AddStatementID(statementID); err != nil {
		return nil, false, fmt.Errorf("failed to link transaction to statement: %w", err)
	}

	return txn, matched, nil
}

// mapAccountType converts raw account type string to domain AccountType enum
func mapAccountType(rawType string) (domain.AccountType, error) {
	original := rawType
	// Normalize: lowercase and trim whitespace
	normalized := strings.ToLower(strings.TrimSpace(rawType))

	switch normalized {
	case "checking", "checking account":
		return domain.AccountTypeChecking, nil
	case "savings", "savings account":
		return domain.AccountTypeSavings, nil
	case "credit", "credit card", "creditcard":
		return domain.AccountTypeCredit, nil
	case "investment", "brokerage":
		return domain.AccountTypeInvestment, nil
	default:
		validTypes := []string{"checking", "savings", "credit", "investment"}
		if original != normalized {
			return "", fmt.Errorf("unknown account type: %q (normalized to %q). Valid types: %v",
				original, normalized, validTypes)
		}
		return "", fmt.Errorf("unknown account type: %q. Valid types: %v",
			original, validTypes)
	}
}

// formatDate converts time.Time to YYYY-MM-DD format
func formatDate(t time.Time) string {
	return t.Format("2006-01-02")
}
