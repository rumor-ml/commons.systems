// Package csv provides CSV statement parsing for finparse
package csv

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
)

// Parser implements PNC CSV parsing with a stateless design.
// The struct has no fields because CSV parsing requires no configuration state.
// Each method operates solely on the input data provided, making the parser safe
// for concurrent use without locking.
type Parser struct{}

var parserInstance = &Parser{}

// NewParser returns the shared CSV parser instance.
// Safe for concurrent use due to stateless design.
func NewParser() *Parser {
	return parserInstance
}

// getFileInfo returns a formatted file path string for error messages
func getFileInfo(meta *parser.Metadata) string {
	if meta != nil && meta.FilePath() != "" {
		return fmt.Sprintf(" from %s", meta.FilePath())
	}
	return ""
}

// Name returns the parser identifier
func (p *Parser) Name() string {
	return "csv-pnc"
}

// datePattern matches YYYY/MM/DD format in CSV headers
var datePattern = regexp.MustCompile(`^\d{4}/\d{2}/\d{2}$`)

// CanParse checks if this parser can handle the file based on extension and header
func (p *Parser) CanParse(path string, header []byte) bool {
	// Check file extension (.csv, case-insensitive)
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".csv" {
		return false
	}

	// Parse header to validate PNC CSV format
	// Expected: 5 fields with YYYY/MM/DD dates in fields 1 and 2
	r := csv.NewReader(strings.NewReader(string(header)))
	r.LazyQuotes = true
	r.TrimLeadingSpace = true
	r.FieldsPerRecord = -1

	record, err := r.Read()
	if err != nil {
		return false
	}

	// Must have exactly 5 fields
	if len(record) != 5 {
		return false
	}

	// Fields 1 and 2 (StartDate, EndDate) must match YYYY/MM/DD date pattern
	// Field 0 is AccountNumber, fields 3 and 4 are balances
	if !datePattern.MatchString(strings.TrimSpace(record[1])) {
		return false
	}
	if !datePattern.MatchString(strings.TrimSpace(record[2])) {
		return false
	}

	return true
}

// Parse extracts raw data from PNC CSV file
func (p *Parser) Parse(ctx context.Context, r io.Reader, meta *parser.Metadata) (*parser.RawStatement, error) {
	// Check if context was cancelled before parsing
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	csvReader := csv.NewReader(r)
	csvReader.LazyQuotes = true
	csvReader.TrimLeadingSpace = true
	csvReader.FieldsPerRecord = -1

	// Read all records
	records, err := csvReader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("failed to read CSV content%s: %w", getFileInfo(meta), err)
	}

	if len(records) < 1 {
		return nil, fmt.Errorf("CSV file is empty%s", getFileInfo(meta))
	}

	// Parse summary line (first row)
	account, period, err := p.parseSummaryLine(records[0], meta)
	if err != nil {
		return nil, fmt.Errorf("failed to parse summary line%s: %w", getFileInfo(meta), err)
	}

	// Parse transactions (remaining rows)
	transactions, err := p.parseTransactions(records[1:], meta)
	if err != nil {
		return nil, fmt.Errorf("failed to parse transactions%s: %w", getFileInfo(meta), err)
	}

	return &parser.RawStatement{
		Account:      *account,
		Period:       *period,
		Transactions: transactions,
	}, nil
}

// parseSummaryLine parses the first row containing account and period information
// Format: AccountNumber, StartDate, EndDate, BeginningBalance, EndingBalance
func (p *Parser) parseSummaryLine(record []string, meta *parser.Metadata) (*parser.RawAccount, *parser.Period, error) {
	if len(record) != 5 {
		return nil, nil, fmt.Errorf("summary line must have 5 fields, got %d", len(record))
	}

	// Extract account number
	accountID := strings.TrimSpace(record[0])
	if accountID == "" {
		return nil, nil, fmt.Errorf("account number cannot be empty")
	}

	// Parse start date
	startDate, err := time.Parse("2006/01/02", strings.TrimSpace(record[1]))
	if err != nil {
		return nil, nil, fmt.Errorf("invalid start date %q: %w", record[1], err)
	}

	// Parse end date
	endDate, err := time.Parse("2006/01/02", strings.TrimSpace(record[2]))
	if err != nil {
		return nil, nil, fmt.Errorf("invalid end date %q: %w", record[2], err)
	}

	// Create account
	account, err := parser.NewRawAccount("PNC", "", accountID, "checking")
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create raw account: %w", err)
	}

	// Set institution name from metadata if available
	if meta != nil && meta.Institution() != "" {
		account.SetInstitutionName(meta.Institution())
	}

	// Create period
	period, err := parser.NewPeriod(startDate, endDate)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create period: %w", err)
	}

	return account, period, nil
}

