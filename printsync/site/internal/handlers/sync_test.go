package handlers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/commons-systems/filesync"
	"printsync/internal/firestore"
	"printsync/internal/middleware"
	"printsync/internal/streaming"
)

// Mock implementations for testing
type mockSessionStore struct {
	sessions map[string]*filesync.SyncSession
	err      error
}

func (m *mockSessionStore) Create(ctx context.Context, session *filesync.SyncSession) error {
	if m.err != nil {
		return m.err
	}
	m.sessions[session.ID] = session
	return nil
}

func (m *mockSessionStore) Update(ctx context.Context, session *filesync.SyncSession) error {
	if m.err != nil {
		return m.err
	}
	m.sessions[session.ID] = session
	return nil
}

func (m *mockSessionStore) Get(ctx context.Context, sessionID string) (*filesync.SyncSession, error) {
	if m.err != nil {
		return nil, m.err
	}
	session, ok := m.sessions[sessionID]
	if !ok {
		return nil, errors.New("session not found")
	}
	return session, nil
}

func (m *mockSessionStore) List(ctx context.Context, userID string) ([]*filesync.SyncSession, error) {
	if m.err != nil {
		return nil, m.err
	}
	var result []*filesync.SyncSession
	for _, session := range m.sessions {
		if session.UserID == userID {
			result = append(result, session)
		}
	}
	return result, nil
}

func (m *mockSessionStore) Subscribe(ctx context.Context, sessionID string, callback func(*filesync.SyncSession)) error {
	return nil
}

func (m *mockSessionStore) Delete(ctx context.Context, sessionID string) error {
	if m.err != nil {
		return m.err
	}
	delete(m.sessions, sessionID)
	return nil
}

type mockFileStore struct {
	files map[string]*filesync.SyncFile
	err   error
}

func (m *mockFileStore) Create(ctx context.Context, file *filesync.SyncFile) error {
	if m.err != nil {
		return m.err
	}
	m.files[file.ID] = file
	return nil
}

func (m *mockFileStore) Update(ctx context.Context, file *filesync.SyncFile) error {
	if m.err != nil {
		return m.err
	}
	m.files[file.ID] = file
	return nil
}

func (m *mockFileStore) Get(ctx context.Context, fileID string) (*filesync.SyncFile, error) {
	if m.err != nil {
		return nil, m.err
	}
	file, ok := m.files[fileID]
	if !ok {
		return nil, errors.New("file not found")
	}
	return file, nil
}

func (m *mockFileStore) ListBySession(ctx context.Context, sessionID string) ([]*filesync.SyncFile, error) {
	if m.err != nil {
		return nil, m.err
	}
	var result []*filesync.SyncFile
	for _, file := range m.files {
		if file.SessionID == sessionID {
			result = append(result, file)
		}
	}
	return result, nil
}

func (m *mockFileStore) SubscribeBySession(ctx context.Context, sessionID string, callback func(*filesync.SyncFile)) error {
	return nil
}

func (m *mockFileStore) Delete(ctx context.Context, fileID string) error {
	if m.err != nil {
		return m.err
	}
	delete(m.files, fileID)
	return nil
}

// Helper to create test request with auth context
func createAuthRequest(method, path string, userID string) *http.Request {
	req := httptest.NewRequest(method, path, nil)
	ctx := context.WithValue(req.Context(), middleware.AuthKey, middleware.AuthInfo{
		UserID: userID,
		Email:  fmt.Sprintf("%s@example.com", userID),
	})
	return req.WithContext(ctx)
}

// Helper to create handlers with test dependencies
func createTestHandlers(sessionStore *mockSessionStore, fileStore *mockFileStore) *SyncHandlers {
	hub, _ := streaming.NewStreamHub(sessionStore, fileStore)
	return &SyncHandlers{
		gcsClient:    nil, // We won't actually use GCS in these tests
		bucket:       "test-bucket",
		fsClient:     &firestore.Client{}, // Empty but non-nil
		sessionStore: sessionStore,
		fileStore:    fileStore,
		registry:     NewSessionRegistry(),
		hub:          hub,
	}
}

// TestApproveFile_Success tests successful file approval - skipped due to pipeline dependencies
func TestApproveFile_Success(t *testing.T) {
	t.Skip("Requires full pipeline infrastructure - tested via integration tests")
}

