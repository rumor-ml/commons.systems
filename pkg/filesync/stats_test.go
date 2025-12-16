package filesync

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// mockSessionStore for stats tests
type mockSessionStoreForStats struct {
	sessions         map[string]*SyncSession
	mu               sync.Mutex
	updateCalled     int
	updateShouldFail bool
}

func (m *mockSessionStoreForStats) Create(ctx context.Context, session *SyncSession) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[session.ID] = session
	return nil
}

func (m *mockSessionStoreForStats) Update(ctx context.Context, session *SyncSession) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.updateCalled++
	if m.updateShouldFail {
		return errors.New("update failed")
	}
	m.sessions[session.ID] = session
	return nil
}

func (m *mockSessionStoreForStats) Get(ctx context.Context, sessionID string) (*SyncSession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, exists := m.sessions[sessionID]
	if !exists {
		return nil, errors.New("session not found")
	}
	return session, nil
}

func (m *mockSessionStoreForStats) List(ctx context.Context, userID string) ([]*SyncSession, error) {
	return nil, nil
}

func (m *mockSessionStoreForStats) Delete(ctx context.Context, sessionID string) error {
	return nil
}

func (m *mockSessionStoreForStats) Subscribe(ctx context.Context, sessionID string, callback func(*SyncSession), errCallback func(error)) error {
	return nil
}

func TestNewStatsAccumulator_Validation(t *testing.T) {
	session := &SyncSession{
		ID:     "test-session",
		UserID: "user-123",
		Stats:  SessionStats{},
	}
	sessionStore := &mockSessionStoreForStats{
		sessions: make(map[string]*SyncSession),
	}

	tests := []struct {
		name          string
		sessionStore  SessionStore
		session       *SyncSession
		batchInterval time.Duration
		batchSize     int64
		wantErr       bool
		errContains   string
	}{
		{
			name:          "valid parameters",
			sessionStore:  sessionStore,
			session:       session,
			batchInterval: 1 * time.Second,
			batchSize:     10,
			wantErr:       false,
		},
		{
			name:          "nil sessionStore",
			sessionStore:  nil,
			session:       session,
			batchInterval: 1 * time.Second,
			batchSize:     10,
			wantErr:       true,
			errContains:   "sessionStore is required",
		},
		{
			name:          "nil session",
			sessionStore:  sessionStore,
			session:       nil,
			batchInterval: 1 * time.Second,
			batchSize:     10,
			wantErr:       true,
			errContains:   "session is required",
		},
		{
			name:          "zero batchInterval",
			sessionStore:  sessionStore,
			session:       session,
			batchInterval: 0,
			batchSize:     10,
			wantErr:       true,
			errContains:   "batchInterval must be > 0",
		},
		{
			name:          "negative batchInterval",
			sessionStore:  sessionStore,
			session:       session,
			batchInterval: -1 * time.Second,
			batchSize:     10,
			wantErr:       true,
			errContains:   "batchInterval must be > 0",
		},
		{
			name:          "zero batchSize",
			sessionStore:  sessionStore,
			session:       session,
			batchInterval: 1 * time.Second,
			batchSize:     0,
			wantErr:       true,
			errContains:   "batchSize must be >= 1",
		},
		{
			name:          "negative batchSize",
			sessionStore:  sessionStore,
			session:       session,
			batchInterval: 1 * time.Second,
			batchSize:     -5,
			wantErr:       true,
			errContains:   "batchSize must be >= 1",
		},
		{
			name:          "batchSize of 1 is valid",
			sessionStore:  sessionStore,
			session:       session,
			batchInterval: 1 * time.Second,
			batchSize:     1,
			wantErr:       false,
		},
		{
			name:          "very large batchSize is valid",
			sessionStore:  sessionStore,
			session:       session,
			batchInterval: 1 * time.Second,
			batchSize:     1000000,
			wantErr:       false,
		},
		{
			name:          "very small batchInterval is valid",
			sessionStore:  sessionStore,
			session:       session,
			batchInterval: 1 * time.Millisecond,
			batchSize:     10,
			wantErr:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stats, err := newStatsAccumulator(tt.sessionStore, tt.session, tt.batchInterval, tt.batchSize)

			if tt.wantErr {
				if err == nil {
					t.Errorf("expected error containing %q, got nil", tt.errContains)
					return
				}
				if tt.errContains != "" && !contains(err.Error(), tt.errContains) {
					t.Errorf("expected error containing %q, got %q", tt.errContains, err.Error())
				}
				if stats != nil {
					t.Errorf("expected nil stats on error, got %v", stats)
				}
			} else {
				if err != nil {
					t.Errorf("expected no error, got %v", err)
					return
				}
				if stats == nil {
					t.Error("expected non-nil stats, got nil")
					return
				}
				// Verify fields are set correctly
				if stats.sessionStore != tt.sessionStore {
					t.Error("sessionStore not set correctly")
				}
				if stats.session != tt.session {
					t.Error("session not set correctly")
				}
				if stats.batchInterval != tt.batchInterval {
					t.Errorf("batchInterval = %v, want %v", stats.batchInterval, tt.batchInterval)
				}
				if stats.batchSize != tt.batchSize {
					t.Errorf("batchSize = %d, want %d", stats.batchSize, tt.batchSize)
				}
			}
		})
	}
}