// parseTransactions converts CSV transaction rows to RawTransactions
func (p *Parser) parseTransactions(records [][]string, meta *parser.Metadata) ([]parser.RawTransaction, error) {
	transactions := make([]parser.RawTransaction, 0, len(records))

	for i, record := range records {
		// Skip empty rows
		if len(record) == 0 || (len(record) == 1 && strings.TrimSpace(record[0]) == "") {
			continue
		}

		rawTxn, err := p.parseTransactionRow(record, meta)
		if err != nil {
			return nil, fmt.Errorf("failed to parse transaction at row %d: %w", i+2, err)
		}
		transactions = append(transactions, *rawTxn)
	}

	return transactions, nil
}

// parseTransactionRow parses a single transaction row
// Format: Date, Amount, Description, Memo, Reference, Type
func (p *Parser) parseTransactionRow(record []string, meta *parser.Metadata) (*parser.RawTransaction, error) {
	if len(record) != 6 {
		return nil, fmt.Errorf("transaction row must have 6 fields, got %d", len(record))
	}

	// Parse date
	dateStr := strings.TrimSpace(record[0])
	date, err := time.Parse("2006/01/02", dateStr)
	if err != nil {
		return nil, fmt.Errorf("invalid transaction date %q: %w", dateStr, err)
	}

	// Parse amount
	amountStr := strings.TrimSpace(record[1])
	if amountStr == "" {
		return nil, fmt.Errorf("amount cannot be empty")
	}
	amount, err := strconv.ParseFloat(amountStr, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid amount %q: %w", amountStr, err)
	}

	// Extract fields
	description := strings.TrimSpace(record[2])
	if description == "" {
		return nil, fmt.Errorf("description cannot be empty")
	}

	memo := strings.TrimSpace(record[3])
	reference := strings.TrimSpace(record[4])
	txnType := strings.TrimSpace(record[5])

	// Adjust amount sign based on type
	// DEBIT = negative (money out), CREDIT = positive (money in)
	if strings.EqualFold(txnType, "DEBIT") {
		amount = -amount
	}

	// Generate transaction ID
	id := p.generateTransactionID(date, reference, amount)

	// Create raw transaction
	// Use date for both date and postedDate since CSV doesn't distinguish
	rawTxn, err := parser.NewRawTransaction(id, date, date, description, amount)
	if err != nil {
		return nil, fmt.Errorf("failed to create transaction: %w", err)
	}

	// Set optional fields
	if txnType != "" {
		rawTxn.SetType(strings.ToUpper(txnType))
	}
	if memo != "" {
		rawTxn.SetMemo(memo)
	}

	return rawTxn, nil
}

// generateTransactionID creates a unique transaction ID from date, reference, and amount
// Format: pnc-{YYYY-MM-DD}-{reference}-{amount}
func (p *Parser) generateTransactionID(date time.Time, reference string, amount float64) string {
	dateStr := date.Format("2006-01-02")

	// Sanitize reference for use in ID (replace spaces and special chars)
	refStr := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			return r
		}
		return '-'
	}, reference)

	// Truncate reference if too long
	if len(refStr) > 20 {
		refStr = refStr[:20]
	}

	// Handle empty reference
	if refStr == "" {
		refStr = "notx"
	}

	// Format amount without decimal point
	amountStr := fmt.Sprintf("%.2f", amount)
	amountStr = strings.ReplaceAll(amountStr, ".", "")
	amountStr = strings.ReplaceAll(amountStr, "-", "n")

	return fmt.Sprintf("pnc-%s-%s-%s", dateStr, refStr, amountStr)
}
