package streaming

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/commons-systems/filesync"
)

// Mock implementations for testing

// MockSessionStore implements filesync.SessionStore for testing
type MockSessionStore struct {
	subscribeError error
	onSubscribe    func(ctx context.Context, sessionID string, callback func(*filesync.SyncSession), errCallback func(error))
}

func (m *MockSessionStore) Create(ctx context.Context, session *filesync.SyncSession) error {
	return nil
}

func (m *MockSessionStore) Get(ctx context.Context, sessionID string) (*filesync.SyncSession, error) {
	return nil, nil
}

func (m *MockSessionStore) Update(ctx context.Context, session *filesync.SyncSession) error {
	return nil
}

func (m *MockSessionStore) List(ctx context.Context, userID string) ([]*filesync.SyncSession, error) {
	return nil, nil
}

func (m *MockSessionStore) Subscribe(ctx context.Context, sessionID string, callback func(*filesync.SyncSession), errCallback func(error)) error {
	if m.onSubscribe != nil {
		m.onSubscribe(ctx, sessionID, callback, errCallback)
	}
	return m.subscribeError
}

func (m *MockSessionStore) Delete(ctx context.Context, sessionID string) error {
	return nil
}

// MockFileStore implements filesync.FileStore for testing
type MockFileStore struct {
	subscribeError error
	onSubscribe    func(ctx context.Context, sessionID string, callback func(*filesync.SyncFile), errCallback func(error))
}

func (m *MockFileStore) Create(ctx context.Context, file *filesync.SyncFile) error {
	return nil
}

func (m *MockFileStore) Get(ctx context.Context, fileID string) (*filesync.SyncFile, error) {
	return nil, nil
}

func (m *MockFileStore) Update(ctx context.Context, file *filesync.SyncFile) error {
	return nil
}

func (m *MockFileStore) ListBySession(ctx context.Context, sessionID string) ([]*filesync.SyncFile, error) {
	return nil, nil
}

func (m *MockFileStore) SubscribeBySession(ctx context.Context, sessionID string, callback func(*filesync.SyncFile), errCallback func(error)) error {
	if m.onSubscribe != nil {
		m.onSubscribe(ctx, sessionID, callback, errCallback)
	}
	return m.subscribeError
}

func (m *MockFileStore) Delete(ctx context.Context, fileID string) error {
	return nil
}

// Test cases

func TestStreamMerger_Initialization(t *testing.T) {
	t.Run("success with valid stores", func(t *testing.T) {
		sessionStore := &MockSessionStore{}
		fileStore := &MockFileStore{}

		merger, err := NewStreamMerger(sessionStore, fileStore)
		if err != nil {
			t.Fatalf("expected no error, got %v", err)
		}
		if merger == nil {
			t.Fatal("expected non-nil merger")
		}
		if merger.sessionStore != sessionStore {
			t.Error("sessionStore not set correctly")
		}
		if merger.fileStore != fileStore {
			t.Error("fileStore not set correctly")
		}
		if merger.eventsCh == nil {
			t.Error("eventsCh not initialized")
		}
		if merger.done == nil {
			t.Error("done channel not initialized")
		}
	})

	t.Run("error when sessionStore is nil", func(t *testing.T) {
		fileStore := &MockFileStore{}

		merger, err := NewStreamMerger(nil, fileStore)
		if err == nil {
			t.Fatal("expected error for nil sessionStore")
		}
		if merger != nil {
			t.Error("expected nil merger on error")
		}
		if err.Error() != "sessionStore is required" {
			t.Errorf("unexpected error message: %v", err)
		}
	})

	t.Run("error when fileStore is nil", func(t *testing.T) {
		sessionStore := &MockSessionStore{}

		merger, err := NewStreamMerger(sessionStore, nil)
		if err == nil {
			t.Fatal("expected error for nil fileStore")
		}
		if merger != nil {
			t.Error("expected nil merger on error")
		}
		if err.Error() != "fileStore is required" {
			t.Errorf("unexpected error message: %v", err)
		}
	})
}

