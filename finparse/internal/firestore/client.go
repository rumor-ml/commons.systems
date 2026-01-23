package firestore

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

// Client wraps Firestore client with budget-specific operations
type Client struct {
	Firestore *firestore.Client
	Auth      *auth.Client
	projectID string
}

// NewClient creates a new Firestore client
func NewClient(ctx context.Context, projectID string) (*Client, error) {
	// Initialize Firebase app
	conf := &firebase.Config{ProjectID: projectID}

	// Try to use Application Default Credentials first
	var opts []option.ClientOption
	credsPath := ""

	// Check for explicit credentials file
	if credsPath != "" {
		opts = append(opts, option.WithCredentialsFile(credsPath))
	}

	app, err := firebase.NewApp(ctx, conf, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize Firebase app: %w", err)
	}

	// Create Firestore client
	firestoreClient, err := app.Firestore(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create Firestore client: %w", err)
	}

	// Create Auth client
	authClient, err := app.Auth(ctx)
	if err != nil {
		firestoreClient.Close()
		return nil, fmt.Errorf("failed to create Auth client: %w", err)
	}

	return &Client{
		Firestore: firestoreClient,
		Auth:      authClient,
		projectID: projectID,
	}, nil
}

// Close closes the Firestore client
func (c *Client) Close() error {
	return c.Firestore.Close()
}

// Transaction represents a budget transaction in Firestore
type Transaction struct {
	ID                  string    `firestore:"id"`
	UserID              string    `firestore:"userId"`
	Date                string    `firestore:"date"`
	Description         string    `firestore:"description"`
	Amount              float64   `firestore:"amount"`
	Category            string    `firestore:"category"`
	Redeemable          bool      `firestore:"redeemable"`
	Vacation            bool      `firestore:"vacation"`
	Transfer            bool      `firestore:"transfer"`
	RedemptionRate      float64   `firestore:"redemptionRate"`
	LinkedTransactionID *string   `firestore:"linkedTransactionId,omitempty"`
	StatementIDs        []string  `firestore:"statementIds"`
	CreatedAt           time.Time `firestore:"createdAt"`
}

// Validate checks if the Transaction has valid data
func (t *Transaction) Validate() error {
	if t.ID == "" {
		return fmt.Errorf("transaction ID is required")
	}
	if t.UserID == "" {
		return fmt.Errorf("user ID is required")
	}

	// Validate date format
	if _, err := time.Parse("2006-01-02", t.Date); err != nil {
		return fmt.Errorf("invalid date format (expected YYYY-MM-DD): %w", err)
	}

	// Validate redemption rate
	if t.RedemptionRate < 0 || t.RedemptionRate > 1 {
		return fmt.Errorf("redemption rate must be between 0 and 1")
	}

	// Ensure StatementIDs is not nil
	if t.StatementIDs == nil {
		t.StatementIDs = []string{}
	}

	return nil
}

// Statement represents a budget statement in Firestore
type Statement struct {
	ID             string    `firestore:"id"`
	UserID         string    `firestore:"userId"`
	AccountID      string    `firestore:"accountId"`
	StartDate      string    `firestore:"startDate"`
	EndDate        string    `firestore:"endDate"`
	TransactionIDs []string  `firestore:"transactionIds"`
	CreatedAt      time.Time `firestore:"createdAt"`
}

// Account represents a budget account in Firestore
type Account struct {
	ID            string    `firestore:"id"`
	UserID        string    `firestore:"userId"`
	InstitutionID string    `firestore:"institutionId"`
	Name          string    `firestore:"name"`
	Type          string    `firestore:"type"`
	CreatedAt     time.Time `firestore:"createdAt"`
}

// Institution represents a financial institution in Firestore
type Institution struct {
	ID        string    `firestore:"id"`
	UserID    string    `firestore:"userId"`
	Name      string    `firestore:"name"`
	CreatedAt time.Time `firestore:"createdAt"`
}

// GetTransactions retrieves all transactions for a user
func (c *Client) GetTransactions(ctx context.Context, userID string) ([]*Transaction, error) {
	iter := c.Firestore.Collection("budget-transactions").
		Where("userId", "==", userID).
		OrderBy("date", firestore.Desc).
		Documents(ctx)

	var transactions []*Transaction
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to iterate transactions for user %s: %w", userID, err)
		}

		var txn Transaction
		if err := doc.DataTo(&txn); err != nil {
			return nil, fmt.Errorf("failed to parse transaction: %w", err)
		}
		transactions = append(transactions, &txn)
	}

	return transactions, nil
}

// CreateTransaction creates a new transaction
func (c *Client) CreateTransaction(ctx context.Context, txn *Transaction) error {
	if err := txn.Validate(); err != nil {
		return fmt.Errorf("invalid transaction: %w", err)
	}
	_, err := c.Firestore.Collection("budget-transactions").Doc(txn.ID).Set(ctx, txn)
	return err
}

// GetStatements retrieves all statements for a user
func (c *Client) GetStatements(ctx context.Context, userID string) ([]*Statement, error) {
	iter := c.Firestore.Collection("budget-statements").
		Where("userId", "==", userID).
		OrderBy("startDate", firestore.Desc).
		Documents(ctx)

	var statements []*Statement
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to iterate statements for user %s: %w", userID, err)
		}

		var stmt Statement
		if err := doc.DataTo(&stmt); err != nil {
			return nil, fmt.Errorf("failed to parse statement: %w", err)
		}
		statements = append(statements, &stmt)
	}

	return statements, nil
}

