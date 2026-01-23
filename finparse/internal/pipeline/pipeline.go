package pipeline

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
	"github.com/rumor-ml/commons.systems/finparse/internal/firestore"
	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
	"github.com/rumor-ml/commons.systems/finparse/internal/parsers/csv"
	"github.com/rumor-ml/commons.systems/finparse/internal/parsers/ofx"
	"github.com/rumor-ml/commons.systems/finparse/internal/streaming"
)

// ProgressCallback is called with progress updates during parsing
type ProgressCallback func(progress streaming.ProgressEvent)

// ParseResult contains the results of parsing a single file
type ParseResult struct {
	FileName     string
	Transactions []*firestore.Transaction
	Statement    *firestore.Statement
	Account      *firestore.Account
	Institution  *firestore.Institution
	Error        error
}

// Pipeline orchestrates parsing files and writing to Firestore
type Pipeline struct {
	fsClient *firestore.Client
	parsers  []parser.Parser
	hub      *streaming.StreamHub
}

// NewPipeline creates a new parser pipeline
func NewPipeline(fsClient *firestore.Client, hub *streaming.StreamHub) *Pipeline {
	return &Pipeline{
		fsClient: fsClient,
		parsers: []parser.Parser{
			csv.NewParser(),
			ofx.NewParser(),
		},
		hub: hub,
	}
}

// ParseFile parses a single file and returns structured data
func (p *Pipeline) ParseFile(ctx context.Context, filePath string, userID string) (*ParseResult, error) {
	// Open file
	f, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer f.Close()

	// Read header to determine parser
	header := make([]byte, 1024)
	n, err := f.Read(header)
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("failed to read header: %w", err)
	}
	header = header[:n]

	// Reset file pointer
	if _, err := f.Seek(0, 0); err != nil {
		return nil, fmt.Errorf("failed to seek: %w", err)
	}

	// Find appropriate parser
	var selectedParser parser.Parser
	for _, p := range p.parsers {
		if p.CanParse(filePath, header) {
			selectedParser = p
			break
		}
	}

	if selectedParser == nil {
		return nil, fmt.Errorf("no parser found for file: %s", filepath.Base(filePath))
	}

	// Create metadata
	meta, err := parser.NewMetadata(filePath, time.Now())
	if err != nil {
		return nil, fmt.Errorf("failed to create metadata: %w", err)
	}

	// Parse file
	rawStatement, err := selectedParser.Parse(ctx, f, meta)
	if err != nil {
		return nil, fmt.Errorf("parsing failed: %w", err)
	}

	// Convert to Firestore types
	result := &ParseResult{
		FileName: filepath.Base(filePath),
	}

	// Convert institution
	instName := rawStatement.Account.InstitutionName()
	if instName == "" {
		instName = rawStatement.Account.InstitutionID()
	}
	result.Institution = &firestore.Institution{
		ID:     fmt.Sprintf("%s-%s", userID, rawStatement.Account.InstitutionID()),
		UserID: userID,
		Name:   instName,
	}

	// Convert account
	result.Account = &firestore.Account{
		ID:            fmt.Sprintf("%s-%s", userID, rawStatement.Account.AccountID()),
		UserID:        userID,
		InstitutionID: result.Institution.ID,
		Name:          rawStatement.Account.AccountID(),
		Type:          rawStatement.Account.AccountType(),
	}

	// Convert statement
	result.Statement = &firestore.Statement{
		ID:        fmt.Sprintf("%s-%s-%s", userID, result.Account.ID, rawStatement.Period.Start().Format("2006-01-02")),
		UserID:    userID,
		AccountID: result.Account.ID,
		StartDate: rawStatement.Period.Start().Format("2006-01-02"),
		EndDate:   rawStatement.Period.End().Format("2006-01-02"),
	}

	// Convert transactions
	result.Transactions = make([]*firestore.Transaction, 0, len(rawStatement.Transactions))
	txnIDs := make([]string, 0, len(rawStatement.Transactions))

	for _, rawTxn := range rawStatement.Transactions {
		txnID := fmt.Sprintf("%s-%s", userID, rawTxn.ID())

		// Default category mapping based on amount
		category := domain.CategoryOther
		if rawTxn.Amount() > 0 {
			category = domain.CategoryIncome
		}

		txn := &firestore.Transaction{
			ID:           txnID,
			UserID:       userID,
			Date:         rawTxn.Date().Format("2006-01-02"),
			Description:  rawTxn.Description(),
			Amount:       rawTxn.Amount(),
			Category:     string(category),
			StatementIDs: []string{result.Statement.ID},
		}

		result.Transactions = append(result.Transactions, txn)
		txnIDs = append(txnIDs, txnID)
	}

	result.Statement.TransactionIDs = txnIDs

	return result, nil
}

