package filesync

import (
	"context"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

const (
	sessionsCollectionBase = "printsync-sessions"
	filesCollectionBase    = "printsync-files"
)

// getCollectionPrefix returns the collection prefix based on environment variables.
//
// Priority order (highest to lowest):
//  1. PR_NUMBER - if set, returns "pr_<number>_" (no sanitization)
//  2. BRANCH_NAME - if set and not "main", returns "preview_<sanitized>_"
//     Sanitization: lowercase, replace [^a-z0-9-] with -, truncate to 50 chars
//  3. Production - returns empty string (no prefix) when main branch or no env vars
//
// Examples:
//
//	PR_NUMBER=123           -> "pr_123_"
//	BRANCH_NAME=feature/auth -> "preview_feature-auth_"
//	BRANCH_NAME=main        -> ""
//	(no env vars)           -> ""
func getCollectionPrefix() string {
	// Check for PR number first (highest priority)
	if prNumber := os.Getenv("PR_NUMBER"); prNumber != "" {
		return fmt.Sprintf("pr_%s_", prNumber)
	}

	// Check for branch name
	if branchName := os.Getenv("BRANCH_NAME"); branchName != "" && branchName != "main" {
		// Sanitize branch name: lowercase, replace invalid chars with -, max 50 chars
		sanitized := strings.ToLower(branchName)
		reg := regexp.MustCompile(`[^a-z0-9-]`)
		sanitized = reg.ReplaceAllString(sanitized, "-")
		if len(sanitized) > 50 {
			sanitized = sanitized[:50]
		}
		return fmt.Sprintf("preview_%s_", sanitized)
	}

	// Production: no prefix
	return ""
}

// getCollectionName returns the prefixed collection name
func getCollectionName(baseCollection string) string {
	return getCollectionPrefix() + baseCollection
}

// FirestoreSessionStore implements SessionStore using Firestore
type FirestoreSessionStore struct {
	client *firestore.Client
}

// NewFirestoreSessionStore creates a new Firestore-backed session store
func NewFirestoreSessionStore(client *firestore.Client) *FirestoreSessionStore {
	return &FirestoreSessionStore{client: client}
}

// Create creates a new sync session
func (s *FirestoreSessionStore) Create(ctx context.Context, session *SyncSession) error {
	if session.ID == "" {
		return fmt.Errorf("session ID is required")
	}

	_, err := s.client.Collection(getCollectionName(sessionsCollectionBase)).Doc(session.ID).Set(ctx, session)
	return err
}

// Update updates an existing sync session
func (s *FirestoreSessionStore) Update(ctx context.Context, session *SyncSession) error {
	if session.ID == "" {
		return fmt.Errorf("session ID is required")
	}

	_, err := s.client.Collection(getCollectionName(sessionsCollectionBase)).Doc(session.ID).Set(ctx, session)
	return err
}

// Get retrieves a sync session by ID
func (s *FirestoreSessionStore) Get(ctx context.Context, sessionID string) (*SyncSession, error) {
	doc, err := s.client.Collection(getCollectionName(sessionsCollectionBase)).Doc(sessionID).Get(ctx)
	if err != nil {
		return nil, err
	}

	var session SyncSession
	if err := doc.DataTo(&session); err != nil {
		return nil, err
	}
	session.ID = doc.Ref.ID

	return &session, nil
}

// List retrieves all sync sessions for a user, ordered by start time descending
func (s *FirestoreSessionStore) List(ctx context.Context, userID string) ([]*SyncSession, error) {
	iter := s.client.Collection(getCollectionName(sessionsCollectionBase)).
		Where("userId", "==", userID).
		OrderBy("startedAt", firestore.Desc).
		Documents(ctx)
	defer iter.Stop()

	var sessions []*SyncSession
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}

		var session SyncSession
		if err := doc.DataTo(&session); err != nil {
			return nil, err
		}
		session.ID = doc.Ref.ID

		sessions = append(sessions, &session)
	}

	return sessions, nil
}

// Subscribe subscribes to real-time updates for a session
func (s *FirestoreSessionStore) Subscribe(ctx context.Context, sessionID string, callback func(*SyncSession)) error {
	go func() {
		iter := s.client.Collection(getCollectionName(sessionsCollectionBase)).Doc(sessionID).Snapshots(ctx)
		defer iter.Stop()

		consecutiveErrors := 0
		maxConsecutiveErrors := 5

		for {
			snap, err := iter.Next()
			if err == iterator.Done {
				log.Printf("INFO: Session subscription for %s completed normally", sessionID)
				return
			}
			if err != nil {
				consecutiveErrors++
				log.Printf("ERROR: Session subscription error for %s (consecutive: %d): %v", sessionID, consecutiveErrors, err)

				if consecutiveErrors >= maxConsecutiveErrors {
					log.Printf("ERROR: Session subscription for %s stopped after %d consecutive errors", sessionID, maxConsecutiveErrors)
					return
				}
				continue
			}

			// Reset consecutive error counter on success
			consecutiveErrors = 0

			var session SyncSession
			if err := snap.DataTo(&session); err != nil {
				log.Printf("ERROR: Failed to parse session data for %s: %v", sessionID, err)
				continue
			}
			session.ID = snap.Ref.ID

			callback(&session)
		}
	}()

	return nil
}

