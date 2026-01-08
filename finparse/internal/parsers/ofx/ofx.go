// Package ofx provides OFX/QFX statement parsing for finparse
package ofx

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/aclindsa/ofxgo"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
)

// Parser implements OFX/QFX parsing with a stateless design.
// The struct has no fields because OFX parsing requires no configuration state.
// Each method operates solely on the input data provided, making the parser safe
// for concurrent use without locking. All behavior is determined by the OFX file
// content and optional Metadata.
// TODO(#1319): Simplify comment to focus on contract, not implementation details
type Parser struct{}

var parserInstance = &Parser{}

// NewParser returns the shared OFX parser instance.
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
	return "ofx"
}

// CanParse checks if this parser can handle the file based on extension and header
func (p *Parser) CanParse(path string, header []byte) bool {
	// Check file extension (.ofx or .qfx, case-insensitive)
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".ofx" && ext != ".qfx" {
		return false
	}

	// Check header for OFX markers
	headerStr := string(header)
	headerUpper := strings.ToUpper(headerStr)

	// Look for OFX header markers (both v1 SGML and v2 XML formats)
	hasOFXMarker := strings.Contains(headerUpper, "OFXHEADER") ||
		strings.Contains(headerUpper, "<?OFX") ||
		strings.Contains(headerUpper, "<OFX>")

	return hasOFXMarker
}

// Parse extracts raw data from OFX/QFX file
func (p *Parser) Parse(ctx context.Context, r io.Reader, meta *parser.Metadata) (*parser.RawStatement, error) {
	// Read entire content
	// TODO(#1305): Add ctx.Err() check before io.ReadAll to fail-fast if context is already cancelled.
	// Low priority - the post-read check (line 81) catches cancellation; this only adds marginal latency improvement.
	// Note: io.ReadAll doesn't support context, so true cancellation during read would require chunked reading.
	content, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("failed to read OFX content%s: %w", getFileInfo(meta), err)
	}

	// Check if context was cancelled after reading the file.
	// Note: ofxgo.ParseResponse() does not support context cancellation,
	// so this check only catches cancellation between file read and parsing.
	// Cancellation during io.ReadAll or ParseResponse will not be detected.
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	// Parse OFX response
	response, err := ofxgo.ParseResponse(bytes.NewReader(content))
	if err != nil {
		return nil, fmt.Errorf("failed to parse OFX file%s (%d bytes): %w", getFileInfo(meta), len(content), err)
	}

	// Route to appropriate handler based on statement type
	if len(response.CreditCard) > 0 {
		return p.parseCreditCard(response, meta)
	}

	if len(response.Bank) > 0 {
		return p.parseBank(response, meta)
	}

	if len(response.InvStmt) > 0 {
		return p.parseInvestment(response, meta)
	}

	return nil, fmt.Errorf("no supported statement type found in OFX file. Expected at least one of: credit card (CREDITCARDMSGSRSV1), bank (BANKMSGSRSV1), or investment (INVSTMTMSGSRSV1) statement. The file may be malformed or empty (creditcard: %d, bank: %d, investment: %d)",
		len(response.CreditCard), len(response.Bank), len(response.InvStmt))
}