func TestStatsAccumulator_Increments(t *testing.T) {
	session := &SyncSession{
		ID:     "test-session",
		UserID: "user-123",
		Stats:  SessionStats{},
	}
	sessionStore := &mockSessionStoreForStats{sessions: make(map[string]*SyncSession)}

	stats, err := newStatsAccumulator(sessionStore, session, 1*time.Second, 10)
	if err != nil {
		t.Fatalf("failed to create stats accumulator: %v", err)
	}

	// Test all increment methods
	stats.incrementDiscovered()
	stats.incrementDiscovered()
	stats.incrementExtracted()
	stats.incrementApproved()
	stats.incrementRejected()
	stats.incrementUploaded()
	stats.incrementSkipped()
	stats.incrementErrors()

	// Get snapshot
	snapshot := stats.getSnapshot()

	if snapshot.Discovered != 2 {
		t.Errorf("Discovered = %d, want 2", snapshot.Discovered)
	}
	if snapshot.Extracted != 1 {
		t.Errorf("Extracted = %d, want 1", snapshot.Extracted)
	}
	if snapshot.Approved != 1 {
		t.Errorf("Approved = %d, want 1", snapshot.Approved)
	}
	if snapshot.Rejected != 1 {
		t.Errorf("Rejected = %d, want 1", snapshot.Rejected)
	}
	if snapshot.Uploaded != 1 {
		t.Errorf("Uploaded = %d, want 1", snapshot.Uploaded)
	}
	if snapshot.Skipped != 1 {
		t.Errorf("Skipped = %d, want 1", snapshot.Skipped)
	}
	if snapshot.Errors != 1 {
		t.Errorf("Errors = %d, want 1", snapshot.Errors)
	}
}

func TestStatsAccumulator_ShouldFlush_BatchSize(t *testing.T) {
	session := &SyncSession{
		ID:     "test-session",
		UserID: "user-123",
		Stats:  SessionStats{},
	}
	sessionStore := &mockSessionStoreForStats{sessions: make(map[string]*SyncSession)}

	stats, err := newStatsAccumulator(sessionStore, session, 10*time.Second, 5)
	if err != nil {
		t.Fatalf("failed to create stats accumulator: %v", err)
	}

	// Should not flush initially
	if stats.shouldFlush() {
		t.Error("should not flush with 0 operations")
	}

	// Add 4 operations (below batch size)
	for i := 0; i < 4; i++ {
		stats.incrementDiscovered()
	}

	if stats.shouldFlush() {
		t.Error("should not flush with 4 operations (batch size is 5)")
	}

	// Add 1 more operation to reach batch size
	stats.incrementDiscovered()

	if !stats.shouldFlush() {
		t.Error("should flush with 5 operations")
	}
}

