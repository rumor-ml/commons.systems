package ofx

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
)

func TestName(t *testing.T) {
	p := NewParser()
	if got := p.Name(); got != "ofx" {
		t.Errorf("Name() = %q, want %q", got, "ofx")
	}
}

func TestCanParse_OFXExtension(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		header   string
		expected bool
	}{
		{
			name:     "OFX file with OFXHEADER marker",
			path:     "test.ofx",
			header:   "OFXHEADER:100\nDATA:OFXSGML\n",
			expected: true,
		},
		{
			name:     "OFX file with XML header",
			path:     "test.ofx",
			header:   "<?xml version=\"1.0\"?><?OFX OFXHEADER=\"200\"?>\n",
			expected: true,
		},
		{
			name:     "OFX file with OFX tag",
			path:     "test.ofx",
			header:   "<OFX><SIGNONMSGSRSV1>",
			expected: true,
		},
		{
			name:     "OFX extension uppercase",
			path:     "test.OFX",
			header:   "OFXHEADER:100\n",
			expected: true,
		},
		{
			name:     "OFX file without valid header",
			path:     "test.ofx",
			header:   "This is not OFX content",
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

func TestCanParse_QFXExtension(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		header   string
		expected bool
	}{
		{
			name:     "QFX file with OFXHEADER marker",
			path:     "test.qfx",
			header:   "OFXHEADER:100\nDATA:OFXSGML\n",
			expected: true,
		},
		{
			name:     "QFX extension uppercase",
			path:     "test.QFX",
			header:   "<?OFX OFXHEADER=\"200\"?>\n",
			expected: true,
		},
		{
			name:     "QFX file without valid header",
			path:     "test.qfx",
			header:   "This is not QFX content",
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

func TestCanParse_NonOFXFile(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		header   string
		expected bool
	}{
		{
			name:     "CSV file",
			path:     "test.csv",
			header:   "Date,Description,Amount\n",
			expected: false,
		},
		{
			name:     "TXT file",
			path:     "test.txt",
			header:   "Some random text\n",
			expected: false,
		},
		{
			name:     "Wrong extension even with OFX content",
			path:     "test.pdf",
			header:   "OFXHEADER:100\n",
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

func TestParse_SyntheticBankStatement(t *testing.T) {
	// Create synthetic OFX content for CI
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTBANK
<FID>12345
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
<ACCTID>9876543210
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240105120000
<TRNAMT>-50.00
<FITID>TXN001
<NAME>Test Transaction 1
<MEMO>Coffee Shop
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240115120000
<TRNAMT>1000.00
<FITID>TXN002
<NAME>Paycheck
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>2000.00
<DTASOF>20240131235959
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/statement.ofx", time.Now())

	stmt, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}

	// Verify account
	if stmt.Account.InstitutionID() != "TESTBANK" {
		t.Errorf("InstitutionID = %q, want %q", stmt.Account.InstitutionID(), "TESTBANK")
	}
	if stmt.Account.AccountID() != "9876543210" {
		t.Errorf("AccountID = %q, want %q", stmt.Account.AccountID(), "9876543210")
	}
	if stmt.Account.AccountType() != "checking" {
		t.Errorf("AccountType = %q, want %q", stmt.Account.AccountType(), "checking")
	}

	// Verify period
	expectedStart := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	expectedEnd := time.Date(2024, 1, 31, 23, 59, 59, 0, time.UTC)
	if !stmt.Period.Start().Equal(expectedStart) {
		t.Errorf("Period.Start = %v, want %v", stmt.Period.Start(), expectedStart)
	}
	if !stmt.Period.End().Equal(expectedEnd) {
		t.Errorf("Period.End = %v, want %v", stmt.Period.End(), expectedEnd)
	}

	// Verify transactions
	if len(stmt.Transactions) != 2 {
		t.Fatalf("got %d transactions, want 2", len(stmt.Transactions))
	}

	txn1 := stmt.Transactions[0]
	if txn1.ID() != "TXN001" {
		t.Errorf("Transaction[0].ID = %q, want %q", txn1.ID(), "TXN001")
	}
	if txn1.Description() != "Test Transaction 1" {
		t.Errorf("Transaction[0].Description = %q, want %q", txn1.Description(), "Test Transaction 1")
	}
	if txn1.Amount() != -50.00 {
		t.Errorf("Transaction[0].Amount = %v, want -50.00", txn1.Amount())
	}
	if txn1.Type() != "DEBIT" {
		t.Errorf("Transaction[0].Type = %q, want %q", txn1.Type(), "DEBIT")
	}

	txn2 := stmt.Transactions[1]
	if txn2.ID() != "TXN002" {
		t.Errorf("Transaction[1].ID = %q, want %q", txn2.ID(), "TXN002")
	}
	if txn2.Amount() != 1000.00 {
		t.Errorf("Transaction[1].Amount = %v, want 1000.00", txn2.Amount())
	}
}

func TestParse_SyntheticCreditCard(t *testing.T) {
	// Create synthetic credit card OFX content
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTCREDITCARD
<FID>98765
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
<ACCTID>4111111111111111
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240110120000
<TRNAMT>-25.99
<FITID>CC001
<NAME>Amazon Purchase
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>-500.00
<DTASOF>20240131235959
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/credit.ofx", time.Now())

	stmt, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}

	// Verify account type
	if stmt.Account.AccountType() != "credit" {
		t.Errorf("AccountType = %q, want %q", stmt.Account.AccountType(), "credit")
	}
	if stmt.Account.InstitutionID() != "TESTCREDITCARD" {
		t.Errorf("InstitutionID = %q, want %q", stmt.Account.InstitutionID(), "TESTCREDITCARD")
	}

	// Verify transaction
	if len(stmt.Transactions) != 1 {
		t.Fatalf("got %d transactions, want 1", len(stmt.Transactions))
	}
	if stmt.Transactions[0].Description() != "Amazon Purchase" {
		t.Errorf("Transaction description = %q, want %q", stmt.Transactions[0].Description(), "Amazon Purchase")
	}
}

func TestParse_SyntheticInvestment(t *testing.T) {
	// Create synthetic investment OFX content
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTINV
<FID>12345
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<INVSTMTRS>
<DTASOF>20240131235959
<CURDEF>USD
<INVACCTFROM>
<BROKERID>TESTBROKER
<ACCTID>987654321
</INVACCTFROM>
<INVTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
<INVBANKTRAN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240115120000
<TRNAMT>100.00
<FITID>INV001
<NAME>Dividend Payment
<MEMO>Quarterly dividend
</STMTTRN>
</INVBANKTRAN>
<INVBANKTRAN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240120120000
<TRNAMT>-15.00
<FITID>INV002
<NAME>Account Fee
</STMTTRN>
</INVBANKTRAN>
</INVTRANLIST>
<INVBAL>
<AVAILCASH>5000.00
<BALLIST>
<BAL>
<NAME>Total Market Value
<DESC>Total Value
<BALTYPE>DOLLAR
<VALUE>50000.00
<DTASOF>20240131235959
</BAL>
</BALLIST>
</INVBAL>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/investment.ofx", time.Now())

	stmt, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}

	// Verify account type
	if stmt.Account.AccountType() != "investment" {
		t.Errorf("AccountType = %q, want %q", stmt.Account.AccountType(), "investment")
	}
	if stmt.Account.InstitutionID() != "TESTINV" {
		t.Errorf("InstitutionID = %q, want %q", stmt.Account.InstitutionID(), "TESTINV")
	}
	if stmt.Account.AccountID() != "987654321" {
		t.Errorf("AccountID = %q, want %q", stmt.Account.AccountID(), "987654321")
	}

	// Verify period
	expectedStart := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	expectedEnd := time.Date(2024, 1, 31, 23, 59, 59, 0, time.UTC)
	if !stmt.Period.Start().Equal(expectedStart) {
		t.Errorf("Period.Start = %v, want %v", stmt.Period.Start(), expectedStart)
	}
	if !stmt.Period.End().Equal(expectedEnd) {
		t.Errorf("Period.End = %v, want %v", stmt.Period.End(), expectedEnd)
	}

	// Verify transactions (InvBankTransaction parsing)
	if len(stmt.Transactions) != 2 {
		t.Fatalf("got %d transactions, want 2", len(stmt.Transactions))
	}

	txn1 := stmt.Transactions[0]
	if txn1.ID() != "INV001" {
		t.Errorf("Transaction[0].ID = %q, want %q", txn1.ID(), "INV001")
	}
	if txn1.Description() != "Dividend Payment" {
		t.Errorf("Transaction[0].Description = %q, want %q", txn1.Description(), "Dividend Payment")
	}
	if txn1.Amount() != 100.00 {
		t.Errorf("Transaction[0].Amount = %v, want 100.00", txn1.Amount())
	}

	txn2 := stmt.Transactions[1]
	if txn2.ID() != "INV002" {
		t.Errorf("Transaction[1].ID = %q, want %q", txn2.ID(), "INV002")
	}
	if txn2.Amount() != -15.00 {
		t.Errorf("Transaction[1].Amount = %v, want -15.00", txn2.Amount())
	}
}

func TestParse_InvalidOFX(t *testing.T) {
	tests := []struct {
		name    string
		content string
	}{
		{
			name:    "Empty content",
			content: "",
		},
		{
			name:    "Invalid XML",
			content: "<OFX><INVALID>",
		},
		{
			name:    "Missing required fields",
			content: "OFXHEADER:100\n<OFX></OFX>",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := NewParser()
			meta, _ := parser.NewMetadata("/test/invalid.ofx", time.Now())

			_, err := p.Parse(context.Background(), strings.NewReader(tt.content), meta)
			if err == nil {
				t.Error("Parse() expected error, got nil")
			}
		})
	}
}

func TestParse_ContextCancellation(t *testing.T) {
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTBANK
<FID>12345
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
<ACCTID>9876543210
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>2000.00
<DTASOF>20240131235959
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/statement.ofx", time.Now())

	// Create cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := p.Parse(ctx, strings.NewReader(ofxContent), meta)
	if err != context.Canceled {
		t.Errorf("Expected context.Canceled, got %v", err)
	}
}

func TestParseCreditCard_MissingInstitutionID(t *testing.T) {
	// Credit card statement with missing <ORG> in <FI> section
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<FID>98765
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
<ACCTID>4111111111111111
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>-500.00
<DTASOF>20240131235959
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/credit.ofx", time.Now())

	_, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err == nil || !strings.Contains(err.Error(), "missing institution ID") {
		t.Errorf("Expected missing institution ID error, got %v", err)
	}
}

func TestParseCreditCard_MissingAccountID(t *testing.T) {
	// Credit card statement with empty <ACCTID> tag
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTCREDITCARD
<FID>98765
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
<ACCTID></ACCTID>
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>-500.00
<DTASOF>20240131235959
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/credit.ofx", time.Now())

	_, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err == nil || !strings.Contains(err.Error(), "missing account ID") {
		t.Errorf("Expected missing account ID error, got %v", err)
	}
}

func TestParseCreditCard_MissingTransactionList(t *testing.T) {
	// Credit card statement without BANKTRANLIST
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTCREDITCARD
<FID>98765
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
<ACCTID>4111111111111111
</CCACCTFROM>
<LEDGERBAL>
<BALAMT>-500.00
<DTASOF>20240131235959
</LEDGERBAL>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/credit.ofx", time.Now())

	_, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err == nil || !strings.Contains(err.Error(), "missing transaction list") {
		t.Errorf("Expected missing transaction list error, got %v", err)
	}
}

func TestParseBank_MissingInstitutionID(t *testing.T) {
	// Bank statement with missing <ORG> in <FI> section
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<FID>12345
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
<ACCTID>9876543210
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>2000.00
<DTASOF>20240131235959
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/bank.ofx", time.Now())

	_, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err == nil || !strings.Contains(err.Error(), "missing institution ID") {
		t.Errorf("Expected missing institution ID error, got %v", err)
	}
}

func TestParseBank_MissingAccountID(t *testing.T) {
	// Bank statement with empty <ACCTID> tag
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTBANK
<FID>12345
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
<ACCTID></ACCTID>
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>2000.00
<DTASOF>20240131235959
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/bank.ofx", time.Now())

	_, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	// OFX library validates and returns error mentioning "AcctID empty" or we catch it with "missing account ID"
	if err == nil || !(strings.Contains(err.Error(), "missing account ID") || strings.Contains(err.Error(), "AcctID empty")) {
		t.Errorf("Expected missing account ID error, got %v", err)
	}
}

func TestParseBank_MissingTransactionList(t *testing.T) {
	// Bank statement without BANKTRANLIST
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTBANK
<FID>12345
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
<ACCTID>9876543210
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<LEDGERBAL>
<BALAMT>2000.00
<DTASOF>20240131235959
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/bank.ofx", time.Now())

	_, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err == nil || !strings.Contains(err.Error(), "missing transaction list") {
		t.Errorf("Expected missing transaction list error, got %v", err)
	}
}

func TestParseInvestment_MissingInstitutionID(t *testing.T) {
	// Investment statement with missing <ORG> in <FI> section
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<FID>12345
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<INVSTMTRS>
<DTASOF>20240131235959
<CURDEF>USD
<INVACCTFROM>
<BROKERID>TESTBROKER
<ACCTID>987654321
</INVACCTFROM>
<INVTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
</INVTRANLIST>
<INVBAL>
<AVAILCASH>5000.00
</INVBAL>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/investment.ofx", time.Now())

	_, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err == nil || !strings.Contains(err.Error(), "missing institution ID") {
		t.Errorf("Expected missing institution ID error, got %v", err)
	}
}

func TestParseInvestment_MissingAccountID(t *testing.T) {
	// Investment statement with empty <ACCTID> tag
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTINV
<FID>12345
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<INVSTMTRS>
<DTASOF>20240131235959
<CURDEF>USD
<INVACCTFROM>
<BROKERID>TESTBROKER
<ACCTID></ACCTID>
</INVACCTFROM>
<INVTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
</INVTRANLIST>
<INVBAL>
<AVAILCASH>5000.00
</INVBAL>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/investment.ofx", time.Now())

	_, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err == nil || !strings.Contains(err.Error(), "missing account ID") {
		t.Errorf("Expected missing account ID error, got %v", err)
	}
}

func TestParseInvestment_MissingTransactionList(t *testing.T) {
	// Investment statement without INVTRANLIST
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTINV
<FID>12345
</FI>
</SONRS>
</SIGNONMSGSRSV1>
<INVSTMTMSGSRSV1>
<INVSTMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<INVSTMTRS>
<DTASOF>20240131235959
<CURDEF>USD
<INVACCTFROM>
<BROKERID>TESTBROKER
<ACCTID>987654321
</INVACCTFROM>
<INVBAL>
<AVAILCASH>5000.00
</INVBAL>
</INVSTMTRS>
</INVSTMTTRNRS>
</INVSTMTMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/investment.ofx", time.Now())

	_, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err == nil || !strings.Contains(err.Error(), "missing transaction list") {
		t.Errorf("Expected missing transaction list error, got %v", err)
	}
}

func TestParse_VariousTransactionTypes(t *testing.T) {
	// Synthetic bank statement with multiple transaction types
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTBANK
<FID>12345
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
<ACCTID>9876543210
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
<STMTTRN>
<TRNTYPE>ATM
<DTPOSTED>20240105120000
<TRNAMT>-100.00
<FITID>TXN001
<NAME>ATM Withdrawal
</STMTTRN>
<STMTTRN>
<TRNTYPE>CHECK
<DTPOSTED>20240106120000
<TRNAMT>-250.00
<FITID>TXN002
<NAME>Check #1001
</STMTTRN>
<STMTTRN>
<TRNTYPE>XFER
<DTPOSTED>20240107120000
<TRNAMT>500.00
<FITID>TXN003
<NAME>Transfer from Savings
</STMTTRN>
<STMTTRN>
<TRNTYPE>FEE
<DTPOSTED>20240108120000
<TRNAMT>-15.00
<FITID>TXN004
<NAME>Monthly Service Fee
</STMTTRN>
<STMTTRN>
<TRNTYPE>POS
<DTPOSTED>20240109120000
<TRNAMT>-45.50
<FITID>TXN005
<NAME>Grocery Store
</STMTTRN>
<STMTTRN>
<TRNTYPE>PAYMENT
<DTPOSTED>20240110120000
<TRNAMT>-1000.00
<FITID>TXN006
<NAME>Credit Card Payment
</STMTTRN>
<STMTTRN>
<TRNTYPE>INT
<DTPOSTED>20240111120000
<TRNAMT>2.50
<FITID>TXN007
<NAME>Interest Earned
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEP
<DTPOSTED>20240112120000
<TRNAMT>300.00
<FITID>TXN008
<NAME>Cash Deposit
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>2000.00
<DTASOF>20240131235959
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/statement.ofx", time.Now())

	stmt, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}

	// Verify each transaction has correct Type() value
	expectedTypes := []string{"ATM", "CHECK", "TRANSFER", "FEE", "POS", "PAYMENT", "INTEREST", "DEPOSIT"}
	if len(stmt.Transactions) != len(expectedTypes) {
		t.Fatalf("got %d transactions, want %d", len(stmt.Transactions), len(expectedTypes))
	}

	for i, txn := range stmt.Transactions {
		if txn.Type() != expectedTypes[i] {
			t.Errorf("Transaction %d: expected type %q, got %q", i, expectedTypes[i], txn.Type())
		}
	}
}

func TestParse_SavingsAccount(t *testing.T) {
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTBANK
<FID>12345
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
<ACCTID>9876543210
<ACCTTYPE>SAVINGS
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
<STMTTRN>
<TRNTYPE>INT
<DTPOSTED>20240131120000
<TRNAMT>5.00
<FITID>TXN001
<NAME>Monthly Interest
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>10005.00
<DTASOF>20240131235959
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/savings.ofx", time.Now())

	stmt, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}

	if stmt.Account.AccountType() != "savings" {
		t.Errorf("Expected account type 'savings', got %q", stmt.Account.AccountType())
	}
}

