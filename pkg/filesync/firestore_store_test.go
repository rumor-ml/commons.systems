package filesync

import (
	"context"
	"os"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
)

func getTestClient(t *testing.T) *firestore.Client {
	t.Helper()

	if os.Getenv("FIRESTORE_EMULATOR_HOST") == "" {
		t.Skip("FIRESTORE_EMULATOR_HOST not set, skipping integration test")
	}

	ctx := context.Background()
	client, err := firestore.NewClient(ctx, "test-project")
	if err != nil {
		t.Fatalf("failed to create firestore client: %v", err)
	}

	return client
}

func cleanupSession(t *testing.T, client *firestore.Client, sessionID string) {
	t.Helper()
	ctx := context.Background()
	_, _ = client.Collection(sessionsCollection).Doc(sessionID).Delete(ctx)
}

func cleanupFile(t *testing.T, client *firestore.Client, fileID string) {
	t.Helper()
	ctx := context.Background()
	_, _ = client.Collection(filesCollection).Doc(fileID).Delete(ctx)
}

func TestFirestoreSessionStore_Create(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	store := NewFirestoreSessionStore(client)
	ctx := context.Background()

	session := &SyncSession{
		ID:        "test-session-create",
		UserID:    "user-123",
		Status:    SessionStatusRunning,
		StartedAt: time.Now(),
		RootDir:   "/test/path",
		Stats:     SessionStats{Discovered: 10},
	}
	defer cleanupSession(t, client, session.ID)

	err := store.Create(ctx, session)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Verify it was created
	retrieved, err := store.Get(ctx, session.ID)
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}

	if retrieved.UserID != session.UserID {
		t.Errorf("expected UserID %s, got %s", session.UserID, retrieved.UserID)
	}
	if retrieved.Status != session.Status {
		t.Errorf("expected Status %s, got %s", session.Status, retrieved.Status)
	}
}

func TestFirestoreSessionStore_Update(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	store := NewFirestoreSessionStore(client)
	ctx := context.Background()

	session := &SyncSession{
		ID:        "test-session-update",
		UserID:    "user-123",
		Status:    SessionStatusRunning,
		StartedAt: time.Now(),
		RootDir:   "/test/path",
		Stats:     SessionStats{Discovered: 10},
	}
	defer cleanupSession(t, client, session.ID)

	// Create initial session
	err := store.Create(ctx, session)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Update session
	completedAt := time.Now()
	session.Status = SessionStatusCompleted
	session.CompletedAt = &completedAt
	session.Stats.Uploaded = 8

	err = store.Update(ctx, session)
	if err != nil {
		t.Fatalf("failed to update session: %v", err)
	}

	// Verify update
	retrieved, err := store.Get(ctx, session.ID)
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}

	if retrieved.Status != SessionStatusCompleted {
		t.Errorf("expected Status completed, got %s", retrieved.Status)
	}
	if retrieved.CompletedAt == nil {
		t.Error("expected CompletedAt to be set")
	}
	if retrieved.Stats.Uploaded != 8 {
		t.Errorf("expected Stats.Uploaded to be 8, got %d", retrieved.Stats.Uploaded)
	}
}

func TestFirestoreSessionStore_List(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	store := NewFirestoreSessionStore(client)
	ctx := context.Background()

	userID := "user-list-test"

	session1 := &SyncSession{
		ID:        "test-session-list-1",
		UserID:    userID,
		Status:    SessionStatusCompleted,
		StartedAt: time.Now().Add(-2 * time.Hour),
		RootDir:   "/test/path1",
		Stats:     SessionStats{Discovered: 5},
	}
	defer cleanupSession(t, client, session1.ID)

	session2 := &SyncSession{
		ID:        "test-session-list-2",
		UserID:    userID,
		Status:    SessionStatusRunning,
		StartedAt: time.Now().Add(-1 * time.Hour),
		RootDir:   "/test/path2",
		Stats:     SessionStats{Discovered: 10},
	}
	defer cleanupSession(t, client, session2.ID)

	// Create sessions
	if err := store.Create(ctx, session1); err != nil {
		t.Fatalf("failed to create session1: %v", err)
	}
	if err := store.Create(ctx, session2); err != nil {
		t.Fatalf("failed to create session2: %v", err)
	}

	// Give Firestore a moment to process
	time.Sleep(100 * time.Millisecond)

	// List sessions
	sessions, err := store.List(ctx, userID)
	if err != nil {
		t.Fatalf("failed to list sessions: %v", err)
	}

	if len(sessions) < 2 {
		t.Errorf("expected at least 2 sessions, got %d", len(sessions))
	}

	// Verify they're ordered by StartedAt descending (most recent first)
	// session2 should come before session1
	foundSession2First := false
	for i, s := range sessions {
		if s.ID == session2.ID {
			foundSession2First = true
			// Check if there's a next item and it's not session1 before this
			if i > 0 && sessions[i-1].ID == session1.ID {
				t.Error("sessions not ordered correctly, session1 should not come before session2")
			}
			break
		}
	}

	if !foundSession2First {
		t.Error("session2 not found in list")
	}
}

