package finparse_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rumor-ml/commons.systems/finparse/internal/dedup"
	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
	"github.com/rumor-ml/commons.systems/finparse/internal/output"
	"github.com/rumor-ml/commons.systems/finparse/internal/registry"
	"github.com/rumor-ml/commons.systems/finparse/internal/rules"
	"github.com/rumor-ml/commons.systems/finparse/internal/scanner"
	"github.com/rumor-ml/commons.systems/finparse/internal/transform"
)

// TestEndToEnd_TransformationPipeline tests the complete Phase 4 transformation pipeline
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
		f.Close()

		if err != nil {
			t.Fatalf("parse failed: %v", err)
		}

		if err := transform.TransformStatement(rawStmt, budget, nil, nil); err != nil {
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
		if txn.Redeemable != false {
			t.Errorf("expected redeemable false, got %v", txn.Redeemable)
		}
		if txn.RedemptionRate != 0.0 {
			t.Errorf("expected redemption rate 0.0, got %f", txn.RedemptionRate)
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
		f.Close()

		if err != nil {
			t.Fatalf("parse failed (2nd pass): %v", err)
		}

		if err := transform.TransformStatement(rawStmt, budget2, nil, nil); err != nil {
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
			parser, _ := reg.FindParser(file.Path)
			f, _ := os.Open(file.Path)
			rawStmt, _ := parser.Parse(ctx, f, file.Metadata)
			f.Close()
			transform.TransformStatement(rawStmt, budget, nil, nil)
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
		parser, _ := reg.FindParser(file.Path)
		f, _ := os.Open(file.Path)
		rawStmt, _ := parser.Parse(ctx, f, file.Metadata)
		f.Close()
		if err := transform.TransformStatement(rawStmt, budget1, state, engine); err != nil {
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
			if !txn.Redeemable {
				t.Error("WHOLEFDS should be redeemable")
			}
		} else if strings.Contains(txn.Description, "CHIPOTLE") {
			if txn.Category != domain.CategoryDining {
				t.Errorf("CHIPOTLE should be dining, got %s", txn.Category)
			}
			if !txn.Redeemable {
				t.Error("CHIPOTLE should be redeemable")
			}
		} else if strings.Contains(txn.Description, "JOHNS HOPKINS") {
			if txn.Category != domain.CategoryIncome {
				t.Errorf("JOHNS HOPKINS should be income, got %s", txn.Category)
			}
			if txn.Redeemable {
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
	files2, _ := s.Scan()
	for _, file := range files2 {
		parser, _ := reg.FindParser(file.Path)
		f, _ := os.Open(file.Path)
		rawStmt, _ := parser.Parse(ctx, f, file.Metadata)
		f.Close()
		if err := transform.TransformStatement(rawStmt, budget2, loadedState, engine); err != nil {
			t.Fatalf("transform failed: %v", err)
		}
	}

	// Verify no transactions added (all were duplicates)
	transactions2 := budget2.GetTransactions()
	if len(transactions2) != 0 {
		t.Errorf("expected 0 transactions (all duplicates), got %d", len(transactions2))
	}

	// Verify state was updated
	if loadedState.Metadata.TotalFingerprints != 3 {
		t.Errorf("expected 3 fingerprints in state, got %d", loadedState.Metadata.TotalFingerprints)
	}
}