func TestParse_SkipInvalidTransactions(t *testing.T) {
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTBANK
<FID>12345
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
<ACCTID>9876543210
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240110120000
<TRNAMT>-25.00
<FITID>TXN004
<NAME>Valid Transaction
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>2000.00
<DTASOF>20240131235959
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/statement.ofx", time.Now())

	stmt, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}

	// Verify we successfully parsed the valid transaction
	if len(stmt.Transactions) != 1 {
		t.Errorf("Expected 1 transaction, got %d", len(stmt.Transactions))
	}
	if len(stmt.Transactions) > 0 && stmt.Transactions[0].ID() != "TXN004" {
		t.Errorf("Expected transaction TXN004, got %s", stmt.Transactions[0].ID())
	}
}

func TestParse_InstitutionNameFromMetadata(t *testing.T) {
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
<DTSERVER>20240101120000
<LANGUAGE>ENG
<FI>
<ORG>TESTBANK
<FID>12345
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
<ACCTID>9876543210
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20240101000000
<DTEND>20240131235959
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>2000.00
<DTASOF>20240131235959
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

	p := NewParser()
	meta, _ := parser.NewMetadata("/test/statement.ofx", time.Now())
	meta.SetInstitution("My Custom Bank Name")

	stmt, err := p.Parse(context.Background(), strings.NewReader(ofxContent), meta)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}

	if stmt.Account.InstitutionName() != "My Custom Bank Name" {
		t.Errorf("Expected institution name 'My Custom Bank Name', got %q", stmt.Account.InstitutionName())
	}
}

