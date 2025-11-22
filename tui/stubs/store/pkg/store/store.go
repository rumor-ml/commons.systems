package store

import (
	"database/sql"
	"fmt"

	_ "github.com/mattn/go-sqlite3"
)

// BaseStore provides database access
type BaseStore struct {
	db *sql.DB
}

// New creates a new store with the given database path
func New(dbPath string) (*BaseStore, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Test the connection
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return &BaseStore{db: db}, nil
}

// DB returns the underlying database connection
func (s *BaseStore) DB() *sql.DB {
	return s.db
}

// Close closes the database connection
func (s *BaseStore) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}
