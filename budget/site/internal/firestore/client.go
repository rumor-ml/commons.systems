package firestore

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
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
		if err != nil {
			break
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
		if err != nil {
			break
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
		if err != nil {
			break
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
		if err != nil {
			break
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