// Delete deletes a sync session
func (s *FirestoreSessionStore) Delete(ctx context.Context, sessionID string) error {
	_, err := s.client.Collection(getCollectionName(sessionsCollectionBase)).Doc(sessionID).Delete(ctx)
	return err
}

// FirestoreFileStore implements FileStore using Firestore
type FirestoreFileStore struct {
	client *firestore.Client
}

// NewFirestoreFileStore creates a new Firestore-backed file store
func NewFirestoreFileStore(client *firestore.Client) *FirestoreFileStore {
	return &FirestoreFileStore{client: client}
}

// Create creates a new sync file
func (f *FirestoreFileStore) Create(ctx context.Context, file *SyncFile) error {
	if file.ID == "" {
		return fmt.Errorf("file ID is required")
	}

	_, err := f.client.Collection(getCollectionName(filesCollectionBase)).Doc(file.ID).Set(ctx, file)
	return err
}

// Update updates an existing sync file
func (f *FirestoreFileStore) Update(ctx context.Context, file *SyncFile) error {
	if file.ID == "" {
		return fmt.Errorf("file ID is required")
	}

	_, err := f.client.Collection(getCollectionName(filesCollectionBase)).Doc(file.ID).Set(ctx, file)
	return err
}

// Get retrieves a sync file by ID
func (f *FirestoreFileStore) Get(ctx context.Context, fileID string) (*SyncFile, error) {
	doc, err := f.client.Collection(getCollectionName(filesCollectionBase)).Doc(fileID).Get(ctx)
	if err != nil {
		return nil, err
	}

	var file SyncFile
	if err := doc.DataTo(&file); err != nil {
		return nil, err
	}
	file.ID = doc.Ref.ID

	return &file, nil
}

// ListBySession retrieves all files for a session
func (f *FirestoreFileStore) ListBySession(ctx context.Context, sessionID string) ([]*SyncFile, error) {
	iter := f.client.Collection(getCollectionName(filesCollectionBase)).
		Where("sessionId", "==", sessionID).
		Documents(ctx)
	defer iter.Stop()

	var files []*SyncFile
	for {
		doc, err := iter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}

		var file SyncFile
		if err := doc.DataTo(&file); err != nil {
			return nil, err
		}
		file.ID = doc.Ref.ID

		files = append(files, &file)
	}

	return files, nil
}

// SubscribeBySession subscribes to real-time updates for all files in a session
func (f *FirestoreFileStore) SubscribeBySession(ctx context.Context, sessionID string, callback func(*SyncFile)) error {
	go func() {
		iter := f.client.Collection(getCollectionName(filesCollectionBase)).
			Where("sessionId", "==", sessionID).
			Snapshots(ctx)
		defer iter.Stop()

		consecutiveErrors := 0
		maxConsecutiveErrors := 5

		for {
			snap, err := iter.Next()
			if err == iterator.Done {
				log.Printf("INFO: File subscription for session %s completed normally", sessionID)
				return
			}
			if err != nil {
				consecutiveErrors++
				log.Printf("ERROR: File subscription error for session %s (consecutive: %d): %v", sessionID, consecutiveErrors, err)

				if consecutiveErrors >= maxConsecutiveErrors {
					log.Printf("ERROR: File subscription for session %s stopped after %d consecutive errors", sessionID, maxConsecutiveErrors)
					return
				}
				continue
			}

			// Reset consecutive error counter on success
			consecutiveErrors = 0

			for _, change := range snap.Changes {
				var file SyncFile
				if err := change.Doc.DataTo(&file); err != nil {
					log.Printf("ERROR: Failed to parse file data in session %s: %v", sessionID, err)
					continue
				}
				file.ID = change.Doc.Ref.ID

				callback(&file)
			}
		}
	}()

	return nil
}

// Delete deletes a sync file
func (f *FirestoreFileStore) Delete(ctx context.Context, fileID string) error {
	_, err := f.client.Collection(getCollectionName(filesCollectionBase)).Doc(fileID).Delete(ctx)
	return err
}