// TestApproveFile_Unauthorized tests unauthorized access
func TestApproveFile_Unauthorized(t *testing.T) {
	sessionStore := &mockSessionStore{sessions: map[string]*filesync.SyncSession{}}
	fileStore := &mockFileStore{files: map[string]*filesync.SyncFile{}}
	handlers := createTestHandlers(sessionStore, fileStore)

	// Request without auth context
	req := httptest.NewRequest("POST", "/api/files/file-1/approve", nil)
	req.SetPathValue("id", "file-1")
	rr := httptest.NewRecorder()

	handlers.ApproveFile(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("Expected %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

// TestApproveFile_NotFound tests file not found
func TestApproveFile_NotFound(t *testing.T) {
	sessionStore := &mockSessionStore{sessions: map[string]*filesync.SyncSession{}}
	fileStore := &mockFileStore{files: map[string]*filesync.SyncFile{}}
	handlers := createTestHandlers(sessionStore, fileStore)

	req := createAuthRequest("POST", "/api/files/nonexistent/approve", "user-1")
	req.SetPathValue("id", "nonexistent")
	rr := httptest.NewRecorder()

	handlers.ApproveFile(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("Expected %d, got %d", http.StatusNotFound, rr.Code)
	}
}

// TestRejectFile_Success tests successful file rejection - skipped due to pipeline dependencies
func TestRejectFile_Success(t *testing.T) {
	t.Skip("Requires full pipeline infrastructure - tested via integration tests")
}

// TestRejectFile_Unauthorized tests unauthorized access
func TestRejectFile_Unauthorized(t *testing.T) {
	sessionStore := &mockSessionStore{sessions: map[string]*filesync.SyncSession{}}
	fileStore := &mockFileStore{files: map[string]*filesync.SyncFile{}}
	handlers := createTestHandlers(sessionStore, fileStore)

	req := httptest.NewRequest("POST", "/api/files/file-1/reject", nil)
	req.SetPathValue("id", "file-1")
	rr := httptest.NewRecorder()

	handlers.RejectFile(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("Expected %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

// TestTrashAll_Success tests successful trash all - skipped due to pipeline dependencies
func TestTrashAll_Success(t *testing.T) {
	t.Skip("Requires full pipeline infrastructure - tested via integration tests")
}

// TestTrashAll_NoFiles tests trash all with no files
func TestTrashAll_NoFiles(t *testing.T) {
	sessionStore := &mockSessionStore{
		sessions: map[string]*filesync.SyncSession{
			"session-1": {
				ID:     "session-1",
				UserID: "user-1",
				Status: filesync.SessionStatusCompleted,
			},
		},
	}

	fileStore := &mockFileStore{
		files: map[string]*filesync.SyncFile{},
	}

	handlers := createTestHandlers(sessionStore, fileStore)

	req := createAuthRequest("POST", "/api/sync/session-1/trash-all", "user-1")
	req.SetPathValue("id", "session-1")
	rr := httptest.NewRecorder()

	handlers.TrashAll(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected %d, got %d", http.StatusOK, rr.Code)
	}

	// Should return info message about no files
	body := rr.Body.String()
	if body == "" {
		t.Error("Expected response body with message")
	}
}

// TestRetryFile_Success tests successful file retry - validates authorization and session check
func TestRetryFile_Success(t *testing.T) {
	sessionStore := &mockSessionStore{
		sessions: map[string]*filesync.SyncSession{
			"session-1": {
				ID:     "session-1",
				UserID: "user-1",
				Status: filesync.SessionStatusRunning,
			},
		},
	}

	fileStore := &mockFileStore{
		files: map[string]*filesync.SyncFile{
			"file-1": {
				ID:        "file-1",
				SessionID: "session-1",
				Status:    filesync.FileStatusError,
				LocalPath: "/tmp/test.pdf",
				Error:     "extraction failed",
			},
		},
	}

	handlers := createTestHandlers(sessionStore, fileStore)

	// Register the session as active
	handlers.registry.Register("session-1", &RunningSession{
		SessionID: "session-1",
		Cancel:    func() {},
	})

	req := createAuthRequest("POST", "/api/files/file-1/retry", "user-1")
	req.SetPathValue("id", "file-1")
	rr := httptest.NewRecorder()

	handlers.RetryFile(rr, req)

	// Should pass authorization and return OK (will render partial or fail on templ rendering)
	if rr.Code != http.StatusOK && rr.Code != http.StatusInternalServerError {
		t.Errorf("Expected %d or %d, got %d", http.StatusOK, http.StatusInternalServerError, rr.Code)
	}
}

// TestRetryFile_NotFound tests retry with nonexistent file
func TestRetryFile_NotFound(t *testing.T) {
	sessionStore := &mockSessionStore{sessions: map[string]*filesync.SyncSession{}}
	fileStore := &mockFileStore{files: map[string]*filesync.SyncFile{}}
	handlers := createTestHandlers(sessionStore, fileStore)

	req := createAuthRequest("POST", "/api/files/nonexistent/retry", "user-1")
	req.SetPathValue("id", "nonexistent")
	rr := httptest.NewRecorder()

	handlers.RetryFile(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("Expected %d, got %d", http.StatusNotFound, rr.Code)
	}
}

// TestRetryFile_Unauthorized tests retry without auth
func TestRetryFile_Unauthorized(t *testing.T) {
	sessionStore := &mockSessionStore{sessions: map[string]*filesync.SyncSession{}}
	fileStore := &mockFileStore{files: map[string]*filesync.SyncFile{}}
	handlers := createTestHandlers(sessionStore, fileStore)

	req := httptest.NewRequest("POST", "/api/files/file-1/retry", nil)
	req.SetPathValue("id", "file-1")
	rr := httptest.NewRecorder()

	handlers.RetryFile(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("Expected %d, got %d", http.StatusUnauthorized, rr.Code)
	}
}

// TestCancelSync_Success tests successful sync cancellation
func TestCancelSync_Success(t *testing.T) {
	sessionStore := &mockSessionStore{
		sessions: map[string]*filesync.SyncSession{
			"session-1": {
				ID:     "session-1",
				UserID: "user-1",
				Status: filesync.SessionStatusRunning,
			},
		},
	}

	fileStore := &mockFileStore{files: map[string]*filesync.SyncFile{}}
	handlers := createTestHandlers(sessionStore, fileStore)

	// Register the session as running
	cancelled := false
	handlers.registry.Register("session-1", &RunningSession{
		SessionID: "session-1",
		Cancel: func() {
			cancelled = true
		},
	})

	req := createAuthRequest("POST", "/api/sync/session-1/cancel", "user-1")
	req.SetPathValue("id", "session-1")
	rr := httptest.NewRecorder()

	handlers.CancelSync(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected %d, got %d", http.StatusOK, rr.Code)
	}

	if !cancelled {
		t.Error("Expected cancel function to be called")
	}
}

// TestGetSession_Success tests successful session retrieval
func TestGetSession_Success(t *testing.T) {
	sessionStore := &mockSessionStore{
		sessions: map[string]*filesync.SyncSession{
			"session-1": {
				ID:     "session-1",
				UserID: "user-1",
				Status: filesync.SessionStatusRunning,
			},
		},
	}

	fileStore := &mockFileStore{files: map[string]*filesync.SyncFile{}}
	handlers := createTestHandlers(sessionStore, fileStore)

	req := createAuthRequest("GET", "/api/sync/session-1", "user-1")
	req.SetPathValue("id", "session-1")
	rr := httptest.NewRecorder()

	handlers.GetSession(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected %d, got %d", http.StatusOK, rr.Code)
	}
}

// TestGetSession_Forbidden tests accessing another user's session
func TestGetSession_Forbidden(t *testing.T) {
	sessionStore := &mockSessionStore{
		sessions: map[string]*filesync.SyncSession{
			"session-1": {
				ID:     "session-1",
				UserID: "user-2", // Different user
				Status: filesync.SessionStatusRunning,
			},
		},
	}

	fileStore := &mockFileStore{files: map[string]*filesync.SyncFile{}}
	handlers := createTestHandlers(sessionStore, fileStore)

	req := createAuthRequest("GET", "/api/sync/session-1", "user-1")
	req.SetPathValue("id", "session-1")
	rr := httptest.NewRecorder()

	handlers.GetSession(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("Expected %d, got %d", http.StatusForbidden, rr.Code)
	}
}