func TestStreamMerger_SessionSubscriptionError(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	sessionStore := &MockSessionStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncSession), errCallback func(error)) {
			// Simulate a subscription error after setup
			go func() {
				time.Sleep(50 * time.Millisecond)
				errCallback(errors.New("firestore connection failed"))
			}()
		},
	}
	fileStore := &MockFileStore{}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}
	defer merger.Stop()

	// Start subscription
	err = merger.StartSessionSubscription(ctx, "test-session-123")
	if err != nil {
		t.Fatalf("StartSessionSubscription returned error: %v", err)
	}

	// Wait for error callback to be invoked and error event to be sent
	select {
	case event := <-merger.Events():
		if event.EventType() != EventTypeError {
			t.Errorf("expected EventTypeError, got %s", event.EventType())
		}
		errorData, ok := event.Data().(ErrorEvent)
		if !ok {
			t.Fatal("event data is not ErrorEvent")
		}
		expectedMsg := "Session subscription error: firestore connection failed"
		if errorData.Message != expectedMsg {
			t.Errorf("expected message %q, got %q", expectedMsg, errorData.Message)
		}
		if errorData.Severity != "error" {
			t.Errorf("expected severity 'error', got %q", errorData.Severity)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout waiting for error event")
	}
}

func TestStreamMerger_FileSubscriptionError(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	sessionStore := &MockSessionStore{}
	fileStore := &MockFileStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncFile), errCallback func(error)) {
			// Simulate a subscription error
			go func() {
				time.Sleep(50 * time.Millisecond)
				errCallback(errors.New("file subscription quota exceeded"))
			}()
		},
	}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}
	defer merger.Stop()

	// Start subscription
	err = merger.StartFileSubscription(ctx, "test-session-123")
	if err != nil {
		t.Fatalf("StartFileSubscription returned error: %v", err)
	}

	// Wait for error event
	select {
	case event := <-merger.Events():
		if event.EventType() != EventTypeError {
			t.Errorf("expected EventTypeError, got %s", event.EventType())
		}
		errorData, ok := event.Data().(ErrorEvent)
		if !ok {
			t.Fatal("event data is not ErrorEvent")
		}
		expectedMsg := "File subscription error: file subscription quota exceeded"
		if errorData.Message != expectedMsg {
			t.Errorf("expected message %q, got %q", expectedMsg, errorData.Message)
		}
		if errorData.Severity != "error" {
			t.Errorf("expected severity 'error', got %q", errorData.Severity)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout waiting for error event")
	}
}

func TestStreamMerger_ErrorCallbackWithNilError(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	sessionStore := &MockSessionStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncSession), errCallback func(error)) {
			// Call error callback with nil - should be ignored
			go func() {
				time.Sleep(50 * time.Millisecond)
				errCallback(nil)
			}()
		},
	}
	fileStore := &MockFileStore{}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}
	defer merger.Stop()

	err = merger.StartSessionSubscription(ctx, "test-session-123")
	if err != nil {
		t.Fatalf("StartSessionSubscription returned error: %v", err)
	}

	// Should NOT receive an error event for nil error
	select {
	case event := <-merger.Events():
		t.Errorf("unexpected event received: %s", event.EventType())
	case <-time.After(200 * time.Millisecond):
		// Expected - no event should be sent for nil error
	}
}