// ProcessFiles parses multiple files and writes to Firestore with progress updates
func (p *Pipeline) ProcessFiles(ctx context.Context, sessionID string, filePaths []string, userID string) error {
	totalFiles := len(filePaths)

	for i, filePath := range filePaths {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		fileName := filepath.Base(filePath)
		fileID := fmt.Sprintf("%s-%d", sessionID, i)

		// Broadcast file start event
		p.hub.Broadcast(sessionID, streaming.SSEEvent{
			Type: streaming.EventTypeFile,
			Data: streaming.FileEvent{
				ID:        fileID,
				SessionID: sessionID,
				FileName:  fileName,
				Status:    "processing",
			},
		})

		// Parse file
		result, err := p.ParseFile(ctx, filePath, userID)
		if err != nil {
			log.Printf("ERROR: Failed to parse file %s: %v", fileName, err)
			p.hub.Broadcast(sessionID, streaming.SSEEvent{
				Type: streaming.EventTypeFile,
				Data: streaming.FileEvent{
					ID:        fileID,
					SessionID: sessionID,
					FileName:  fileName,
					Status:    "error",
					Error:     err.Error(),
				},
			})
			continue
		}

		// Write to Firestore
		if err := p.writeToFirestore(ctx, result); err != nil {
			log.Printf("ERROR: Failed to write to Firestore for file %s: %v", fileName, err)
			p.hub.Broadcast(sessionID, streaming.SSEEvent{
				Type: streaming.EventTypeFile,
				Data: streaming.FileEvent{
					ID:        fileID,
					SessionID: sessionID,
					FileName:  fileName,
					Status:    "error",
					Error:     fmt.Sprintf("Failed to write to Firestore: %v", err),
				},
			})
			continue
		}

		// Broadcast progress
		percentage := float64(i+1) / float64(totalFiles) * 100
		p.hub.Broadcast(sessionID, streaming.SSEEvent{
			Type: streaming.EventTypeProgress,
			Data: streaming.ProgressEvent{
				FileID:     fileID,
				FileName:   fileName,
				Processed:  i + 1,
				Total:      totalFiles,
				Percentage: percentage,
				Status:     "completed",
			},
		})

		// Broadcast file completion
		p.hub.Broadcast(sessionID, streaming.SSEEvent{
			Type: streaming.EventTypeFile,
			Data: streaming.FileEvent{
				ID:        fileID,
				SessionID: sessionID,
				FileName:  fileName,
				Status:    "completed",
				Metadata: map[string]interface{}{
					"transactions": len(result.Transactions),
				},
			},
		})
	}

	return nil
}

// writeToFirestore writes parsed data to Firestore
func (p *Pipeline) writeToFirestore(ctx context.Context, result *ParseResult) error {
	// Create institution (idempotent)
	if err := p.fsClient.CreateInstitution(ctx, result.Institution); err != nil {
		return fmt.Errorf("failed to create institution: %w", err)
	}

	// Create account (idempotent)
	if err := p.fsClient.CreateAccount(ctx, result.Account); err != nil {
		return fmt.Errorf("failed to create account: %w", err)
	}

	// Create statement (idempotent)
	if err := p.fsClient.CreateStatement(ctx, result.Statement); err != nil {
		return fmt.Errorf("failed to create statement: %w", err)
	}

	// Create transactions (batch)
	for _, txn := range result.Transactions {
		if err := p.fsClient.CreateTransaction(ctx, txn); err != nil {
			return fmt.Errorf("failed to create transaction %s: %w", txn.ID, err)
		}
	}

	return nil
}
