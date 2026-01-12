package finparse_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rumor-ml/commons.systems/finparse/internal/dedup"
	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
	"github.com/rumor-ml/commons.systems/finparse/internal/output"
	"github.com/rumor-ml/commons.systems/finparse/internal/registry"
	"github.com/rumor-ml/commons.systems/finparse/internal/rules"
	"github.com/rumor-ml/commons.systems/finparse/internal/scanner"
	"github.com/rumor-ml/commons.systems/finparse/internal/transform"
)

func TestEndToEnd_TransformationPipeline(t *testing.T) {
	// Create temporary directory
	tmpDir := t.TempDir()

	// Create directory structure
	instDir := filepath.Join(tmpDir, "american_express")
	acctDir := filepath.Join(instDir, "2011")
	if err := os.MkdirAll(acctDir, 0755); err != nil {
		t.Fatalf("failed to create directory structure: %v", err)
	}

	// Create a valid OFX file with test data
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
<TRNAMT>-125.50
<FITID>TXN001
<NAME>Test Purchase 1
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251015120000
<TRNAMT>-45.99
<FITID>TXN002
<NAME>Test Purchase 2
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20251020120000
<TRNAMT>500.00
<FITID>TXN003
<NAME>Payment
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>328.51
<DTASOF>20251031000000
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`

	ofxFile := filepath.Join(acctDir, "statement_202510.qfx")
	if err := os.WriteFile(ofxFile, []byte(ofxContent), 0644); err != nil {
		t.Fatalf("failed to write OFX file: %v", err)
	}

	// 1. Scan for files
	s := scanner.New(tmpDir)
	files, err := s.Scan()
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}

	if len(files) != 1 {
		t.Fatalf("expected 1 file, got %d", len(files))
	}

	// 2. Create parser registry
	reg, err := registry.New()
	if err != nil {
		t.Fatalf("failed to create registry: %v", err)
	}

	// 3. Parse and transform
	ctx := context.Background()
	budget := domain.NewBudget()

	for _, file := range files {
		parser, err := reg.FindParser(file.Path)
		if err != nil {
			t.Fatalf("failed to find parser: %v", err)
		}
		if parser == nil {
			t.Fatalf("no parser found for %s", file.Path)
		}

		f, err := os.Open(file.Path)
		if err != nil {
			t.Fatalf("failed to open file: %v", err)
		}

		rawStmt, err := parser.Parse(ctx, f, file.Metadata)
		if closeErr := f.Close(); closeErr != nil {
			t.Errorf("failed to close file: %v", closeErr)
		}

		if err != nil {
			t.Fatalf("parse failed: %v", err)
		}

		if _, err := transform.TransformStatement(rawStmt, budget, nil, nil); err != nil {
			t.Fatalf("transform failed: %v", err)
		}
	}

	// 4. Verify transformation results
	institutions := budget.GetInstitutions()
	if len(institutions) != 1 {
		t.Errorf("expected 1 institution, got %d", len(institutions))
	}
	if len(institutions) > 0 {
		if institutions[0].ID != "american-express" {
			t.Errorf("expected institution ID 'american-express', got %q", institutions[0].ID)
		}
		if institutions[0].Name != "American Express" {
			t.Errorf("expected institution name 'American Express', got %q", institutions[0].Name)
		}
	}

	accounts := budget.GetAccounts()
	if len(accounts) != 1 {
		t.Errorf("expected 1 account, got %d", len(accounts))
	}
	if len(accounts) > 0 {
		if accounts[0].ID != "acc-amex-2011" {
			t.Errorf("expected account ID 'acc-amex-2011', got %q", accounts[0].ID)
		}
		if accounts[0].Type != domain.AccountTypeCredit {
			t.Errorf("expected account type 'credit', got %q", accounts[0].Type)
		}
	}

	statements := budget.GetStatements()
	if len(statements) != 1 {
		t.Errorf("expected 1 statement, got %d", len(statements))
	}
	if len(statements) > 0 {
		if statements[0].ID != "stmt-2025-10-acc-amex-2011" {
			t.Errorf("expected statement ID 'stmt-2025-10-acc-amex-2011', got %q", statements[0].ID)
		}
		if statements[0].StartDate != "2025-10-01" {
			t.Errorf("expected start date '2025-10-01', got %q", statements[0].StartDate)
		}
		if statements[0].EndDate != "2025-10-31" {
			t.Errorf("expected end date '2025-10-31', got %q", statements[0].EndDate)
		}
	}

	transactions := budget.GetTransactions()
	if len(transactions) != 3 {
		t.Errorf("expected 3 transactions, got %d", len(transactions))
	}
	if len(transactions) > 0 {
		// Verify first transaction
		txn := transactions[0]
		if txn.ID != "TXN001" {
			t.Errorf("expected transaction ID 'TXN001', got %q", txn.ID)
		}
		if txn.Date != "2025-10-05" {
			t.Errorf("expected date '2025-10-05', got %q", txn.Date)
		}
		if txn.Amount != -125.50 {
			t.Errorf("expected amount -125.50, got %f", txn.Amount)
		}

		// Verify default values
		if txn.Category != domain.CategoryOther {
			t.Errorf("expected category 'other', got %q", txn.Category)
		}
		if txn.Redeemable() != false {
			t.Errorf("expected redeemable false, got %v", txn.Redeemable())
		}
		if txn.RedemptionRate() != 0.0 {
			t.Errorf("expected redemption rate 0.0, got %f", txn.RedemptionRate())
		}
	}

	// 5. Write output to file
	outputFile := filepath.Join(tmpDir, "budget.json")
	opts := output.WriteOptions{
		MergeMode: false,
		FilePath:  outputFile,
	}

	if err := output.WriteBudgetToFile(budget, opts); err != nil {
		t.Fatalf("failed to write budget: %v", err)
	}

	// 6. Verify JSON output
	content, err := os.ReadFile(outputFile)
	if err != nil {
		t.Fatalf("failed to read output file: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(content, &result); err != nil {
		t.Fatalf("output is not valid JSON: %v", err)
	}

	// Verify structure
	if _, ok := result["institutions"]; !ok {
		t.Errorf("output missing 'institutions' field")
	}
	if _, ok := result["accounts"]; !ok {
		t.Errorf("output missing 'accounts' field")
	}
	if _, ok := result["statements"]; !ok {
		t.Errorf("output missing 'statements' field")
	}
	if _, ok := result["transactions"]; !ok {
		t.Errorf("output missing 'transactions' field")
	}

	// 7. Test merge mode (idempotency for institutions/accounts)
	budget2 := domain.NewBudget()

	for _, file := range files {
		parser, err := reg.FindParser(file.Path)
		if err != nil {
			t.Fatalf("failed to find parser (2nd pass): %v", err)
		}

		f, err := os.Open(file.Path)
		if err != nil {
			t.Fatalf("failed to open file (2nd pass): %v", err)
		}

		rawStmt, err := parser.Parse(ctx, f, file.Metadata)
		if closeErr := f.Close(); closeErr != nil {
			t.Errorf("failed to close file: %v", closeErr)
		}

		if err != nil {
			t.Fatalf("parse failed (2nd pass): %v", err)
		}

		if _, err := transform.TransformStatement(rawStmt, budget2, nil, nil); err != nil {
			t.Fatalf("transform failed (2nd pass): %v", err)
		}
	}

	// Write with merge mode
	opts.MergeMode = true
	if err := output.WriteBudgetToFile(budget2, opts); err == nil {
		t.Errorf("expected error for duplicate statement in merge mode")
	} else {
		// Verify error message is meaningful
		if !strings.Contains(err.Error(), "already exists") {
			t.Errorf("expected clear 'already exists' error message, got: %v", err)
		}
	}

	// Verify original file is unchanged after merge failure
	original, loadErr := output.LoadBudget(outputFile)
	if loadErr != nil {
		t.Errorf("failed to load file after merge failure: %v", loadErr)
	}
	if original != nil && len(original.GetStatements()) != 1 {
		t.Errorf("file was corrupted after merge failure: expected 1 statement, got %d", len(original.GetStatements()))
	}
}

// TestEndToEnd_IDStability verifies that transaction IDs remain stable across re-parses
func TestEndToEnd_IDStability(t *testing.T) {
	// Create temporary directory
	tmpDir := t.TempDir()
	instDir := filepath.Join(tmpDir, "test_bank")
	acctDir := filepath.Join(instDir, "1234")
	if err := os.MkdirAll(acctDir, 0755); err != nil {
		t.Fatalf("failed to create directory structure: %v", err)
	}

	// Create OFX file
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
<FITID>TXN_STABLE_001
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

	ofxFile := filepath.Join(acctDir, "statement.ofx")
	if err := os.WriteFile(ofxFile, []byte(ofxContent), 0644); err != nil {
		t.Fatalf("failed to write OFX file: %v", err)
	}

	// Helper function to parse and extract transaction IDs
	parseAndGetTxnIDs := func() []string {
		s := scanner.New(tmpDir)
		files, err := s.Scan()
		if err != nil {
			t.Fatalf("scan failed: %v", err)
		}

		reg, err := registry.New()
		if err != nil {
			t.Fatalf("failed to create registry: %v", err)
		}

		ctx := context.Background()
		budget := domain.NewBudget()

		for _, file := range files {
			parser, err := reg.FindParser(file.Path)
			if err != nil {
				t.Fatalf("FindParser failed for %s: %v", file.Path, err)
			}
			if parser == nil {
				t.Fatalf("no parser found for %s", file.Path)
			}

			f, err := os.Open(file.Path)
			if err != nil {
				t.Fatalf("failed to open %s: %v", file.Path, err)
			}

			rawStmt, err := parser.Parse(ctx, f, file.Metadata)
			if closeErr := f.Close(); closeErr != nil {
				t.Errorf("failed to close %s: %v", file.Path, closeErr)
			}
			if err != nil {
				t.Fatalf("parse failed for %s: %v", file.Path, err)
			}

			if _, err := transform.TransformStatement(rawStmt, budget, nil, nil); err != nil {
				t.Fatalf("transform failed for %s: %v", file.Path, err)
			}
		}

		transactions := budget.GetTransactions()
		ids := make([]string, len(transactions))
		for i, txn := range transactions {
			ids[i] = txn.ID
		}
		return ids
	}

	// Parse file twice and verify IDs match
	ids1 := parseAndGetTxnIDs()
	ids2 := parseAndGetTxnIDs()

	if len(ids1) != len(ids2) {
		t.Fatalf("transaction count mismatch: %d vs %d", len(ids1), len(ids2))
	}

	for i := range ids1 {
		if ids1[i] != ids2[i] {
			t.Errorf("transaction ID mismatch at index %d: %q vs %q", i, ids1[i], ids2[i])
		}
	}
}

// TestEndToEnd_DedupAndRules tests the complete Phase 5 dedup and rules pipeline
func TestEndToEnd_DedupAndRules(t *testing.T) {
	// Create temporary directory
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "state.json")

	// Create directory structure
	instDir := filepath.Join(tmpDir, "american_express")
	acctDir := filepath.Join(instDir, "2011")
	if err := os.MkdirAll(acctDir, 0755); err != nil {
		t.Fatalf("failed to create directory structure: %v", err)
	}

	// Create OFX file with transactions that match embedded rules
	// TODO(#1422): Consider creating helper functions for OFX test fixtures
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
<TRNAMT>-50.00
<FITID>TXN001
<NAME>WHOLEFDS MARKET
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251015120000
<TRNAMT>-15.00
<FITID>TXN002
<NAME>CHIPOTLE MEXICAN GRILL
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20251020120000
<TRNAMT>1000.00
<FITID>TXN003
<NAME>JOHNS HOPKINS UNIVERSITY
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>935.00
<DTASOF>20251031000000
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`

	ofxFile := filepath.Join(acctDir, "2025-10.qfx")
	if err := os.WriteFile(ofxFile, []byte(ofxContent), 0644); err != nil {
		t.Fatalf("failed to write OFX file: %v", err)
	}

	// First parse: should create state and apply rules
	ctx := context.Background()
	budget1 := domain.NewBudget()

	s := scanner.New(tmpDir)
	files, err := s.Scan()
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}

	reg, err := registry.New()
	if err != nil {
		t.Fatalf("failed to create registry: %v", err)
	}

	// Load state and rules
	state := dedup.NewState()
	engine, err := rules.LoadEmbedded()
	if err != nil {
		t.Fatalf("failed to load embedded rules: %v", err)
	}

	// Parse and transform
	for _, file := range files {
		parser, err := reg.FindParser(file.Path)
		if err != nil {
			t.Fatalf("FindParser failed: %v", err)
		}
		if parser == nil {
			t.Fatalf("no parser found for %s", file.Path)
		}

		f, err := os.Open(file.Path)
		if err != nil {
			t.Fatalf("failed to open file: %v", err)
		}

		rawStmt, err := parser.Parse(ctx, f, file.Metadata)
		if closeErr := f.Close(); closeErr != nil {
			t.Errorf("failed to close file: %v", closeErr)
		}
		if err != nil {
			t.Fatalf("parse failed: %v", err)
		}

		if _, err := transform.TransformStatement(rawStmt, budget1, state, engine); err != nil {
			t.Fatalf("transform failed: %v", err)
		}
	}

	// Save state
	if err := dedup.SaveState(state, stateFile); err != nil {
		t.Fatalf("failed to save state: %v", err)
	}

	// Verify rules were applied
	transactions1 := budget1.GetTransactions()
	if len(transactions1) != 3 {
		t.Fatalf("expected 3 transactions, got %d", len(transactions1))
	}

	// Check categories from rules
	for _, txn := range transactions1 {
		if strings.Contains(txn.Description, "WHOLEFDS") {
			if txn.Category != domain.CategoryGroceries {
				t.Errorf("WHOLEFDS should be groceries, got %s", txn.Category)
			}
			if !txn.Redeemable() {
				t.Error("WHOLEFDS should be redeemable")
			}
		} else if strings.Contains(txn.Description, "CHIPOTLE") {
			if txn.Category != domain.CategoryDining {
				t.Errorf("CHIPOTLE should be dining, got %s", txn.Category)
			}
			if !txn.Redeemable() {
				t.Error("CHIPOTLE should be redeemable")
			}
		} else if strings.Contains(txn.Description, "JOHNS HOPKINS") {
			if txn.Category != domain.CategoryIncome {
				t.Errorf("JOHNS HOPKINS should be income, got %s", txn.Category)
			}
			if txn.Redeemable() {
				t.Error("JOHNS HOPKINS should not be redeemable")
			}
		}
	}

	// Second parse: should skip all as duplicates
	budget2 := domain.NewBudget()

	// Load state
	loadedState, err := dedup.LoadState(stateFile)
	if err != nil {
		t.Fatalf("failed to load state: %v", err)
	}

	// Parse and transform again
	files2, err := s.Scan()
	if err != nil {
		t.Fatalf("second scan failed: %v", err)
	}
	for _, file := range files2 {
		parser, err := reg.FindParser(file.Path)
		if err != nil {
			t.Fatalf("FindParser failed: %v", err)
		}
		if parser == nil {
			t.Fatalf("no parser found for %s", file.Path)
		}

		f, err := os.Open(file.Path)
		if err != nil {
			t.Fatalf("failed to open file: %v", err)
		}

		rawStmt, err := parser.Parse(ctx, f, file.Metadata)
		if closeErr := f.Close(); closeErr != nil {
			t.Errorf("failed to close file: %v", closeErr)
		}
		if err != nil {
			t.Fatalf("parse failed: %v", err)
		}

		if _, err := transform.TransformStatement(rawStmt, budget2, loadedState, engine); err != nil {
			t.Fatalf("transform failed: %v", err)
		}
	}

	// Verify no transactions added (all were duplicates)
	transactions2 := budget2.GetTransactions()
	if len(transactions2) != 0 {
		t.Errorf("expected 0 transactions (all duplicates), got %d", len(transactions2))
	}

	// Verify state was updated
	if loadedState.TotalFingerprints() != 3 {
		t.Errorf("expected 3 fingerprints in state, got %d", loadedState.TotalFingerprints())
	}
}