func TestStreamMerger_SessionCallbackSuccess(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	testSession := &filesync.SyncSession{
		ID:     "test-session-123",
		Status: filesync.SessionStatusRunning,
		Stats: filesync.SessionStats{
			Discovered: 10,
			Extracted:  5,
		},
	}

	sessionStore := &MockSessionStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncSession), errCallback func(error)) {
			// Trigger the callback with a session update
			go func() {
				time.Sleep(50 * time.Millisecond)
				callback(testSession)
			}()
		},
	}
	fileStore := &MockFileStore{}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}
	defer merger.Stop()

	err = merger.StartSessionSubscription(ctx, "test-session-123")
	if err != nil {
		t.Fatalf("StartSessionSubscription returned error: %v", err)
	}

	// Should receive session event
	select {
	case event := <-merger.Events():
		if event.EventType() != EventTypeSession {
			t.Errorf("expected EventTypeSession, got %s", event.EventType())
		}
		sessionData, ok := event.Data().(SessionEvent)
		if !ok {
			t.Fatal("event data is not SessionEvent")
		}
		if sessionData.ID != testSession.ID {
			t.Errorf("expected session ID %s, got %s", testSession.ID, sessionData.ID)
		}
		if sessionData.Status != testSession.Status {
			t.Errorf("expected status %s, got %s", testSession.Status, sessionData.Status)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout waiting for session event")
	}

	// Should also receive actions event
	select {
	case event := <-merger.Events():
		if event.EventType() != EventTypeActions {
			t.Errorf("expected EventTypeActions, got %s", event.EventType())
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout waiting for actions event")
	}
}

func TestStreamMerger_SessionCompletionEvent(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	completedSession := &filesync.SyncSession{
		ID:     "test-session-456",
		Status: filesync.SessionStatusCompleted,
		Stats: filesync.SessionStats{
			Discovered: 10,
			Extracted:  10,
		},
	}

	sessionStore := &MockSessionStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncSession), errCallback func(error)) {
			go func() {
				time.Sleep(50 * time.Millisecond)
				callback(completedSession)
			}()
		},
	}
	fileStore := &MockFileStore{}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}
	defer merger.Stop()

	err = merger.StartSessionSubscription(ctx, "test-session-456")
	if err != nil {
		t.Fatalf("StartSessionSubscription returned error: %v", err)
	}

	// Collect events - should get session, actions, and complete
	events := []SSEEvent{}
	timeout := time.After(1 * time.Second)
	for len(events) < 3 {
		select {
		case event := <-merger.Events():
			events = append(events, event)
		case <-timeout:
			t.Fatalf("timeout waiting for events, got %d events", len(events))
		}
	}

	// Verify we got all three event types
	eventTypes := make(map[string]bool)
	for _, event := range events {
		eventTypes[event.EventType()] = true
	}

	if !eventTypes[EventTypeSession] {
		t.Error("missing EventTypeSession")
	}
	if !eventTypes[EventTypeActions] {
		t.Error("missing EventTypeActions")
	}
	if !eventTypes[EventTypeComplete] {
		t.Error("missing EventTypeComplete")
	}

	// Find and verify complete event
	var completeEvent SSEEvent
	for _, event := range events {
		if event.EventType() == EventTypeComplete {
			completeEvent = event
			break
		}
	}

	completeData, ok := completeEvent.Data().(CompleteEvent)
	if !ok {
		t.Fatal("complete event data is not CompleteEvent")
	}
	if completeData.SessionID != completedSession.ID {
		t.Errorf("expected session ID %s, got %s", completedSession.ID, completeData.SessionID)
	}
	if completeData.Status != completedSession.Status {
		t.Errorf("expected status %s, got %s", completedSession.Status, completeData.Status)
	}
}

func TestStreamMerger_ProgressForwarder(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	sessionStore := &MockSessionStore{}
	fileStore := &MockFileStore{}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}
	defer merger.Stop()

	// Create a progress channel and start forwarder
	progressCh := make(chan filesync.Progress, 10)
	merger.StartProgressForwarder(ctx, progressCh)

	// Send progress update
	progressCh <- filesync.Progress{
		Type:       filesync.ProgressTypeOperation,
		Operation:  "extracting",
		File:       "test.pdf",
		Percentage: 50.0,
	}

	// Should receive progress event
	select {
	case event := <-merger.Events():
		if event.EventType() != EventTypeProgress {
			t.Errorf("expected EventTypeProgress, got %s", event.EventType())
		}
		progressData, ok := event.Data().(ProgressEvent)
		if !ok {
			t.Fatal("event data is not ProgressEvent")
		}
		if progressData.Operation != "extracting" {
			t.Errorf("expected operation 'extracting', got %q", progressData.Operation)
		}
		if progressData.File != "test.pdf" {
			t.Errorf("expected file 'test.pdf', got %q", progressData.File)
		}
		if progressData.Percentage != 50.0 {
			t.Errorf("expected percentage 50.0, got %f", progressData.Percentage)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout waiting for progress event")
	}
}

func TestStreamMerger_StopGracefully(t *testing.T) {
	sessionStore := &MockSessionStore{}
	fileStore := &MockFileStore{}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}

	// Verify initial state
	if merger.stopped {
		t.Error("merger should not be stopped initially")
	}

	// Stop the merger
	merger.Stop()

	// Verify stopped state
	if !merger.stopped {
		t.Error("merger should be stopped after Stop()")
	}

	// Verify done channel is closed
	select {
	case <-merger.done:
		// Expected - done channel should be closed
	default:
		t.Error("done channel should be closed after Stop()")
	}

	// Calling Stop() again should be safe (idempotent)
	merger.Stop()

	// Verify still stopped
	if !merger.stopped {
		t.Error("merger should still be stopped after second Stop()")
	}
}