func TestFirestoreSessionStore_Delete(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	store := NewFirestoreSessionStore(client)
	ctx := context.Background()

	session := &SyncSession{
		ID:        "test-session-delete",
		UserID:    "user-123",
		Status:    SessionStatusRunning,
		StartedAt: time.Now(),
		RootDir:   "/test/path",
		Stats:     SessionStats{Discovered: 10},
	}

	// Create session
	err := store.Create(ctx, session)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Delete session
	err = store.Delete(ctx, session.ID)
	if err != nil {
		t.Fatalf("failed to delete session: %v", err)
	}

	// Verify it's gone
	_, err = store.Get(ctx, session.ID)
	if err == nil {
		t.Error("expected error when getting deleted session, got nil")
	}
}

func TestFirestoreFileStore_Create(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	store := NewFirestoreFileStore(client)
	ctx := context.Background()

	file := &SyncFile{
		ID:        "test-file-create",
		UserID:    "user-123",
		SessionID: "session-123",
		LocalPath: "/test/file.pdf",
		GCSPath:   "gs://bucket/file.pdf",
		Hash:      "hash123",
		Status:    FileStatusPending,
		Metadata:  FileMetadata{Title: "Test File"},
		UpdatedAt: time.Now(),
	}
	defer cleanupFile(t, client, file.ID)

	err := store.Create(ctx, file)
	if err != nil {
		t.Fatalf("failed to create file: %v", err)
	}

	// Verify it was created
	retrieved, err := store.Get(ctx, file.ID)
	if err != nil {
		t.Fatalf("failed to get file: %v", err)
	}

	if retrieved.UserID != file.UserID {
		t.Errorf("expected UserID %s, got %s", file.UserID, retrieved.UserID)
	}
	if retrieved.Status != file.Status {
		t.Errorf("expected Status %s, got %s", file.Status, retrieved.Status)
	}
}

func TestFirestoreFileStore_Update(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	store := NewFirestoreFileStore(client)
	ctx := context.Background()

	file := &SyncFile{
		ID:        "test-file-update",
		UserID:    "user-123",
		SessionID: "session-123",
		LocalPath: "/test/file.pdf",
		GCSPath:   "gs://bucket/file.pdf",
		Hash:      "hash123",
		Status:    FileStatusPending,
		Metadata:  FileMetadata{Title: "Test File"},
		UpdatedAt: time.Now(),
	}
	defer cleanupFile(t, client, file.ID)

	// Create file
	err := store.Create(ctx, file)
	if err != nil {
		t.Fatalf("failed to create file: %v", err)
	}

	// Update file
	file.Status = FileStatusUploaded
	file.Metadata.Author = "John Doe"
	file.UpdatedAt = time.Now()

	err = store.Update(ctx, file)
	if err != nil {
		t.Fatalf("failed to update file: %v", err)
	}

	// Verify update
	retrieved, err := store.Get(ctx, file.ID)
	if err != nil {
		t.Fatalf("failed to get file: %v", err)
	}

	if retrieved.Status != FileStatusUploaded {
		t.Errorf("expected Status uploaded, got %s", retrieved.Status)
	}
	if retrieved.Metadata.Author != "John Doe" {
		t.Errorf("expected Metadata.Author 'John Doe', got %s", retrieved.Metadata.Author)
	}
}

func TestFirestoreFileStore_ListBySession(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	store := NewFirestoreFileStore(client)
	ctx := context.Background()

	sessionID := "session-list-test"

	file1 := &SyncFile{
		ID:        "test-file-list-1",
		UserID:    "user-123",
		SessionID: sessionID,
		LocalPath: "/test/file1.pdf",
		Status:    FileStatusUploaded,
		UpdatedAt: time.Now(),
	}
	defer cleanupFile(t, client, file1.ID)

	file2 := &SyncFile{
		ID:        "test-file-list-2",
		UserID:    "user-123",
		SessionID: sessionID,
		LocalPath: "/test/file2.pdf",
		Status:    FileStatusPending,
		UpdatedAt: time.Now(),
	}
	defer cleanupFile(t, client, file2.ID)

	// Create files
	if err := store.Create(ctx, file1); err != nil {
		t.Fatalf("failed to create file1: %v", err)
	}
	if err := store.Create(ctx, file2); err != nil {
		t.Fatalf("failed to create file2: %v", err)
	}

	// Give Firestore a moment to process
	time.Sleep(100 * time.Millisecond)

	// List files
	files, err := store.ListBySession(ctx, sessionID)
	if err != nil {
		t.Fatalf("failed to list files: %v", err)
	}

	if len(files) < 2 {
		t.Errorf("expected at least 2 files, got %d", len(files))
	}
}

func TestFirestoreFileStore_Delete(t *testing.T) {
	client := getTestClient(t)
	defer client.Close()

	store := NewFirestoreFileStore(client)
	ctx := context.Background()

	file := &SyncFile{
		ID:        "test-file-delete",
		UserID:    "user-123",
		SessionID: "session-123",
		LocalPath: "/test/file.pdf",
		Status:    FileStatusPending,
		UpdatedAt: time.Now(),
	}

	// Create file
	err := store.Create(ctx, file)
	if err != nil {
		t.Fatalf("failed to create file: %v", err)
	}

	// Delete file
	err = store.Delete(ctx, file.ID)
	if err != nil {
		t.Fatalf("failed to delete file: %v", err)
	}

	// Verify it's gone
	_, err = store.Get(ctx, file.ID)
	if err == nil {
		t.Error("expected error when getting deleted file, got nil")
	}
}