// parseCreditCard parses credit card statement
func (p *Parser) parseCreditCard(resp *ofxgo.Response, meta *parser.Metadata) (*parser.RawStatement, error) {
	if len(resp.CreditCard) == 0 {
		return nil, fmt.Errorf("parseCreditCard called with empty CreditCard array")
	}

	// TODO(#1316): Add test for type assertion failure with unexpected response type
	ccStmt, ok := resp.CreditCard[0].(*ofxgo.CCStatementResponse)
	if !ok {
		return nil, fmt.Errorf("failed to type assert credit card statement: expected *ofxgo.CCStatementResponse, got %T", resp.CreditCard[0])
	}

	// Extract institution ID from OFX response
	institutionID, err := extractInstitutionID(resp)
	if err != nil {
		return nil, err
	}

	// Extract account ID
	accountID := ccStmt.CCAcctFrom.AcctID.String()
	if accountID == "" {
		return nil, fmt.Errorf("missing account ID in credit card statement")
	}

	// Create account
	account, err := parser.NewRawAccount(institutionID, "", accountID, "credit")
	if err != nil {
		return nil, fmt.Errorf("failed to create raw account: %w", err)
	}

	// Set institution name from metadata if available
	setInstitutionNameFromMeta(account, meta)

	// Transaction list is required
	if ccStmt.BankTranList == nil {
		return nil, fmt.Errorf("missing transaction list in credit card statement")
	}

	// Extract period
	period, err := parser.NewPeriod(
		ccStmt.BankTranList.DtStart.Time,
		ccStmt.BankTranList.DtEnd.Time,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create period: %w", err)
	}

	// Parse transactions
	transactions, err := p.parseTransactions(ccStmt.BankTranList)
	if err != nil {
		return nil, fmt.Errorf("failed to parse transactions: %w", err)
	}

	return &parser.RawStatement{
		Account:      *account,
		Period:       *period,
		Transactions: transactions,
	}, nil
}

// parseBank parses bank account statement
func (p *Parser) parseBank(resp *ofxgo.Response, meta *parser.Metadata) (*parser.RawStatement, error) {
	if len(resp.Bank) == 0 {
		return nil, fmt.Errorf("parseBank called with empty Bank array")
	}

	bankStmt, ok := resp.Bank[0].(*ofxgo.StatementResponse)
	if !ok {
		return nil, fmt.Errorf("failed to type assert bank statement: expected *ofxgo.StatementResponse, got %T", resp.Bank[0])
	}

	// Extract institution ID from OFX response
	institutionID, err := extractInstitutionID(resp)
	if err != nil {
		return nil, err
	}

	// Extract account ID
	accountID := bankStmt.BankAcctFrom.AcctID.String()
	if accountID == "" {
		return nil, fmt.Errorf("missing account ID in bank statement")
	}

	// Map account type
	accountType, err := mapBankAccountType(bankStmt.BankAcctFrom)
	if err != nil {
		return nil, fmt.Errorf("failed to map account type: %w", err)
	}

	// Create account
	account, err := parser.NewRawAccount(institutionID, "", accountID, accountType)
	if err != nil {
		return nil, fmt.Errorf("failed to create raw account: %w", err)
	}

	// Set institution name from metadata if available
	setInstitutionNameFromMeta(account, meta)

	// Transaction list is required
	if bankStmt.BankTranList == nil {
		return nil, fmt.Errorf("missing transaction list in bank statement")
	}

	// Extract period
	period, err := parser.NewPeriod(
		bankStmt.BankTranList.DtStart.Time,
		bankStmt.BankTranList.DtEnd.Time,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create period: %w", err)
	}

	// Parse transactions
	transactions, err := p.parseTransactions(bankStmt.BankTranList)
	if err != nil {
		return nil, fmt.Errorf("failed to parse transactions: %w", err)
	}

	return &parser.RawStatement{
		Account:      *account,
		Period:       *period,
		Transactions: transactions,
	}, nil
}

// parseInvestment parses investment account statement
func (p *Parser) parseInvestment(resp *ofxgo.Response, meta *parser.Metadata) (*parser.RawStatement, error) {
	if len(resp.InvStmt) == 0 {
		return nil, fmt.Errorf("parseInvestment called with empty InvStmt array")
	}

	invStmt, ok := resp.InvStmt[0].(*ofxgo.InvStatementResponse)
	if !ok {
		return nil, fmt.Errorf("failed to type assert investment statement: expected *ofxgo.InvStatementResponse, got %T", resp.InvStmt[0])
	}

	// Extract institution ID from OFX response
	institutionID, err := extractInstitutionID(resp)
	if err != nil {
		return nil, err
	}

	// Extract account ID
	accountID := invStmt.InvAcctFrom.AcctID.String()
	if accountID == "" {
		return nil, fmt.Errorf("missing account ID in investment statement")
	}

	// Create account
	account, err := parser.NewRawAccount(institutionID, "", accountID, "investment")
	if err != nil {
		return nil, fmt.Errorf("failed to create raw account: %w", err)
	}

	// Set institution name from metadata if available
	setInstitutionNameFromMeta(account, meta)

	// Transaction list is required
	if invStmt.InvTranList == nil {
		return nil, fmt.Errorf("missing transaction list in investment statement")
	}

	// Extract period
	period, err := parser.NewPeriod(
		invStmt.InvTranList.DtStart.Time,
		invStmt.InvTranList.DtEnd.Time,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create period: %w", err)
	}

	// Parse investment transactions
	transactions, err := p.parseInvestmentTransactions(invStmt.InvTranList)
	if err != nil {
		return nil, fmt.Errorf("failed to parse investment transactions: %w", err)
	}

	return &parser.RawStatement{
		Account:      *account,
		Period:       *period,
		Transactions: transactions,
	}, nil
}