func TestStreamMerger_StopStopsForwarder(t *testing.T) {
	ctx := context.Background()

	sessionStore := &MockSessionStore{}
	fileStore := &MockFileStore{}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}

	// Create a progress channel and start forwarder
	progressCh := make(chan filesync.Progress, 10)
	merger.StartProgressForwarder(ctx, progressCh)

	// Send a progress update to verify forwarder is running
	progressCh <- filesync.Progress{
		Type:      filesync.ProgressTypeOperation,
		Operation: "test",
	}

	// Consume the event
	select {
	case <-merger.Events():
		// Got event, forwarder is running
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout waiting for initial event")
	}

	// Stop the merger
	merger.Stop()

	// Send another progress update
	progressCh <- filesync.Progress{
		Type:      filesync.ProgressTypeOperation,
		Operation: "after-stop",
	}

	// Should NOT receive event after stop (forwarder should have stopped)
	select {
	case event := <-merger.Events():
		t.Errorf("received unexpected event after Stop(): %s", event.EventType())
	case <-time.After(200 * time.Millisecond):
		// Expected - no event after stop
	}
}

func TestStreamMerger_FileCallbackSuccess(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	testFile := &filesync.SyncFile{
		ID:        "file-123",
		SessionID: "session-123",
		LocalPath: "/test/path/file.pdf",
		Status:    filesync.FileStatusExtracted,
	}

	sessionStore := &MockSessionStore{}
	fileStore := &MockFileStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncFile), errCallback func(error)) {
			go func() {
				time.Sleep(50 * time.Millisecond)
				callback(testFile)
			}()
		},
	}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}
	defer merger.Stop()

	err = merger.StartFileSubscription(ctx, "session-123")
	if err != nil {
		t.Fatalf("StartFileSubscription returned error: %v", err)
	}

	// Should receive file event
	select {
	case event := <-merger.Events():
		if event.EventType() != EventTypeFile {
			t.Errorf("expected EventTypeFile, got %s", event.EventType())
		}
		fileData, ok := event.Data().(FileEvent)
		if !ok {
			t.Fatal("event data is not FileEvent")
		}
		if fileData.ID != testFile.ID {
			t.Errorf("expected file ID %s, got %s", testFile.ID, fileData.ID)
		}
		if fileData.LocalPath != testFile.LocalPath {
			t.Errorf("expected local path %s, got %s", testFile.LocalPath, fileData.LocalPath)
		}
		if fileData.Status != testFile.Status {
			t.Errorf("expected status %s, got %s", testFile.Status, fileData.Status)
		}
		if !fileData.IsUpdate {
			t.Error("expected IsUpdate to be true for subscription updates")
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout waiting for file event")
	}
}

func TestStreamMerger_CallbackWithNilData(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	sessionStore := &MockSessionStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncSession), errCallback func(error)) {
			// Call callback with nil - should be ignored
			go func() {
				time.Sleep(50 * time.Millisecond)
				callback(nil)
			}()
		},
	}
	fileStore := &MockFileStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncFile), errCallback func(error)) {
			// Call callback with nil - should be ignored
			go func() {
				time.Sleep(50 * time.Millisecond)
				callback(nil)
			}()
		},
	}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}
	defer merger.Stop()

	err = merger.StartSessionSubscription(ctx, "test-session")
	if err != nil {
		t.Fatalf("StartSessionSubscription returned error: %v", err)
	}

	err = merger.StartFileSubscription(ctx, "test-session")
	if err != nil {
		t.Fatalf("StartFileSubscription returned error: %v", err)
	}

	// Should NOT receive any events for nil callbacks
	select {
	case event := <-merger.Events():
		t.Errorf("unexpected event received for nil callback: %s", event.EventType())
	case <-time.After(200 * time.Millisecond):
		// Expected - no events for nil data
	}
}

func TestStreamMerger_ConcurrentStop(t *testing.T) {
	sessionStore := &MockSessionStore{}
	fileStore := &MockFileStore{}
	merger, _ := NewStreamMerger(sessionStore, fileStore)

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			merger.Stop()
		}()
	}

	wg.Wait()
	// Success if no panic/race
}