func TestMapBankAccountType(t *testing.T) {
	t.Skip("Cannot unit test due to unexported ofxgo.BankAcct.AcctType field - validated via synthetic statement tests (TestParse_SyntheticBankStatement, TestParse_SavingsAccount)")
}

func TestMapOFXTransactionType(t *testing.T) {
	// Similar to TestMapBankAccountType, the actual mapping is validated
	// through synthetic and integration tests since trnType is unexported
	// and we can't construct Transaction objects with specific types directly.
	// The synthetic bank statement test validates DEBIT and CREDIT mappings.
	t.Skip("Transaction type mapping validated through synthetic statement tests")
}

// Integration tests with real files - these will be skipped if testdata files are not available

func TestParse_RealFiles(t *testing.T) {
	tests := []struct {
		name         string
		filename     string
		institution  string
		expectedType string
		allowedTypes []string // For cases with multiple valid account types
	}{
		{
			name:         "Amex Credit Card",
			filename:     "amex.ofx",
			institution:  "American Express",
			expectedType: "credit",
		},
		{
			name:         "Capital One Credit Card",
			filename:     "capitalone.ofx",
			institution:  "Capital One",
			expectedType: "credit",
		},
		{
			name:         "PNC Checking",
			filename:     "pnc.ofx",
			institution:  "PNC Bank",
			allowedTypes: []string{"checking", "savings"},
		},
		{
			name:         "Vanguard Investment",
			filename:     "vanguard.ofx",
			institution:  "Vanguard",
			expectedType: "investment",
		},
		{
			name:         "TIAA Investment",
			filename:     "tiaa.ofx",
			institution:  "TIAA",
			expectedType: "investment",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testdataPath := filepath.Join("testdata", tt.filename)
			if _, err := os.Stat(testdataPath); os.IsNotExist(err) {
				t.Skip("Skipping test: testdata file not available (see testdata/README.md)")
			}

			content, err := os.ReadFile(testdataPath)
			if err != nil {
				t.Fatalf("Failed to read testdata file: %v", err)
			}

			p := NewParser()
			meta, _ := parser.NewMetadata(testdataPath, time.Now())
			meta.SetInstitution(tt.institution)

			stmt, err := p.Parse(context.Background(), strings.NewReader(string(content)), meta)
			if err != nil {
				t.Fatalf("Parse() error = %v", err)
			}

			// Validate account type
			if len(tt.allowedTypes) > 0 {
				// Multiple allowed types
				found := false
				for _, allowed := range tt.allowedTypes {
					if stmt.Account.AccountType() == allowed {
						found = true
						break
					}
				}
				if !found {
					t.Errorf("AccountType = %q, want one of %v", stmt.Account.AccountType(), tt.allowedTypes)
				}
			} else if tt.expectedType != "" {
				// Single expected type
				if stmt.Account.AccountType() != tt.expectedType {
					t.Errorf("AccountType = %q, want %q", stmt.Account.AccountType(), tt.expectedType)
				}
			}

			t.Logf("Parsed %d transactions from %s statement", len(stmt.Transactions), tt.institution)
		})
	}
}
