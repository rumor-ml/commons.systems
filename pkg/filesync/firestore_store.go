package filesync

import (
	"context"
	"fmt"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

const (
	sessionsCollection = "printsync-sessions"
	filesCollection    = "printsync-files"
)

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

	_, err := s.client.Collection(sessionsCollection).Doc(session.ID).Set(ctx, session)
	return err
}

// Update updates an existing sync session
func (s *FirestoreSessionStore) Update(ctx context.Context, session *SyncSession) error {
	if session.ID == "" {
		return fmt.Errorf("session ID is required")
	}

	_, err := s.client.Collection(sessionsCollection).Doc(session.ID).Set(ctx, session)
	return err
}

// Get retrieves a sync session by ID
func (s *FirestoreSessionStore) Get(ctx context.Context, sessionID string) (*SyncSession, error) {
	doc, err := s.client.Collection(sessionsCollection).Doc(sessionID).Get(ctx)
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
	iter := s.client.Collection(sessionsCollection).
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
		iter := s.client.Collection(sessionsCollection).Doc(sessionID).Snapshots(ctx)
		defer iter.Stop()

		for {
			snap, err := iter.Next()
			if err == iterator.Done {
				return
			}
			if err != nil {
				// Log error but continue listening
				continue
			}

			var session SyncSession
			if err := snap.DataTo(&session); err != nil {
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
	_, err := s.client.Collection(sessionsCollection).Doc(sessionID).Delete(ctx)
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

	_, err := f.client.Collection(filesCollection).Doc(file.ID).Set(ctx, file)
	return err
}

// Update updates an existing sync file
func (f *FirestoreFileStore) Update(ctx context.Context, file *SyncFile) error {
	if file.ID == "" {
		return fmt.Errorf("file ID is required")
	}

	_, err := f.client.Collection(filesCollection).Doc(file.ID).Set(ctx, file)
	return err
}

// Get retrieves a sync file by ID
func (f *FirestoreFileStore) Get(ctx context.Context, fileID string) (*SyncFile, error) {
	doc, err := f.client.Collection(filesCollection).Doc(fileID).Get(ctx)
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
	iter := f.client.Collection(filesCollection).
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
		iter := f.client.Collection(filesCollection).
			Where("sessionId", "==", sessionID).
			Snapshots(ctx)
		defer iter.Stop()

		for {
			snap, err := iter.Next()
			if err == iterator.Done {
				return
			}
			if err != nil {
				// Log error but continue listening
				continue
			}

			for _, change := range snap.Changes {
				var file SyncFile
				if err := change.Doc.DataTo(&file); err != nil {
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
	_, err := f.client.Collection(filesCollection).Doc(fileID).Delete(ctx)
	return err
}
