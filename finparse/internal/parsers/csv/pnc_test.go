package csv

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
)

func TestName(t *testing.T) {
	p := NewParser()
	if got := p.Name(); got != "csv-pnc" {
		t.Errorf("Name() = %q, want %q", got, "csv-pnc")
	}
}

func TestCanParse_ValidPNCCSV(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		header   string
		expected bool
	}{
		{
			name:     "Valid PNC CSV with 5 fields",
			path:     "test.csv",
			header:   "12345,2024/01/01,2024/01/31,1000.00,2000.00",
			expected: true,
		},
		{
			name:     "Valid PNC CSV with spaces",
			path:     "test.csv",
			header:   " 12345 , 2024/01/01 , 2024/01/31 , 1000.00 , 2000.00 ",
			expected: true,
		},
		{
			name:     "CSV extension uppercase",
			path:     "test.CSV",
			header:   "12345,2024/01/01,2024/01/31,1000.00,2000.00",
			expected: true,
		},
		{
			name:     "CSV with quoted fields",
			path:     "test.csv",
			header:   `"12345","2024/01/01","2024/01/31","1000.00","2000.00"`,
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := NewParser()
			got := p.CanParse(tt.path, []byte(tt.header))
			if got != tt.expected {
				t.Errorf("CanParse() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestCanParse_WrongExtension(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		header   string
		expected bool
	}{
		{
			name:     "OFX file",
			path:     "test.ofx",
			header:   "12345,2024/01/01,2024/01/31,1000.00,2000.00",
			expected: false,
		},
		{
			name:     "TXT file",
			path:     "test.txt",
			header:   "12345,2024/01/01,2024/01/31,1000.00,2000.00",
			expected: false,
		},
		{
			name:     "PDF file",
			path:     "test.pdf",
			header:   "12345,2024/01/01,2024/01/31,1000.00,2000.00",
			expected: false,
		},
		{
			name:     "No extension",
			path:     "test",
			header:   "12345,2024/01/01,2024/01/31,1000.00,2000.00",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := NewParser()
			got := p.CanParse(tt.path, []byte(tt.header))
			if got != tt.expected {
				t.Errorf("CanParse() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestCanParse_InvalidFormat(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		header   string
		expected bool
	}{
		{
			name:     "Wrong field count - 4 fields",
			path:     "test.csv",
			header:   "12345,2024/01/01,2024/01/31,1000.00",
			expected: false,
		},
		{
			name:     "Wrong field count - 6 fields",
			path:     "test.csv",
			header:   "12345,2024/01/01,2024/01/31,1000.00,2000.00,extra",
			expected: false,
		},
		{
			name:     "Wrong date format - MM/DD/YYYY in field 1",
			path:     "test.csv",
			header:   "12345,01/01/2024,2024/01/31,1000.00,2000.00",
			expected: false,
		},
		{
			name:     "Wrong date format - DD/MM/YYYY in field 2",
			path:     "test.csv",
			header:   "12345,2024/01/01,31/01/2024,1000.00,2000.00",
			expected: false,
		},
		{
			name:     "Invalid date format - ISO 8601",
			path:     "test.csv",
			header:   "12345,2024-01-01,2024-01-31,1000.00,2000.00",
			expected: false,
		},
		{
			name:     "Field 1 not a date",
			path:     "test.csv",
			header:   "12345,StartDate,2024/01/31,1000.00,2000.00",
			expected: false,
		},
		{
			name:     "Field 2 not a date",
			path:     "test.csv",
			header:   "12345,2024/01/01,EndDate,1000.00,2000.00",
			expected: false,
		},
		{
			name:     "Empty header",
			path:     "test.csv",
			header:   "",
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := NewParser()
			got := p.CanParse(tt.path, []byte(tt.header))
			if got != tt.expected {
				t.Errorf("CanParse() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestParse_SyntheticStatement(t *testing.T) {
	// Create synthetic PNC CSV content
	// Format: AccountNumber, StartDate, EndDate, BeginningBalance, EndingBalance
	// Amounts are always positive; sign comes from Type (DEBIT=negative, CREDIT=positive)
	csvContent := `9876543210,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,50.00,Coffee Shop,Morning coffee,REF001,DEBIT
2024/01/15,1000.00,Paycheck,Salary deposit,REF002,CREDIT
2024/01/20,25.50,Grocery Store,Weekly groceries,REF003,DEBIT`

	p := NewParser()
	meta, err := parser.NewMetadata("/test/statement.csv", time.Now())
	if err != nil {
		t.Fatalf("failed to create metadata: %v", err)
	}

	stmt, err := p.Parse(context.Background(), strings.NewReader(csvContent), meta)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}

	// Verify account
	if stmt.Account.InstitutionID() != "PNC" {
		t.Errorf("InstitutionID = %q, want %q", stmt.Account.InstitutionID(), "PNC")
	}
	if stmt.Account.AccountID() != "9876543210" {
		t.Errorf("AccountID = %q, want %q", stmt.Account.AccountID(), "9876543210")
	}
	if stmt.Account.AccountType() != "checking" {
		t.Errorf("AccountType = %q, want %q", stmt.Account.AccountType(), "checking")
	}

	// Verify period
	expectedStart := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	expectedEnd := time.Date(2024, 1, 31, 0, 0, 0, 0, time.UTC)
	if !stmt.Period.Start().Equal(expectedStart) {
		t.Errorf("Period.Start = %v, want %v", stmt.Period.Start(), expectedStart)
	}
	if !stmt.Period.End().Equal(expectedEnd) {
		t.Errorf("Period.End = %v, want %v", stmt.Period.End(), expectedEnd)
	}

	// Verify transactions
	if len(stmt.Transactions) != 3 {
		t.Fatalf("got %d transactions, want 3", len(stmt.Transactions))
	}

	// Transaction 1 - DEBIT (negative)
	txn1 := stmt.Transactions[0]
	if txn1.Description() != "Coffee Shop" {
		t.Errorf("Transaction[0].Description = %q, want %q", txn1.Description(), "Coffee Shop")
	}
	if txn1.Amount() != -50.00 {
		t.Errorf("Transaction[0].Amount = %v, want -50.00", txn1.Amount())
	}
	if txn1.Type() != "DEBIT" {
		t.Errorf("Transaction[0].Type = %q, want %q", txn1.Type(), "DEBIT")
	}
	if txn1.Memo() != "Morning coffee" {
		t.Errorf("Transaction[0].Memo = %q, want %q", txn1.Memo(), "Morning coffee")
	}

	// Transaction 2 - CREDIT (positive)
	txn2 := stmt.Transactions[1]
	if txn2.Description() != "Paycheck" {
		t.Errorf("Transaction[1].Description = %q, want %q", txn2.Description(), "Paycheck")
	}
	if txn2.Amount() != 1000.00 {
		t.Errorf("Transaction[1].Amount = %v, want 1000.00", txn2.Amount())
	}
	if txn2.Type() != "CREDIT" {
		t.Errorf("Transaction[1].Type = %q, want %q", txn2.Type(), "CREDIT")
	}

	// Transaction 3 - DEBIT (negative)
	txn3 := stmt.Transactions[2]
	if txn3.Amount() != -25.50 {
		t.Errorf("Transaction[2].Amount = %v, want -25.50", txn3.Amount())
	}
	if txn3.Type() != "DEBIT" {
		t.Errorf("Transaction[2].Type = %q, want %q", txn3.Type(), "DEBIT")
	}
}

func TestParse_ErrorCases(t *testing.T) {
	tests := []struct {
		name        string
		csvContent  string
		wantErrText string
	}{
		{
			name:        "Empty file",
			csvContent:  "",
			wantErrText: "CSV file is empty",
		},
		{
			name:        "Summary line wrong field count",
			csvContent:  "12345,2024/01/01,2024/01/31",
			wantErrText: "summary line must have 5 fields",
		},
		{
			name:        "Invalid start date in summary",
			csvContent:  "12345,2024/13/01,2024/01/31,1000.00,2000.00",
			wantErrText: "invalid start date",
		},
		{
			name:        "Invalid end date in summary",
			csvContent:  "12345,2024/01/01,2024/13/31,1000.00,2000.00",
			wantErrText: "invalid end date",
		},
		{
			name: "Transaction wrong field count",
			csvContent: `12345,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,50.00,Coffee Shop`,
			wantErrText: "transaction row must have 6 fields",
		},
		{
			name: "Invalid transaction date",
			csvContent: `12345,2024/01/01,2024/01/31,1000.00,2000.00
2024/13/05,50.00,Coffee Shop,Morning coffee,REF001,DEBIT`,
			wantErrText: "invalid transaction date",
		},
		{
			name: "Invalid amount format",
			csvContent: `12345,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,invalid,Coffee Shop,Morning coffee,REF001,DEBIT`,
			wantErrText: "invalid amount",
		},
		{
			name: "Empty amount",
			csvContent: `12345,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,,Coffee Shop,Morning coffee,REF001,DEBIT`,
			wantErrText: "amount cannot be empty",
		},
		{
			name: "Empty description",
			csvContent: `12345,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,50.00,,Morning coffee,REF001,DEBIT`,
			wantErrText: "description cannot be empty",
		},
		{
			name: "Empty account ID",
			csvContent: `,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,50.00,Coffee Shop,Morning coffee,REF001,DEBIT`,
			wantErrText: "account number cannot be empty",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := NewParser()
			meta, err := parser.NewMetadata("/test/statement.csv", time.Now())
			if err != nil {
				t.Fatalf("failed to create metadata: %v", err)
			}

			_, err = p.Parse(context.Background(), strings.NewReader(tt.csvContent), meta)
			if err == nil {
				t.Fatalf("Parse() expected error containing %q, got nil", tt.wantErrText)
			}
			if !strings.Contains(err.Error(), tt.wantErrText) {
				t.Errorf("Parse() error = %q, want error containing %q", err.Error(), tt.wantErrText)
			}
		})
	}
}

func TestGenerateTransactionID(t *testing.T) {
	tests := []struct {
		name      string
		date      time.Time
		reference string
		amount    float64
		wantID    string
	}{
		{
			name:      "Normal transaction",
			date:      time.Date(2024, 1, 5, 0, 0, 0, 0, time.UTC),
			reference: "REF001",
			amount:    -50.00,
			wantID:    "pnc-2024-01-05-REF001-n5000",
		},
		{
			name:      "Positive amount",
			date:      time.Date(2024, 1, 15, 0, 0, 0, 0, time.UTC),
			reference: "REF002",
			amount:    1000.00,
			wantID:    "pnc-2024-01-15-REF002-100000",
		},
		{
			name:      "Zero amount",
			date:      time.Date(2024, 1, 20, 0, 0, 0, 0, time.UTC),
			reference: "REF003",
			amount:    0.00,
			wantID:    "pnc-2024-01-20-REF003-000",
		},
		{
			name:      "Empty reference",
			date:      time.Date(2024, 1, 25, 0, 0, 0, 0, time.UTC),
			reference: "",
			amount:    -25.50,
			wantID:    "pnc-2024-01-25-notx-n2550",
		},
		{
			name:      "Reference with spaces",
			date:      time.Date(2024, 2, 1, 0, 0, 0, 0, time.UTC),
			reference: "REF 004",
			amount:    -100.99,
			wantID:    "pnc-2024-02-01-REF-004-n10099",
		},
		{
			name:      "Reference with special characters",
			date:      time.Date(2024, 2, 5, 0, 0, 0, 0, time.UTC),
			reference: "REF#005!@#",
			amount:    -75.25,
			wantID:    "pnc-2024-02-05-REF-005----n7525",
		},
		{
			name:      "Long reference truncated",
			date:      time.Date(2024, 2, 10, 0, 0, 0, 0, time.UTC),
			reference: "VERYLONGREFERENCENUMBER12345",
			amount:    -200.00,
			wantID:    "pnc-2024-02-10-VERYLONGREFERENCENUM-n20000",
		},
		{
			name:      "Decimal cents",
			date:      time.Date(2024, 3, 1, 0, 0, 0, 0, time.UTC),
			reference: "REF006",
			amount:    -12.34,
			wantID:    "pnc-2024-03-01-REF006-n1234",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := NewParser()
			got := p.generateTransactionID(tt.date, tt.reference, tt.amount)
			if got != tt.wantID {
				t.Errorf("generateTransactionID() = %q, want %q", got, tt.wantID)
			}
		})
	}
}

func TestParse_EdgeCases(t *testing.T) {
	tests := []struct {
		name        string
		csvContent  string
		description string
	}{
		{
			name: "Empty memo field",
			csvContent: `12345,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,50.00,Coffee Shop,,REF001,DEBIT`,
			description: "Transaction with empty memo should parse successfully",
		},
		{
			name: "Empty reference field",
			csvContent: `12345,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,50.00,Coffee Shop,Morning coffee,,DEBIT`,
			description: "Transaction with empty reference should parse successfully",
		},
		{
			name: "Empty type field",
			csvContent: `12345,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,50.00,Coffee Shop,Morning coffee,REF001,`,
			description: "Transaction with empty type should parse successfully",
		},
		{
			name: "Quoted fields with commas",
			csvContent: `12345,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,50.00,"Coffee Shop, Downtown","Morning coffee, large",REF001,DEBIT`,
			description: "Quoted fields containing commas should parse correctly",
		},
		{
			name: "Mixed case transaction type",
			csvContent: `12345,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,50.00,Coffee Shop,Morning coffee,REF001,debit`,
			description: "Mixed case transaction type should be normalized to uppercase",
		},
		{
			name: "Skip empty rows",
			csvContent: `12345,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,50.00,Coffee Shop,Morning coffee,REF001,DEBIT

2024/01/15,1000.00,Paycheck,Salary deposit,REF002,CREDIT`,
			description: "Empty rows between transactions should be skipped",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := NewParser()
			meta, err := parser.NewMetadata("/test/statement.csv", time.Now())
			if err != nil {
				t.Fatalf("failed to create metadata: %v", err)
			}

			stmt, err := p.Parse(context.Background(), strings.NewReader(tt.csvContent), meta)
			if err != nil {
				t.Fatalf("Parse() error = %v (test: %s)", err, tt.description)
			}

			// Basic validation
			if stmt == nil {
				t.Fatal("Parse() returned nil statement")
			}
			if len(stmt.Transactions) == 0 {
				t.Error("Parse() returned no transactions")
			}
		})
	}
}

func TestParse_ContextCancellation(t *testing.T) {
	csvContent := `12345,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,50.00,Coffee Shop,Morning coffee,REF001,DEBIT`

	p := NewParser()
	meta, err := parser.NewMetadata("/test/statement.csv", time.Now())
	if err != nil {
		t.Fatalf("failed to create metadata: %v", err)
	}

	// Create cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err = p.Parse(ctx, strings.NewReader(csvContent), meta)
	if err != context.Canceled {
		t.Errorf("Parse() with cancelled context error = %v, want %v", err, context.Canceled)
	}
}

func TestParse_WithMetadata(t *testing.T) {
	csvContent := `12345,2024/01/01,2024/01/31,1000.00,2000.00
2024/01/05,50.00,Coffee Shop,Morning coffee,REF001,DEBIT`

	p := NewParser()
	meta, err := parser.NewMetadata("/test/pnc/statement.csv", time.Now())
	if err != nil {
		t.Fatalf("failed to create metadata: %v", err)
	}
	meta.SetInstitution("PNC Bank")

	stmt, err := p.Parse(context.Background(), strings.NewReader(csvContent), meta)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}

	// Verify institution name was set from metadata
	if stmt.Account.InstitutionName() != "PNC Bank" {
		t.Errorf("InstitutionName = %q, want %q", stmt.Account.InstitutionName(), "PNC Bank")
	}
}
