// Package ofx provides OFX/QFX statement parsing for finparse
package ofx

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/aclindsa/ofxgo"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
)

// Parser implements OFX/QFX parsing
type Parser struct{}

// NewParser creates a new OFX parser
func NewParser() *Parser {
	return &Parser{}
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
	content, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("failed to read OFX content: %w", err)
	}

	// Parse OFX response
	response, err := ofxgo.ParseResponse(bytes.NewReader(content))
	if err != nil {
		return nil, fmt.Errorf("failed to parse OFX file: %w", err)
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

	return nil, fmt.Errorf("no supported statement type found in OFX file")
}

// parseCreditCard parses credit card statement
func (p *Parser) parseCreditCard(resp *ofxgo.Response, meta *parser.Metadata) (*parser.RawStatement, error) {
	ccStmt, ok := resp.CreditCard[0].(*ofxgo.CCStatementResponse)
	if !ok {
		return nil, fmt.Errorf("failed to type assert credit card statement")
	}

	// Extract institution ID from OFX response
	institutionID := resp.Signon.Org.String()
	if institutionID == "" {
		return nil, fmt.Errorf("missing institution ID in OFX response")
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
	if meta != nil && meta.Institution() != "" {
		account.SetInstitutionName(meta.Institution())
	}

	// Extract period
	var period *parser.Period
	if ccStmt.BankTranList != nil {
		period, err = parser.NewPeriod(
			ccStmt.BankTranList.DtStart.Time,
			ccStmt.BankTranList.DtEnd.Time,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create period: %w", err)
		}
	}

	// Parse transactions
	var transactions []parser.RawTransaction
	if ccStmt.BankTranList != nil {
		transactions, err = p.parseTransactions(ccStmt.BankTranList)
		if err != nil {
			return nil, fmt.Errorf("failed to parse transactions: %w", err)
		}
	}

	return &parser.RawStatement{
		Account:      *account,
		Period:       *period,
		Transactions: transactions,
	}, nil
}

// parseBank parses bank account statement
func (p *Parser) parseBank(resp *ofxgo.Response, meta *parser.Metadata) (*parser.RawStatement, error) {
	bankStmt, ok := resp.Bank[0].(*ofxgo.StatementResponse)
	if !ok {
		return nil, fmt.Errorf("failed to type assert bank statement")
	}

	// Extract institution ID from OFX response
	institutionID := resp.Signon.Org.String()
	if institutionID == "" {
		return nil, fmt.Errorf("missing institution ID in OFX response")
	}

	// Extract account ID
	accountID := bankStmt.BankAcctFrom.AcctID.String()
	if accountID == "" {
		return nil, fmt.Errorf("missing account ID in bank statement")
	}

	// Map account type
	accountType := mapBankAccountType(bankStmt.BankAcctFrom)

	// Create account
	account, err := parser.NewRawAccount(institutionID, "", accountID, accountType)
	if err != nil {
		return nil, fmt.Errorf("failed to create raw account: %w", err)
	}

	// Set institution name from metadata if available
	if meta != nil && meta.Institution() != "" {
		account.SetInstitutionName(meta.Institution())
	}

	// Extract period
	var period *parser.Period
	if bankStmt.BankTranList != nil {
		period, err = parser.NewPeriod(
			bankStmt.BankTranList.DtStart.Time,
			bankStmt.BankTranList.DtEnd.Time,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create period: %w", err)
		}
	}

	// Parse transactions
	var transactions []parser.RawTransaction
	if bankStmt.BankTranList != nil {
		transactions, err = p.parseTransactions(bankStmt.BankTranList)
		if err != nil {
			return nil, fmt.Errorf("failed to parse transactions: %w", err)
		}
	}

	return &parser.RawStatement{
		Account:      *account,
		Period:       *period,
		Transactions: transactions,
	}, nil
}

// parseInvestment parses investment account statement
func (p *Parser) parseInvestment(resp *ofxgo.Response, meta *parser.Metadata) (*parser.RawStatement, error) {
	invStmt, ok := resp.InvStmt[0].(*ofxgo.InvStatementResponse)
	if !ok {
		return nil, fmt.Errorf("failed to type assert investment statement")
	}

	// Extract institution ID from OFX response
	institutionID := resp.Signon.Org.String()
	if institutionID == "" {
		return nil, fmt.Errorf("missing institution ID in OFX response")
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
	if meta != nil && meta.Institution() != "" {
		account.SetInstitutionName(meta.Institution())
	}

	// Extract period
	var period *parser.Period
	if invStmt.InvTranList != nil {
		period, err = parser.NewPeriod(
			invStmt.InvTranList.DtStart.Time,
			invStmt.InvTranList.DtEnd.Time,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create period: %w", err)
		}
	}

	// Parse investment transactions
	var transactions []parser.RawTransaction
	if invStmt.InvTranList != nil {
		transactions, err = p.parseInvestmentTransactions(invStmt.InvTranList)
		if err != nil {
			return nil, fmt.Errorf("failed to parse investment transactions: %w", err)
		}
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

	for _, txn := range tranList.Transactions {
		// Extract transaction ID
		id := txn.FiTID.String()
		if id == "" {
			continue // Skip transactions without ID
		}

		// Extract date (prefer posted date, fallback to user date)
		date := txn.DtPosted.Time
		if date.IsZero() {
			date = txn.DtUser.Time
		}
		if date.IsZero() {
			continue // Skip transactions without date
		}

		// Extract posted date
		postedDate := txn.DtPosted.Time
		if postedDate.IsZero() {
			postedDate = date // Fallback to transaction date
		}

		// Extract description (prefer Name, fallback to Memo)
		description := txn.Name.String()
		if description == "" {
			description = txn.Memo.String()
		}
		description = strings.TrimSpace(description)
		if description == "" {
			continue // Skip transactions without description
		}

		// Extract amount
		amount, _ := txn.TrnAmt.Float64()

		// Create raw transaction
		rawTxn, err := parser.NewRawTransaction(id, date, postedDate, description, amount)
		if err != nil {
			continue // Skip invalid transactions
		}

		// Set transaction type
		txnType := mapOFXTransactionType(txn)
		rawTxn.SetType(txnType)

		// Set memo
		memo := strings.TrimSpace(txn.Memo.String())
		if memo != "" {
			rawTxn.SetMemo(memo)
		}

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
		for _, txn := range invBankTxn.Transactions {
			// Extract transaction ID
			id := txn.FiTID.String()
			if id == "" {
				continue
			}

			// Extract date
			date := txn.DtPosted.Time
			if date.IsZero() {
				date = txn.DtUser.Time
			}
			if date.IsZero() {
				continue
			}

			postedDate := txn.DtPosted.Time
			if postedDate.IsZero() {
				postedDate = date
			}

			// Extract description
			description := txn.Name.String()
			if description == "" {
				description = txn.Memo.String()
			}
			description = strings.TrimSpace(description)
			if description == "" {
				continue
			}

			// Extract amount
			amount, _ := txn.TrnAmt.Float64()

			rawTxn, err := parser.NewRawTransaction(id, date, postedDate, description, amount)
			if err != nil {
				continue
			}

			// Set transaction type
			txnType := mapOFXTransactionType(txn)
			rawTxn.SetType(txnType)

			// Set memo
			memo := strings.TrimSpace(txn.Memo.String())
			if memo != "" {
				rawTxn.SetMemo(memo)
			}

			transactions = append(transactions, *rawTxn)
		}
	}

	// For security-related transactions (buy/sell/reinvest), we need type-specific
	// handling which varies significantly. For now, we focus on cash movements.
	// TODO: Add detailed parsing for security transactions if needed

	return transactions, nil
}

// mapBankAccountType maps OFX account type to internal account type
// Note: ofxgo uses unexported acctType, so we need to handle the field value directly
func mapBankAccountType(ofxAcct ofxgo.BankAcct) string {
	switch ofxAcct.AcctType {
	case ofxgo.AcctTypeChecking:
		return "checking"
	case ofxgo.AcctTypeSavings:
		return "savings"
	default:
		return "checking" // Default to checking for unknown types
	}
}

// mapOFXTransactionType maps OFX transaction type to internal transaction type
// Note: ofxgo uses unexported trnType, so we work with the transaction field directly
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
		// For unknown types, infer from amount (empty string is also acceptable)
		return ""
	}
}