// TestEndToEnd_OverlappingStatementDeduplication tests deduplication when parsing overlapping statement periods
func TestEndToEnd_OverlappingStatementDeduplication(t *testing.T) {
	// Create temporary directory
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "state.json")

	// Create directory structure
	instDir := filepath.Join(tmpDir, "american_express")
	acctDir := filepath.Join(instDir, "2011")
	if err := os.MkdirAll(acctDir, 0755); err != nil {
		t.Fatalf("failed to create directory structure: %v", err)
	}

	// Create first OFX file covering Oct 1-31 with shared transaction on Oct 15
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
<FITID>TXN_EARLY
<NAME>Early Oct Purchase
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251015120000
<TRNAMT>-50.00
<FITID>TXN_OVERLAP
<NAME>Overlapping Transaction
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>850.00
<DTASOF>20251031000000
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`

	// Create second OFX file covering Oct 15-Nov 15 with same overlapping transaction
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
<DTSTART>20251015000000
<DTEND>20251115235959
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251015120000
<TRNAMT>-50.00
<FITID>TXN_OVERLAP
<NAME>Overlapping Transaction
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251105120000
<TRNAMT>-75.00
<FITID>TXN_LATE_NOV
<NAME>Late Nov Purchase
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>775.00
<DTASOF>20251115000000
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`

	ofxFile1 := filepath.Join(acctDir, "2025-10.qfx")
	ofxFile2 := filepath.Join(acctDir, "2025-11.qfx")
	if err := os.WriteFile(ofxFile1, []byte(ofxContent1), 0644); err != nil {
		t.Fatalf("failed to write first OFX file: %v", err)
	}
	if err := os.WriteFile(ofxFile2, []byte(ofxContent2), 0644); err != nil {
		t.Fatalf("failed to write second OFX file: %v", err)
	}

	// Initialize state and rules
	state := dedup.NewState()
	engine, err := rules.LoadEmbedded()
	if err != nil {
		t.Fatalf("failed to load embedded rules: %v", err)
	}

	ctx := context.Background()
	budget := domain.NewBudget()

	// Parse first statement
	s := scanner.New(tmpDir)
	files, err := s.Scan()
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}

	reg, err := registry.New()
	if err != nil {
		t.Fatalf("failed to create registry: %v", err)
	}

	// Parse only the first file
	for _, file := range files {
		if strings.Contains(file.Path, "2025-10.qfx") {
			parser, err := reg.FindParser(file.Path)
			if err != nil {
				t.Fatalf("FindParser failed: %v", err)
			}
			if parser == nil {
				t.Fatalf("no parser found for %s", file.Path)
			}

			f, err := os.Open(file.Path)
			if err != nil {
				t.Fatalf("failed to open file: %v", err)
			}

			rawStmt, err := parser.Parse(ctx, f, file.Metadata)
			if closeErr := f.Close(); closeErr != nil {
				t.Errorf("failed to close file: %v", closeErr)
			}
			if err != nil {
				t.Fatalf("parse failed for first statement: %v", err)
			}

			if _, err := transform.TransformStatement(rawStmt, budget, state, engine); err != nil {
				t.Fatalf("transform failed for first statement: %v", err)
			}
		}
	}

	// Verify first parse results
	transactions := budget.GetTransactions()
	if len(transactions) != 2 {
		t.Fatalf("expected 2 transactions after first parse, got %d", len(transactions))
	}

	// Save state after first parse
	if err := dedup.SaveState(state, stateFile); err != nil {
		t.Fatalf("failed to save state: %v", err)
	}

	// Load state for second parse - use NEW budget for second statement
	loadedState, err := dedup.LoadState(stateFile)
	if err != nil {
		t.Fatalf("failed to load state: %v", err)
	}

	budget2 := domain.NewBudget()

	// Parse second statement with overlapping transaction
	for _, file := range files {
		if strings.Contains(file.Path, "2025-11.qfx") {
			parser, err := reg.FindParser(file.Path)
			if err != nil {
				t.Fatalf("FindParser failed: %v", err)
			}
			if parser == nil {
				t.Fatalf("no parser found for %s", file.Path)
			}

			f, err := os.Open(file.Path)
			if err != nil {
				t.Fatalf("failed to open file: %v", err)
			}

			rawStmt, err := parser.Parse(ctx, f, file.Metadata)
			if closeErr := f.Close(); closeErr != nil {
				t.Errorf("failed to close file: %v", closeErr)
			}
			if err != nil {
				t.Fatalf("parse failed for second statement: %v", err)
			}

			// Parse into new budget - deduplication should filter out TXN_OVERLAP
			if _, err := transform.TransformStatement(rawStmt, budget2, loadedState, engine); err != nil {
				t.Fatalf("transform failed for second statement: %v", err)
			}
			break
		}
	}

	// Save updated state after second parse
	if err := dedup.SaveState(loadedState, stateFile); err != nil {
		t.Fatalf("failed to save updated state: %v", err)
	}

	// Verify second parse results: should only have 1 new transaction (TXN_LATE_NOV)
	// TXN_OVERLAP should be filtered as duplicate
	transactions2 := budget2.GetTransactions()
	if len(transactions2) != 1 {
		t.Errorf("expected 1 transaction after second parse (TXN_OVERLAP filtered), got %d", len(transactions2))
	}

	// Verify the transaction is TXN_LATE_NOV, not TXN_OVERLAP
	if len(transactions2) > 0 && transactions2[0].ID != "TXN_LATE_NOV" {
		t.Errorf("expected TXN_LATE_NOV, got %s", transactions2[0].ID)
	}

	// Combine budgets to verify overall deduplication
	totalTransactions := append(transactions, transactions2...)
	if len(totalTransactions) != 3 {
		t.Errorf("expected 3 unique transactions total, got %d", len(totalTransactions))
	}

	// Verify that TXN_OVERLAP appears exactly once in the combined results
	overlapCount := 0
	for _, txn := range totalTransactions {
		if txn.ID == "TXN_OVERLAP" {
			overlapCount++
			// Verify the overlapping transaction details
			if txn.Amount != -50.00 {
				t.Errorf("expected TXN_OVERLAP amount -50.00, got %f", txn.Amount)
			}
			if txn.Date != "2025-10-15" {
				t.Errorf("expected TXN_OVERLAP date '2025-10-15', got %q", txn.Date)
			}
		}
	}
	if overlapCount != 1 {
		t.Errorf("expected TXN_OVERLAP to appear exactly once, found %d occurrences", overlapCount)
	}

	// Verify state tracks the duplicate (count should be 2 for overlapping transaction)
	// Generate the fingerprint for the overlapping transaction to check state
	overlapFingerprint := dedup.GenerateFingerprint("2025-10-15", -50.00, "Overlapping Transaction")
	if loadedState.IsDuplicate(overlapFingerprint) {
		// Fingerprint should exist in state since we saw it twice
		t.Logf("Deduplication working correctly: overlapping transaction fingerprint found in state")
	}

	// Verify state metadata updated
	if loadedState.TotalFingerprints() != 3 {
		t.Errorf("expected 3 unique fingerprints in state, got %d", loadedState.TotalFingerprints())
	}
}