func TestStatsAccumulator_ShouldFlush_Time(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping time-based test in short mode")
	}

	session := &SyncSession{
		ID:     "test-session",
		UserID: "user-123",
		Stats:  SessionStats{},
	}
	sessionStore := &mockSessionStoreForStats{sessions: make(map[string]*SyncSession)}

	// Use very short interval for testing
	stats, err := newStatsAccumulator(sessionStore, session, 100*time.Millisecond, 1000)
	if err != nil {
		t.Fatalf("failed to create stats accumulator: %v", err)
	}

	// Should not flush initially
	if stats.shouldFlush() {
		t.Error("should not flush immediately")
	}

	// Add a small number of operations (well below batch size)
	stats.incrementDiscovered()
	stats.incrementDiscovered()

	if stats.shouldFlush() {
		t.Error("should not flush before time interval")
	}

	// Wait for time interval to elapse
	time.Sleep(150 * time.Millisecond)

	// Should flush based on time
	if !stats.shouldFlush() {
		t.Error("should flush after time interval")
	}
}

func TestStatsAccumulator_Flush(t *testing.T) {
	ctx := context.Background()
	session := &SyncSession{
		ID:     "test-session",
		UserID: "user-123",
		Stats:  SessionStats{},
	}
	sessionStore := &mockSessionStoreForStats{sessions: make(map[string]*SyncSession)}

	stats, err := newStatsAccumulator(sessionStore, session, 1*time.Second, 10)
	if err != nil {
		t.Fatalf("failed to create stats accumulator: %v", err)
	}

	// Increment some counters
	stats.incrementDiscovered()
	stats.incrementDiscovered()
	stats.incrementExtracted()
	stats.incrementUploaded()

	// Flush
	err = stats.flush(ctx)
	if err != nil {
		t.Errorf("flush failed: %v", err)
	}

	// Verify session stats were updated
	if session.Stats.Discovered != 2 {
		t.Errorf("session.Stats.Discovered = %d, want 2", session.Stats.Discovered)
	}
	if session.Stats.Extracted != 1 {
		t.Errorf("session.Stats.Extracted = %d, want 1", session.Stats.Extracted)
	}
	if session.Stats.Uploaded != 1 {
		t.Errorf("session.Stats.Uploaded = %d, want 1", session.Stats.Uploaded)
	}

	// Verify sessionStore.Update was called
	if sessionStore.updateCalled != 1 {
		t.Errorf("sessionStore.Update called %d times, want 1", sessionStore.updateCalled)
	}

	// Verify consecutive flush fails counter is 0 after success
	if stats.getConsecutiveFlushFails() != 0 {
		t.Errorf("consecutiveFlushFails = %d, want 0", stats.getConsecutiveFlushFails())
	}
}

func TestStatsAccumulator_FlushFailureTracking(t *testing.T) {
	ctx := context.Background()
	session := &SyncSession{
		ID:     "test-session",
		UserID: "user-123",
		Stats:  SessionStats{},
	}
	sessionStore := &mockSessionStoreForStats{
		sessions:         make(map[string]*SyncSession),
		updateShouldFail: true,
	}

	stats, err := newStatsAccumulator(sessionStore, session, 1*time.Second, 10)
	if err != nil {
		t.Fatalf("failed to create stats accumulator: %v", err)
	}

	// Flush should fail
	err = stats.flush(ctx)
	if err == nil {
		t.Error("expected flush to fail, got nil")
	}

	// Verify consecutive flush fails counter incremented
	if stats.getConsecutiveFlushFails() != 1 {
		t.Errorf("consecutiveFlushFails = %d, want 1", stats.getConsecutiveFlushFails())
	}

	// Flush again, should increment counter
	err = stats.flush(ctx)
	if err == nil {
		t.Error("expected flush to fail, got nil")
	}

	if stats.getConsecutiveFlushFails() != 2 {
		t.Errorf("consecutiveFlushFails = %d, want 2", stats.getConsecutiveFlushFails())
	}

	// Now allow flush to succeed
	sessionStore.updateShouldFail = false
	err = stats.flush(ctx)
	if err != nil {
		t.Errorf("expected flush to succeed, got %v", err)
	}

	// Verify counter reset to 0
	if stats.getConsecutiveFlushFails() != 0 {
		t.Errorf("consecutiveFlushFails = %d, want 0 after successful flush", stats.getConsecutiveFlushFails())
	}
}

// Helper function for string contains check
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		(len(s) > 0 && len(substr) > 0 && stringContains(s, substr)))
}

func stringContains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