// CreateStatement creates a new statement
func (c *Client) CreateStatement(ctx context.Context, stmt *Statement) error {
	_, err := c.Firestore.Collection("budget-statements").Doc(stmt.ID).Set(ctx, stmt)
	return err
}

// GetAccounts retrieves all accounts for a user
func (c *Client) GetAccounts(ctx context.Context, userID string) ([]*Account, error) {
	iter := c.Firestore.Collection("budget-accounts").
		Where("userId", "==", userID).
		Documents(ctx)

	var accounts []*Account
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to iterate accounts for user %s: %w", userID, err)
		}

		var acc Account
		if err := doc.DataTo(&acc); err != nil {
			return nil, fmt.Errorf("failed to parse account: %w", err)
		}
		accounts = append(accounts, &acc)
	}

	return accounts, nil
}

// CreateAccount creates a new account
func (c *Client) CreateAccount(ctx context.Context, acc *Account) error {
	_, err := c.Firestore.Collection("budget-accounts").Doc(acc.ID).Set(ctx, acc)
	return err
}

// GetInstitutions retrieves all institutions for a user
func (c *Client) GetInstitutions(ctx context.Context, userID string) ([]*Institution, error) {
	iter := c.Firestore.Collection("budget-institutions").
		Where("userId", "==", userID).
		Documents(ctx)

	var institutions []*Institution
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to iterate institutions for user %s: %w", userID, err)
		}

		var inst Institution
		if err := doc.DataTo(&inst); err != nil {
			return nil, fmt.Errorf("failed to parse institution: %w", err)
		}
		institutions = append(institutions, &inst)
	}

	return institutions, nil
}

// CreateInstitution creates a new institution
func (c *Client) CreateInstitution(ctx context.Context, inst *Institution) error {
	_, err := c.Firestore.Collection("budget-institutions").Doc(inst.ID).Set(ctx, inst)
	return err
}

// ParseSessionStatus represents the status of a parse session
type ParseSessionStatus string

const (
	ParseSessionStatusPending    ParseSessionStatus = "pending"
	ParseSessionStatusProcessing ParseSessionStatus = "processing"
	ParseSessionStatusCompleted  ParseSessionStatus = "completed"
	ParseSessionStatusError      ParseSessionStatus = "error"
	ParseSessionStatusCancelled  ParseSessionStatus = "cancelled"
)

// ParseSession represents a file parsing session in Firestore
type ParseSession struct {
	ID          string                 `firestore:"id"`
	UserID      string                 `firestore:"userId"`
	Status      ParseSessionStatus     `firestore:"status"`
	FileCount   int                    `firestore:"fileCount"`
	Stats       map[string]interface{} `firestore:"stats"`
	CompletedAt *time.Time             `firestore:"completedAt,omitempty"`
	Error       string                 `firestore:"error,omitempty"`
	CreatedAt   time.Time              `firestore:"createdAt"`
}

// Validate checks if the ParseSession has valid data
func (s *ParseSession) Validate() error {
	if s.ID == "" {
		return fmt.Errorf("session ID is required")
	}
	if s.UserID == "" {
		return fmt.Errorf("user ID is required")
	}

	// Validate status is one of known values
	validStatuses := map[ParseSessionStatus]bool{
		ParseSessionStatusPending:    true,
		ParseSessionStatusProcessing: true,
		ParseSessionStatusCompleted:  true,
		ParseSessionStatusError:      true,
		ParseSessionStatusCancelled:  true,
	}
	if !validStatuses[s.Status] {
		return fmt.Errorf("invalid status: %s", s.Status)
	}

	// Validate FileCount is non-negative
	if s.FileCount < 0 {
		return fmt.Errorf("file count cannot be negative")
	}

	return nil
}

// CreateParseSession creates a new parse session
func (c *Client) CreateParseSession(ctx context.Context, session *ParseSession) error {
	_, err := c.Firestore.Collection("budget-parse-sessions").Doc(session.ID).Set(ctx, session)
	return err
}

// UpdateParseSession updates an existing parse session
func (c *Client) UpdateParseSession(ctx context.Context, session *ParseSession) error {
	_, err := c.Firestore.Collection("budget-parse-sessions").Doc(session.ID).Set(ctx, session)
	return err
}

// GetParseSession retrieves a parse session by ID
func (c *Client) GetParseSession(ctx context.Context, sessionID string) (*ParseSession, error) {
	doc, err := c.Firestore.Collection("budget-parse-sessions").Doc(sessionID).Get(ctx)
	if err != nil {
		return nil, err
	}

	var session ParseSession
	if err := doc.DataTo(&session); err != nil {
		return nil, fmt.Errorf("failed to parse session: %w", err)
	}

	return &session, nil
}

// ListParseSessions retrieves all parse sessions for a user
func (c *Client) ListParseSessions(ctx context.Context, userID string) ([]*ParseSession, error) {
	iter := c.Firestore.Collection("budget-parse-sessions").
		Where("userId", "==", userID).
		OrderBy("createdAt", firestore.Desc).
		Limit(50).
		Documents(ctx)

	var sessions []*ParseSession
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to iterate parse sessions for user %s: %w", userID, err)
		}

		var sess ParseSession
		if err := doc.DataTo(&sess); err != nil {
			return nil, fmt.Errorf("failed to parse session: %w", err)
		}
		sessions = append(sessions, &sess)
	}

	return sessions, nil
}