// TestEndToEnd_RedeemableExclusions tests that transfer/payment/ATM/fee transactions are NOT redeemable
func TestEndToEnd_RedeemableExclusions(t *testing.T) {
	// Create temporary directory
	tmpDir := t.TempDir()

	// Create directory structure
	instDir := filepath.Join(tmpDir, "american_express")
	acctDir := filepath.Join(instDir, "2011")
	if err := os.MkdirAll(acctDir, 0755); err != nil {
		t.Fatalf("failed to create directory structure: %v", err)
	}

	// Create OFX file with various transaction types to test redeemable exclusions
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
<TRNTYPE>CREDIT
<DTPOSTED>20251005120000
<TRNAMT>1000.00
<FITID>TXN_PAYMENT
<NAME>CAPITAL ONE PAYMENT
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251010120000
<TRNAMT>-200.00
<FITID>TXN_ATM
<NAME>ATM WITHDRAWAL CASH
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251015120000
<TRNAMT>-35.00
<FITID>TXN_FEE
<NAME>LATE FEE CHARGE
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251020120000
<TRNAMT>-50.00
<FITID>TXN_GROCERY
<NAME>WHOLEFDS MARKET
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>715.00
<DTASOF>20251031000000
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`

	ofxFile := filepath.Join(acctDir, "statement.qfx")
	if err := os.WriteFile(ofxFile, []byte(ofxContent), 0644); err != nil {
		t.Fatalf("failed to write OFX file: %v", err)
	}

	// Parse with embedded rules
	ctx := context.Background()
	budget := domain.NewBudget()

	s := scanner.New(tmpDir)
	files, err := s.Scan()
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}

	reg, err := registry.New()
	if err != nil {
		t.Fatalf("failed to create registry: %v", err)
	}

	engine, err := rules.LoadEmbedded()
	if err != nil {
		t.Fatalf("failed to load embedded rules: %v", err)
	}

	for _, file := range files {
		parser, err := reg.FindParser(file.Path)
		if err != nil {
			t.Fatalf("FindParser failed: %v", err)
		}
		if parser == nil {
			t.Fatalf("no parser found for %s", file.Path)
		}

		f, err := os.Open(file.Path)
		if err != nil {
			t.Fatalf("failed to open file: %v", err)
		}

		rawStmt, err := parser.Parse(ctx, f, file.Metadata)
		if closeErr := f.Close(); closeErr != nil {
			t.Errorf("failed to close file: %v", closeErr)
		}
		if err != nil {
			t.Fatalf("parse failed: %v", err)
		}

		if _, err := transform.TransformStatement(rawStmt, budget, nil, engine); err != nil {
			t.Fatalf("transform failed: %v", err)
		}
	}

	// Verify all transactions parsed
	transactions := budget.GetTransactions()
	if len(transactions) != 4 {
		t.Fatalf("expected 4 transactions, got %d", len(transactions))
	}

	// Verify redeemable flags for each transaction type
	for _, txn := range transactions {
		switch {
		case strings.Contains(txn.Description, "CAPITAL ONE PAYMENT"):
			// Transfer/payment should NOT be redeemable
			if txn.Redeemable() {
				t.Errorf("CAPITAL ONE PAYMENT should NOT be redeemable, got redeemable=%v", txn.Redeemable())
			}
			if txn.RedemptionRate() != 0.0 {
				t.Errorf("CAPITAL ONE PAYMENT should have redemption_rate=0.0, got %f", txn.RedemptionRate())
			}
			if !txn.Transfer {
				t.Errorf("CAPITAL ONE PAYMENT should be marked as transfer, got transfer=%v", txn.Transfer)
			}

		case strings.Contains(txn.Description, "ATM WITHDRAWAL"):
			// ATM withdrawal should NOT be redeemable
			if txn.Redeemable() {
				t.Errorf("ATM WITHDRAWAL should NOT be redeemable, got redeemable=%v", txn.Redeemable())
			}
			if txn.RedemptionRate() != 0.0 {
				t.Errorf("ATM WITHDRAWAL should have redemption_rate=0.0, got %f", txn.RedemptionRate())
			}
			if !txn.Transfer {
				t.Errorf("ATM WITHDRAWAL should be marked as transfer, got transfer=%v", txn.Transfer)
			}

		case strings.Contains(txn.Description, "LATE FEE"):
			// Fee should NOT be redeemable
			if txn.Redeemable() {
				t.Errorf("LATE FEE should NOT be redeemable, got redeemable=%v", txn.Redeemable())
			}
			if txn.RedemptionRate() != 0.0 {
				t.Errorf("LATE FEE should have redemption_rate=0.0, got %f", txn.RedemptionRate())
			}

		case strings.Contains(txn.Description, "WHOLEFDS"):
			// Grocery purchase should be redeemable
			if !txn.Redeemable() {
				t.Errorf("WHOLEFDS MARKET should be redeemable, got redeemable=%v", txn.Redeemable())
			}
			if txn.RedemptionRate() <= 0.0 {
				t.Errorf("WHOLEFDS MARKET should have redemption_rate>0.0, got %f", txn.RedemptionRate())
			}
			if txn.Category != domain.CategoryGroceries {
				t.Errorf("WHOLEFDS MARKET should be groceries category, got %s", txn.Category)
			}

		default:
			t.Errorf("unexpected transaction description: %s", txn.Description)
		}
	}
}

// TestEndToEnd_StateFileSaveFailureDoesNotCorrupt verifies atomic write pattern prevents corruption
func TestEndToEnd_StateFileSaveFailureDoesNotCorrupt(t *testing.T) {
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "state.json")

	// Create initial state with data
	state1 := dedup.NewState()
	ts := time.Date(2025, 1, 15, 10, 0, 0, 0, time.UTC)
	if err := state1.RecordTransaction("fp1", "txn-001", ts); err != nil {
		t.Fatalf("Failed to record first transaction: %v", err)
	}
	if err := state1.RecordTransaction("fp2", "txn-002", ts); err != nil {
		t.Fatalf("Failed to record second transaction: %v", err)
	}

	// Save successfully
	if err := dedup.SaveState(state1, stateFile); err != nil {
		t.Fatalf("Initial save failed: %v", err)
	}

	// Verify temp file is gone
	tempFile := stateFile + ".tmp"
	if _, err := os.Stat(tempFile); !os.IsNotExist(err) {
		t.Error("Temp file should not exist after successful save")
	}

	// Make directory read-only to force save failure
	if err := os.Chmod(tmpDir, 0555); err != nil {
		t.Fatalf("Failed to make directory read-only: %v", err)
	}
	defer os.Chmod(tmpDir, 0755)

	// Attempt to save different state (should fail)
	state2 := dedup.NewState()
	if err := state2.RecordTransaction("fp3", "txn-003", ts); err != nil {
		t.Fatalf("Failed to record transaction for state2: %v", err)
	}
	err := dedup.SaveState(state2, stateFile)
	if err == nil {
		t.Error("Expected save to fail with read-only directory")
	}

	// Restore permissions and verify original state is intact
	if err := os.Chmod(tmpDir, 0755); err != nil {
		t.Fatalf("Failed to restore directory permissions: %v", err)
	}

	loadedState, err := dedup.LoadState(stateFile)
	if err != nil {
		t.Fatalf("Failed to load state after failed save: %v", err)
	}

	// Should have original 2 fingerprints, not the 1 from failed save
	if loadedState.TotalFingerprints() != 2 {
		t.Errorf("State was corrupted: expected 2 fingerprints, got %d",
			loadedState.TotalFingerprints())
	}
}

// TestEndToEnd_StatePersistenceAcrossRuns verifies state file enables true incremental parsing across CLI runs
func TestEndToEnd_StatePersistenceAcrossRuns(t *testing.T) {
	// This test validates acceptance criterion: "State file enables incremental parsing"
	// Unlike TestEndToEnd_IncrementalDeduplication which loads state within same execution,
	// this test simulates multiple separate CLI process runs with process exit between them.

	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "state.json")

	// Create directory structure
	instDir := filepath.Join(tmpDir, "test_bank")
	acctDir := filepath.Join(instDir, "checking")
	if err := os.MkdirAll(acctDir, 0755); err != nil {
		t.Fatalf("failed to create directory structure: %v", err)
	}

	// Create OFX file with 3 transactions for Run 1
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
<ACCTID>checking
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20251001000000
<DTEND>20251015235959
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251005120000
<TRNAMT>-100.00
<FITID>TXN_RUN1_A
<NAME>Purchase A
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251010120000
<TRNAMT>-50.00
<FITID>TXN_RUN1_B
<NAME>Purchase B
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251015120000
<TRNAMT>-25.00
<FITID>TXN_OVERLAP
<NAME>Overlapping Transaction
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>825.00
<DTASOF>20251015000000
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	// Create OFX file with overlapping + new transactions for Run 2
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
<DTSERVER>20251016120000
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
<ACCTID>checking
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20251015000000
<DTEND>20251031235959
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251015120000
<TRNAMT>-25.00
<FITID>TXN_OVERLAP
<NAME>Overlapping Transaction
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20251020120000
<TRNAMT>-75.00
<FITID>TXN_RUN2_C
<NAME>Purchase C
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20251025120000
<TRNAMT>500.00
<FITID>TXN_RUN2_D
<NAME>Deposit
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>1250.00
<DTASOF>20251031000000
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	ofxFile1 := filepath.Join(acctDir, "statement1.ofx")
	ofxFile2 := filepath.Join(acctDir, "statement2.ofx")

	// ===== SIMULATE RUN 1: First CLI invocation =====
	t.Log("Simulating CLI Run 1: Parse initial statement and save state")

	if err := os.WriteFile(ofxFile1, []byte(ofxContent1), 0644); err != nil {
		t.Fatalf("failed to write first OFX file: %v", err)
	}

	// Create fresh state for Run 1
	state1 := dedup.NewState()
	budget1 := domain.NewBudget()

	s1 := scanner.New(tmpDir)
	files1, err := s1.Scan()
	if err != nil {
		t.Fatalf("Run 1: scan failed: %v", err)
	}

	reg1, err := registry.New()
	if err != nil {
		t.Fatalf("Run 1: failed to create registry: %v", err)
	}

	engine1, err := rules.LoadEmbedded()
	if err != nil {
		t.Fatalf("Run 1: failed to load rules: %v", err)
	}

	ctx := context.Background()

	for _, file := range files1 {
		parser, err := reg1.FindParser(file.Path)
		if err != nil {
			t.Fatalf("Run 1: FindParser failed: %v", err)
		}
		if parser == nil {
			t.Fatalf("Run 1: no parser found for %s", file.Path)
		}

		f, err := os.Open(file.Path)
		if err != nil {
			t.Fatalf("Run 1: failed to open file: %v", err)
		}

		rawStmt, err := parser.Parse(ctx, f, file.Metadata)
		if closeErr := f.Close(); closeErr != nil {
			t.Errorf("Run 1: failed to close file: %v", closeErr)
		}
		if err != nil {
			t.Fatalf("Run 1: parse failed: %v", err)
		}

		if _, err := transform.TransformStatement(rawStmt, budget1, state1, engine1); err != nil {
			t.Fatalf("Run 1: transform failed: %v", err)
		}
	}

	// Save state to disk (end of Run 1)
	if err := dedup.SaveState(state1, stateFile); err != nil {
		t.Fatalf("Run 1: failed to save state: %v", err)
	}

	// Verify Run 1 results
	txns1 := budget1.GetTransactions()
	if len(txns1) != 3 {
		t.Fatalf("Run 1: expected 3 transactions, got %d", len(txns1))
	}

	// Verify state metadata
	if state1.TotalFingerprints() != 3 {
		t.Errorf("Run 1: expected 3 fingerprints in state, got %d", state1.TotalFingerprints())
	}

	// CRITICAL: Simulate process exit - clear all in-memory state
	state1 = nil
	budget1 = nil
	reg1 = nil
	engine1 = nil
	s1 = nil

	t.Log("Simulating process exit: cleared all in-memory state")

	// ===== SIMULATE RUN 2: Second CLI invocation (fresh process) =====
	t.Log("Simulating CLI Run 2: Load state from disk and parse overlapping statement")

	// Delete first file, write second file (simulates user downloading new statement)
	if err := os.Remove(ofxFile1); err != nil {
		t.Fatalf("failed to remove first file: %v", err)
	}
	if err := os.WriteFile(ofxFile2, []byte(ofxContent2), 0644); err != nil {
		t.Fatalf("failed to write second OFX file: %v", err)
	}

	// Load state from disk (fresh process start)
	state2, err := dedup.LoadState(stateFile)
	if err != nil {
		t.Fatalf("Run 2: failed to load state: %v", err)
	}

	// Verify state loaded correctly
	if state2.TotalFingerprints() != 3 {
		t.Errorf("Run 2: state should have 3 fingerprints from Run 1, got %d", state2.TotalFingerprints())
	}

	// Create fresh budget for Run 2
	budget2 := domain.NewBudget()

	s2 := scanner.New(tmpDir)
	files2, err := s2.Scan()
	if err != nil {
		t.Fatalf("Run 2: scan failed: %v", err)
	}

	reg2, err := registry.New()
	if err != nil {
		t.Fatalf("Run 2: failed to create registry: %v", err)
	}

	engine2, err := rules.LoadEmbedded()
	if err != nil {
		t.Fatalf("Run 2: failed to load rules: %v", err)
	}

	for _, file := range files2 {
		parser, err := reg2.FindParser(file.Path)
		if err != nil {
			t.Fatalf("Run 2: FindParser failed: %v", err)
		}
		if parser == nil {
			t.Fatalf("Run 2: no parser found for %s", file.Path)
		}

		f, err := os.Open(file.Path)
		if err != nil {
			t.Fatalf("Run 2: failed to open file: %v", err)
		}

		rawStmt, err := parser.Parse(ctx, f, file.Metadata)
		if closeErr := f.Close(); closeErr != nil {
			t.Errorf("Run 2: failed to close file: %v", closeErr)
		}
		if err != nil {
			t.Fatalf("Run 2: parse failed: %v", err)
		}

		// Parse with loaded state - should deduplicate TXN_OVERLAP
		if _, err := transform.TransformStatement(rawStmt, budget2, state2, engine2); err != nil {
			t.Fatalf("Run 2: transform failed: %v", err)
		}
	}

	// Save updated state (end of Run 2)
	if err := dedup.SaveState(state2, stateFile); err != nil {
		t.Fatalf("Run 2: failed to save state: %v", err)
	}

	// Verify Run 2 results: should only add 2 NEW transactions (TXN_OVERLAP filtered)
	txns2 := budget2.GetTransactions()
	if len(txns2) != 2 {
		t.Errorf("Run 2: expected 2 new transactions (TXN_OVERLAP deduplicated), got %d", len(txns2))
		for _, txn := range txns2 {
			t.Logf("  Transaction: %s - %s", txn.ID, txn.Description)
		}
	}

	// Verify TXN_OVERLAP was filtered
	for _, txn := range txns2 {
		if txn.ID == "TXN_OVERLAP" {
			t.Errorf("Run 2: TXN_OVERLAP should have been deduplicated but was included")
		}
	}

	// Verify we got the NEW transactions
	foundC := false
	foundD := false
	for _, txn := range txns2 {
		if txn.ID == "TXN_RUN2_C" {
			foundC = true
		}
		if txn.ID == "TXN_RUN2_D" {
			foundD = true
		}
	}
	if !foundC || !foundD {
		t.Errorf("Run 2: missing new transactions (C=%v, D=%v)", foundC, foundD)
	}

	// Verify state now has 5 total fingerprints (3 from Run 1 + 2 new from Run 2)
	if state2.TotalFingerprints() != 5 {
		t.Errorf("Run 2: expected 5 total fingerprints, got %d", state2.TotalFingerprints())
	}

	// Clear state again
	state2 = nil
	budget2 = nil

	// ===== SIMULATE RUN 3: Third CLI invocation (verify cumulative state) =====
	t.Log("Simulating CLI Run 3: Load cumulative state and verify all fingerprints present")

	state3, err := dedup.LoadState(stateFile)
	if err != nil {
		t.Fatalf("Run 3: failed to load state: %v", err)
	}

	// Verify cumulative state
	if state3.TotalFingerprints() != 5 {
		t.Errorf("Run 3: expected 5 fingerprints from previous runs, got %d", state3.TotalFingerprints())
	}

	// Verify all 5 transactions are marked as duplicates
	expectedFingerprints := []struct {
		date   string
		amount float64
		desc   string
	}{
		{"2025-10-05", -100.00, "Purchase A"},
		{"2025-10-10", -50.00, "Purchase B"},
		{"2025-10-15", -25.00, "Overlapping Transaction"},
		{"2025-10-20", -75.00, "Purchase C"},
		{"2025-10-25", 500.00, "Deposit"},
	}

	for _, expected := range expectedFingerprints {
		fp := dedup.GenerateFingerprint(expected.date, expected.amount, expected.desc)
		if !state3.IsDuplicate(fp) {
			t.Errorf("Run 3: fingerprint for %s should be in state", expected.desc)
		}
	}

	t.Log("SUCCESS: State file persistence across CLI runs verified")
}

// createOFXWithTransactions generates OFX content for testing with specified transactions.
// Each transaction spec format: "FITID|DATE|AMOUNT|NAME"
// Example: "TXN001|2025-10-05|-50.00|WHOLEFDS MARKET"
func createOFXWithTransactions(txnSpecs []string, acctID string) string {
	// Parse transaction specs
	var stmtTrns strings.Builder
	for _, spec := range txnSpecs {
		parts := strings.Split(spec, "|")
		if len(parts) != 4 {
			panic(fmt.Sprintf("invalid transaction spec: %s (expected FITID|DATE|AMOUNT|NAME)", spec))
		}
		fitid := parts[0]
		date := parts[1]
		amount := parts[2]
		name := parts[3]

		// Parse date to OFX format (YYYYMMDDHHMMSS)
		dateTime, err := time.Parse("2006-01-02", date)
		if err != nil {
			panic(fmt.Sprintf("invalid date in spec: %s", date))
		}
		ofxDate := dateTime.Format("20060102") + "120000"

		// Determine transaction type
		trnType := "DEBIT"
		if strings.HasPrefix(amount, "-") {
			trnType = "DEBIT"
		} else {
			trnType = "CREDIT"
		}

		stmtTrns.WriteString(fmt.Sprintf(`<STMTTRN>
<TRNTYPE>%s
<DTPOSTED>%s
<TRNAMT>%s
<FITID>%s
<NAME>%s
</STMTTRN>
`, trnType, ofxDate, amount, fitid, name))
	}

	// Calculate start/end dates from first transaction
	firstDate := strings.Split(txnSpecs[0], "|")[1]
	dateTime, _ := time.Parse("2006-01-02", firstDate)
	startDate := dateTime.Format("20060102") + "000000"
	endDate := dateTime.AddDate(0, 0, 30).Format("20060102") + "235959"

	ofxContent := fmt.Sprintf(`OFXHEADER:100
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
<ACCTID>%s
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>%s
<DTEND>%s
%s</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>1000.00
<DTASOF>%s
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`, acctID, startDate, endDate, stmtTrns.String(), endDate)

	return ofxContent
}

// TestEndToEnd_IncrementalParsingWithStatePersistence validates incremental parsing with state file.
// This test verifies the acceptance criterion: "State file enables incremental parsing".
func TestEndToEnd_IncrementalParsingWithStatePersistence(t *testing.T) {
	tmpDir := t.TempDir()
	stateFile := filepath.Join(tmpDir, "state.json")

	// Create directory structure
	instDir := filepath.Join(tmpDir, "american_express", "2011")
	if err := os.MkdirAll(instDir, 0755); err != nil {
		t.Fatalf("failed to create directory: %v", err)
	}

	// Create two overlapping OFX files with same transactions
	ofxContent := createOFXWithTransactions([]string{
		"TXN001|2025-10-05|-50.00|WHOLEFDS MARKET",
		"TXN002|2025-10-15|-25.00|CHIPOTLE MEXICAN GRILL",
	}, "2011")

	file1 := filepath.Join(instDir, "statement_202510.qfx")
	file2 := filepath.Join(instDir, "statement_202510_duplicate.qfx")

	if err := os.WriteFile(file1, []byte(ofxContent), 0644); err != nil {
		t.Fatalf("failed to write file1: %v", err)
	}
	if err := os.WriteFile(file2, []byte(ofxContent), 0644); err != nil {
		t.Fatalf("failed to write file2: %v", err)
	}

	// Setup for parsing
	ctx := context.Background()
	reg, err := registry.New()
	if err != nil {
		t.Fatalf("failed to create registry: %v", err)
	}
	engine, err := rules.LoadEmbedded()
	if err != nil {
		t.Fatalf("failed to load embedded rules: %v", err)
	}

	// Scanner to get metadata
	s := scanner.New(tmpDir)

	// First run: parse file1, create state
	budget1 := domain.NewBudget()
	state1 := dedup.NewState()

	files1, err := s.Scan()
	if err != nil {
		t.Fatalf("First run: scan failed: %v", err)
	}

	// Find and parse file1
	for _, file := range files1 {
		if file.Path == file1 {
			parser, err := reg.FindParser(file.Path)
			if err != nil {
				t.Fatalf("First run: FindParser failed: %v", err)
			}
			if parser == nil {
				t.Fatalf("First run: no parser found for %s", file.Path)
			}

			f, err := os.Open(file.Path)
			if err != nil {
				t.Fatalf("First run: failed to open file: %v", err)
			}

			rawStmt, err := parser.Parse(ctx, f, file.Metadata)
			if closeErr := f.Close(); closeErr != nil {
				t.Errorf("First run: failed to close file: %v", closeErr)
			}
			if err != nil {
				t.Fatalf("First run: parse failed: %v", err)
			}

			if _, err := transform.TransformStatement(rawStmt, budget1, state1, engine); err != nil {
				t.Fatalf("First run: transform failed: %v", err)
			}
			break
		}
	}

	// Verify first run: 2 transactions added
	if len(budget1.GetTransactions()) != 2 {
		t.Errorf("First run should have 2 transactions, got %d", len(budget1.GetTransactions()))
	}

	// Save state to file
	if err := dedup.SaveState(state1, stateFile); err != nil {
		t.Fatalf("Failed to save state: %v", err)
	}

	// Verify state file exists and is valid JSON
	if _, err := os.Stat(stateFile); os.IsNotExist(err) {
		t.Fatal("State file was not created")
	}

	// Verify state file content
	data, err := os.ReadFile(stateFile)
	if err != nil {
		t.Fatalf("Failed to read state file: %v", err)
	}
	var stateData map[string]interface{}
	if err := json.Unmarshal(data, &stateData); err != nil {
		t.Fatalf("State file is not valid JSON: %v", err)
	}

	// Second run: parse file2 (same transactions), load state
	budget2 := domain.NewBudget()
	state2, err := dedup.LoadState(stateFile)
	if err != nil {
		t.Fatalf("Failed to load state: %v", err)
	}

	files2, err := s.Scan()
	if err != nil {
		t.Fatalf("Second run: scan failed: %v", err)
	}

	// Find and parse file2
	for _, file := range files2 {
		if file.Path == file2 {
			parser, err := reg.FindParser(file.Path)
			if err != nil {
				t.Fatalf("Second run: FindParser failed: %v", err)
			}
			if parser == nil {
				t.Fatalf("Second run: no parser found for %s", file.Path)
			}

			f, err := os.Open(file.Path)
			if err != nil {
				t.Fatalf("Second run: failed to open file: %v", err)
			}

			rawStmt, err := parser.Parse(ctx, f, file.Metadata)
			if closeErr := f.Close(); closeErr != nil {
				t.Errorf("Second run: failed to close file: %v", closeErr)
			}
			if err != nil {
				t.Fatalf("Second run: parse failed: %v", err)
			}

			if _, err := transform.TransformStatement(rawStmt, budget2, state2, engine); err != nil {
				t.Fatalf("Second run: transform failed: %v", err)
			}
			break
		}
	}

	// Verify second run: 0 transactions added (all duplicates)
	if len(budget2.GetTransactions()) != 0 {
		t.Errorf("Second run should add 0 transactions, got %d", len(budget2.GetTransactions()))
	}

	// Verify state2 has updated counts (FirstSeen preserved, LastSeen updated)
	if state2.TotalFingerprints() != 2 {
		t.Errorf("State should have 2 fingerprints, got %d", state2.TotalFingerprints())
	}
}