// parseTransactions converts OFX transactions to RawTransactions (for bank/credit card)
func (p *Parser) parseTransactions(tranList *ofxgo.TransactionList) ([]parser.RawTransaction, error) {
	transactions := make([]parser.RawTransaction, 0, len(tranList.Transactions))

	for i, txn := range tranList.Transactions {
		rawTxn, err := extractTransaction(txn)
		if err != nil {
			return nil, fmt.Errorf("failed to parse transaction at index %d: %w", i, err)
		}
		// extractTransaction never returns nil without error, so no nil check needed
		transactions = append(transactions, *rawTxn)
	}

	return transactions, nil
}

// parseInvestmentTransactions converts OFX investment transactions to RawTransactions
func (p *Parser) parseInvestmentTransactions(tranList *ofxgo.InvTranList) ([]parser.RawTransaction, error) {
	transactions := make([]parser.RawTransaction, 0)

	// Parse bank transactions within investment accounts
	// These are typically cash movements (dividends, interest, fees, etc.)
	for _, invBankTxn := range tranList.BankTransactions {
		// Each InvBankTransaction contains a list of regular transactions
		for i, txn := range invBankTxn.Transactions {
			rawTxn, err := extractTransaction(txn)
			if err != nil {
				return nil, fmt.Errorf("failed to parse investment transaction at index %d: %w", i, err)
			}
			// extractTransaction never returns nil without error, so no nil check needed
			transactions = append(transactions, *rawTxn)
		}
	}

	// Security transactions (BuyStock, SellStock, ReinvestIncome, etc.) are not implemented.
	// Only cash movement transactions from InvBankTransaction are supported (dividends, interest, fees).
	// Security transactions require either: (1) extending RawTransaction with security-specific fields
	// (units, price per share, commission), or (2) creating a separate SecurityTransaction type.
	// TODO(#1294): Implement security transaction support
	securityTxnCount := len(tranList.InvTransactions)
	if securityTxnCount > 0 {
		return nil, fmt.Errorf("investment statement contains %d security transactions (BuyStock, SellStock, ReinvestIncome, etc.) which are not yet supported by this parser (see issue #1294). Only cash movement transactions (dividends, interest, fees) are currently supported", securityTxnCount)
	}

	return transactions, nil
}

// mapBankAccountType maps OFX account type to internal account type
// TODO(#1323): Add support for MONEYMRKT, CREDITLINE, and CD account types or use fallback pattern
func mapBankAccountType(ofxAcct ofxgo.BankAcct) (string, error) {
	switch ofxAcct.AcctType {
	case ofxgo.AcctTypeChecking:
		return "checking", nil
	case ofxgo.AcctTypeSavings:
		return "savings", nil
	default:
		return "", fmt.Errorf("unknown OFX account type %v for account %s. Supported types: CHECKING, SAVINGS. This may indicate a new account type that needs to be added to the parser",
			ofxAcct.AcctType, ofxAcct.AcctID.String())
	}
}