// TestStreamMerger_PropagatesSubscriptionErrors tests that errors flow from Firestore to merger events
func TestStreamMerger_PropagatesSubscriptionErrors(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// Create mock session store that triggers error callback
	sessionStore := &MockSessionStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncSession), errCallback func(error)) {
			// Simulate subscription error
			go func() {
				time.Sleep(50 * time.Millisecond)
				errCallback(errors.New("firestore subscription quota exceeded"))
			}()
		},
	}
	fileStore := &MockFileStore{}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}
	defer merger.Stop()

	// Start session subscription
	err = merger.StartSessionSubscription(ctx, "test-session-456")
	if err != nil {
		t.Fatalf("StartSessionSubscription returned error: %v", err)
	}

	// Wait for error to propagate
	select {
	case event := <-merger.Events():
		// Verify error event received
		if event.EventType() != EventTypeError {
			t.Errorf("expected EventTypeError, got %s", event.EventType())
		}

		errorData, ok := event.Data().(ErrorEvent)
		if !ok {
			t.Fatal("event data is not ErrorEvent")
		}

		// Verify error includes subscription context
		if errorData.Message != "Session subscription error: firestore subscription quota exceeded" {
			t.Errorf("unexpected error message: %s", errorData.Message)
		}
		if errorData.Severity != "error" {
			t.Errorf("expected severity 'error', got %s", errorData.Severity)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout waiting for error event")
	}
}

// TestStreamMerger_FileSubscriptionErrorPropagation tests file subscription error propagation
func TestStreamMerger_FileSubscriptionErrorPropagation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	sessionStore := &MockSessionStore{}
	// Create mock file store that triggers error callback
	fileStore := &MockFileStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncFile), errCallback func(error)) {
			// Simulate subscription error
			go func() {
				time.Sleep(50 * time.Millisecond)
				errCallback(errors.New("firestore file query limit exceeded"))
			}()
		},
	}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}
	defer merger.Stop()

	// Start file subscription
	err = merger.StartFileSubscription(ctx, "test-session-789")
	if err != nil {
		t.Fatalf("StartFileSubscription returned error: %v", err)
	}

	// Wait for error to propagate
	select {
	case event := <-merger.Events():
		// Verify error event received
		if event.EventType() != EventTypeError {
			t.Errorf("expected EventTypeError, got %s", event.EventType())
		}

		errorData, ok := event.Data().(ErrorEvent)
		if !ok {
			t.Fatal("event data is not ErrorEvent")
		}

		// Verify error includes file subscription context
		if errorData.Message != "File subscription error: firestore file query limit exceeded" {
			t.Errorf("unexpected error message: %s", errorData.Message)
		}
		if errorData.Severity != "error" {
			t.Errorf("expected severity 'error', got %s", errorData.Severity)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timeout waiting for error event")
	}
}

// TestStreamMerger_ErrorDeduplication tests that duplicate errors are not sent twice
func TestStreamMerger_ErrorDeduplication(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// Track how many times errCallback is invoked
	callCount := 0
	var mu sync.Mutex

	// Create mock session store that triggers error callback multiple times
	sessionStore := &MockSessionStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncSession), errCallback func(error)) {
			// Simulate multiple errors in rapid succession
			go func() {
				for i := 0; i < 5; i++ {
					time.Sleep(20 * time.Millisecond)
					mu.Lock()
					callCount++
					mu.Unlock()
					errCallback(errors.New("repeated firestore error"))
				}
			}()
		},
	}
	fileStore := &MockFileStore{}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}
	defer merger.Stop()

	// Start session subscription
	err = merger.StartSessionSubscription(ctx, "test-session-dedup")
	if err != nil {
		t.Fatalf("StartSessionSubscription returned error: %v", err)
	}

	// Collect all error events
	var errorEvents []SSEEvent
	timeout := time.After(500 * time.Millisecond)

collectLoop:
	for {
		select {
		case event := <-merger.Events():
			if event.EventType() == EventTypeError {
				errorEvents = append(errorEvents, event)
			}
		case <-timeout:
			break collectLoop
		}
	}

	// Verify error callback was invoked multiple times
	mu.Lock()
	actualCallCount := callCount
	mu.Unlock()

	if actualCallCount < 2 {
		t.Logf("Warning: expected multiple error callbacks, got %d", actualCallCount)
	}

	// Verify only ONE error event was sent (deduplication working)
	if len(errorEvents) != 1 {
		t.Errorf("expected exactly 1 error event due to deduplication, got %d", len(errorEvents))
	}

	// Verify the error event has correct content
	if len(errorEvents) > 0 {
		errorData, ok := errorEvents[0].Data().(ErrorEvent)
		if !ok {
			t.Fatal("event data is not ErrorEvent")
		}
		if errorData.Message != "Session subscription error: repeated firestore error" {
			t.Errorf("unexpected error message: %s", errorData.Message)
		}
	}

	t.Logf("Error callback invoked %d times, but only 1 error event sent (deduplication working)", actualCallCount)
}

