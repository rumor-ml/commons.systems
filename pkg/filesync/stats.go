package filesync

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// statsAccumulator accumulates file processing statistics with batched updates
// to reduce Firestore write frequency.
//
// Thread Safety:
//   - All increment* methods are safe for concurrent use via atomic operations
//   - shouldFlush and flush acquire a mutex; multiple concurrent flush calls are serialized
//   - The session.Stats field is mutated during flush while holding the mutex
//   - getSnapshot is lock-free and provides a point-in-time view
type statsAccumulator struct {
	// Atomic counters for lock-free increments from concurrent workers
	discovered int64
	extracted  int64
	approved   int64
	rejected   int64
	uploaded   int64
	skipped    int64
	errors     int64

	// Batching control
	mu            sync.Mutex
	lastFlush     time.Time
	lastFlushOps  int64         // Total operations at last flush
	batchInterval time.Duration
	batchSize     int64

	// Dependencies
	sessionStore SessionStore
	session      *SyncSession
}

// newStatsAccumulator creates a new stats accumulator
func newStatsAccumulator(sessionStore SessionStore, session *SyncSession, batchInterval time.Duration, batchSize int64) *statsAccumulator {
	return &statsAccumulator{
		sessionStore:  sessionStore,
		session:       session,
		batchInterval: batchInterval,
		batchSize:     batchSize,
		lastFlush:     time.Now(),
	}
}

// incrementDiscovered atomically increments the discovered counter
func (s *statsAccumulator) incrementDiscovered() {
	atomic.AddInt64(&s.discovered, 1)
}

// incrementExtracted atomically increments the extracted counter
func (s *statsAccumulator) incrementExtracted() {
	atomic.AddInt64(&s.extracted, 1)
}

// incrementApproved atomically increments the approved counter
func (s *statsAccumulator) incrementApproved() {
	atomic.AddInt64(&s.approved, 1)
}

// incrementRejected atomically increments the rejected counter
func (s *statsAccumulator) incrementRejected() {
	atomic.AddInt64(&s.rejected, 1)
}

// incrementUploaded atomically increments the uploaded counter
func (s *statsAccumulator) incrementUploaded() {
	atomic.AddInt64(&s.uploaded, 1)
}

// incrementSkipped atomically increments the skipped counter
func (s *statsAccumulator) incrementSkipped() {
	atomic.AddInt64(&s.skipped, 1)
}

// incrementErrors atomically increments the errors counter
func (s *statsAccumulator) incrementErrors() {
	atomic.AddInt64(&s.errors, 1)
}

// shouldFlush checks if stats should be flushed based on time or batch size
func (s *statsAccumulator) shouldFlush() bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check time-based flush
	if time.Since(s.lastFlush) >= s.batchInterval {
		return true
	}

	// Check batch size-based flush (operations since last flush)
	currentOps := atomic.LoadInt64(&s.discovered) +
		atomic.LoadInt64(&s.extracted) +
		atomic.LoadInt64(&s.approved) +
		atomic.LoadInt64(&s.rejected) +
		atomic.LoadInt64(&s.uploaded) +
		atomic.LoadInt64(&s.skipped) +
		atomic.LoadInt64(&s.errors)

	opsSinceFlush := currentOps - s.lastFlushOps
	return opsSinceFlush >= s.batchSize
}

// flush writes accumulated stats to Firestore
func (s *statsAccumulator) flush(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Load current values atomically
	s.session.Stats.Discovered = int(atomic.LoadInt64(&s.discovered))
	s.session.Stats.Extracted = int(atomic.LoadInt64(&s.extracted))
	s.session.Stats.Approved = int(atomic.LoadInt64(&s.approved))
	s.session.Stats.Rejected = int(atomic.LoadInt64(&s.rejected))
	s.session.Stats.Uploaded = int(atomic.LoadInt64(&s.uploaded))
	s.session.Stats.Skipped = int(atomic.LoadInt64(&s.skipped))
	s.session.Stats.Errors = int(atomic.LoadInt64(&s.errors))

	// Update session in Firestore
	if err := s.sessionStore.Update(ctx, s.session); err != nil {
		return err
	}

	// Update tracking for batch size reset
	totalOps := int64(s.session.Stats.Discovered +
		s.session.Stats.Extracted +
		s.session.Stats.Approved +
		s.session.Stats.Rejected +
		s.session.Stats.Uploaded +
		s.session.Stats.Skipped +
		s.session.Stats.Errors)
	s.lastFlushOps = totalOps
	s.lastFlush = time.Now()
	return nil
}

// getSnapshot returns a snapshot of current stats without flushing
func (s *statsAccumulator) getSnapshot() SessionStats {
	return SessionStats{
		Discovered: int(atomic.LoadInt64(&s.discovered)),
		Extracted:  int(atomic.LoadInt64(&s.extracted)),
		Approved:   int(atomic.LoadInt64(&s.approved)),
		Rejected:   int(atomic.LoadInt64(&s.rejected)),
		Uploaded:   int(atomic.LoadInt64(&s.uploaded)),
		Skipped:    int(atomic.LoadInt64(&s.skipped)),
		Errors:     int(atomic.LoadInt64(&s.errors)),
	}
}