// mapOFXTransactionType maps OFX transaction type to internal transaction type
func mapOFXTransactionType(txn ofxgo.Transaction) string {
	switch txn.TrnType {
	case ofxgo.TrnTypeCredit:
		return "CREDIT"
	case ofxgo.TrnTypeDebit:
		return "DEBIT"
	case ofxgo.TrnTypeATM:
		return "ATM"
	case ofxgo.TrnTypeCheck:
		return "CHECK"
	case ofxgo.TrnTypeXfer:
		return "TRANSFER"
	case ofxgo.TrnTypeFee:
		return "FEE"
	case ofxgo.TrnTypePOS:
		return "POS"
	case ofxgo.TrnTypePayment:
		return "PAYMENT"
	case ofxgo.TrnTypeInt:
		return "INTEREST"
	case ofxgo.TrnTypeDep:
		return "DEPOSIT"
	default:
		// Convert unknown transaction types to UNKNOWN_* format for downstream processing.
		// The UNKNOWN_ prefix allows downstream code to identify and handle unsupported types.
		unknownType := fmt.Sprintf("UNKNOWN_%v", txn.TrnType)

		// Log unknown transaction type for operational visibility
		// TODO(#1306): Add structured logging when project has logger infrastructure
		fmt.Fprintf(os.Stderr, "Warning: Unknown OFX transaction type %v mapped to %s (transaction ID: %s)\n",
			txn.TrnType, unknownType, txn.FiTID.String())

		return unknownType
	}
}

// extractInstitutionID extracts and validates institution ID from OFX response
// TODO(#1315): Add test for error path when Organization is empty
func extractInstitutionID(resp *ofxgo.Response) (string, error) {
	institutionID := resp.Signon.Org.String()
	if institutionID == "" {
		return "", fmt.Errorf("missing institution ID in OFX response")
	}
	return institutionID, nil
}

// setInstitutionNameFromMeta sets institution name from metadata if available
func setInstitutionNameFromMeta(account *parser.RawAccount, meta *parser.Metadata) {
	if meta != nil && meta.Institution() != "" {
		account.SetInstitutionName(meta.Institution())
	}
}

// extractTransaction extracts common transaction fields from OFX transaction
func extractTransaction(txn ofxgo.Transaction) (*parser.RawTransaction, error) {
	// Extract transaction ID
	id := txn.FiTID.String()
	if id == "" {
		return nil, fmt.Errorf("transaction missing required ID field")
	}

	// Use posted date; if not available, fallback to user date
	date := txn.DtPosted.Time
	if date.IsZero() {
		date = txn.DtUser.Time
	}
	if date.IsZero() {
		return nil, fmt.Errorf("transaction %s missing both posted date and user date", id)
	}

	// Use the resolved date for both date and postedDate fields.
	// Both RawTransaction fields require valid dates, so we use the same resolved date.
	postedDate := date

	// Use Name field for description; if empty, fallback to Memo field
	description := txn.Name.String()
	if description == "" {
		description = txn.Memo.String()
	}
	description = strings.TrimSpace(description)
	if description == "" {
		return nil, fmt.Errorf("transaction %s missing both name and memo fields", id)
	}

	// Extract amount. Float64() returns (float64, bool) where the bool indicates exact representation.
	// Typical financial transactions (2 decimal places) fit within float64 precision, but high-precision
	// currencies or very large amounts may lose precision. Log a warning when precision loss occurs.
	// TODO(#1307): Consider using a decimal library if precision loss becomes common in production.
	// TODO(#1317): Add test validating precision behavior with edge case amounts
	amount, exact := txn.TrnAmt.Float64()
	if !exact {
		fmt.Fprintf(os.Stderr, "Warning: Precision loss in transaction %s amount: %v (cannot be exactly represented as float64)\n", id, txn.TrnAmt)
	}

	// Create raw transaction
	rawTxn, err := parser.NewRawTransaction(id, date, postedDate, description, amount)
	if err != nil {
		return nil, fmt.Errorf("failed to create transaction %s: %w", id, err)
	}

	// Set transaction type
	txnType := mapOFXTransactionType(txn)
	rawTxn.SetType(txnType)

	// Set memo
	memo := strings.TrimSpace(txn.Memo.String())
	if memo != "" {
		rawTxn.SetMemo(memo)
	}

	return rawTxn, nil
}