// TestStreamMerger_ErrorDeduplicationSeparateSubscriptions tests deduplication works separately for session and file subscriptions
func TestStreamMerger_ErrorDeduplicationSeparateSubscriptions(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// Create mocks that both trigger errors
	sessionStore := &MockSessionStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncSession), errCallback func(error)) {
			go func() {
				time.Sleep(50 * time.Millisecond)
				errCallback(errors.New("session error"))
				time.Sleep(50 * time.Millisecond)
				errCallback(errors.New("session error duplicate"))
			}()
		},
	}
	fileStore := &MockFileStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncFile), errCallback func(error)) {
			go func() {
				time.Sleep(50 * time.Millisecond)
				errCallback(errors.New("file error"))
				time.Sleep(50 * time.Millisecond)
				errCallback(errors.New("file error duplicate"))
			}()
		},
	}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}
	defer merger.Stop()

	// Start both subscriptions
	err = merger.StartSessionSubscription(ctx, "test-session")
	if err != nil {
		t.Fatalf("StartSessionSubscription returned error: %v", err)
	}

	err = merger.StartFileSubscription(ctx, "test-session")
	if err != nil {
		t.Fatalf("StartFileSubscription returned error: %v", err)
	}

	// Collect error events
	var errorEvents []SSEEvent
	timeout := time.After(1 * time.Second)

collectLoop:
	for len(errorEvents) < 2 {
		select {
		case event := <-merger.Events():
			if event.EventType() == EventTypeError {
				errorEvents = append(errorEvents, event)
			}
		case <-timeout:
			break collectLoop
		}
	}

	// Verify we got exactly 2 error events (one for session, one for file)
	if len(errorEvents) != 2 {
		t.Errorf("expected exactly 2 error events (one per subscription type), got %d", len(errorEvents))
	}

	// Verify error messages are different
	if len(errorEvents) == 2 {
		msg1 := errorEvents[0].Data().(ErrorEvent).Message
		msg2 := errorEvents[1].Data().(ErrorEvent).Message

		if msg1 == msg2 {
			t.Error("expected different error messages for session and file subscriptions")
		}

		// One should be about session, one about file
		hasSessionError := false
		hasFileError := false
		for _, event := range errorEvents {
			msg := event.Data().(ErrorEvent).Message
			if msg == "Session subscription error: session error" {
				hasSessionError = true
			}
			if msg == "File subscription error: file error" {
				hasFileError = true
			}
		}

		if !hasSessionError || !hasFileError {
			t.Error("expected one session error and one file error")
		}
	}

	t.Log("Verified deduplication works separately for session and file subscriptions")
}

// TestStreamMerger_ErrorAfterStop tests that errors are handled gracefully after merger is stopped
func TestStreamMerger_ErrorAfterStop(t *testing.T) {
	ctx := context.Background()

	// Create mock that triggers error after a longer delay
	sessionStore := &MockSessionStore{
		onSubscribe: func(ctx context.Context, sessionID string, callback func(*filesync.SyncSession), errCallback func(error)) {
			go func() {
				time.Sleep(500 * time.Millisecond)
				errCallback(errors.New("late error"))
			}()
		},
	}
	fileStore := &MockFileStore{}

	merger, err := NewStreamMerger(sessionStore, fileStore)
	if err != nil {
		t.Fatalf("failed to create merger: %v", err)
	}

	// Start subscription
	err = merger.StartSessionSubscription(ctx, "test-session")
	if err != nil {
		t.Fatalf("StartSessionSubscription returned error: %v", err)
	}

	// Wait a bit then stop merger before error is triggered
	time.Sleep(100 * time.Millisecond)
	merger.Stop()

	// Wait for error to be triggered (after stop)
	time.Sleep(500 * time.Millisecond)

	// After Stop(), the Events() channel is closed, so we can't receive from it
	// The error callback will be invoked but won't send to the closed channel
	// This is expected behavior - the test verifies no panic occurs

	t.Log("Verified merger handles late errors gracefully after stop")
}
