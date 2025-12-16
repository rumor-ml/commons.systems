package streaming

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/commons-systems/filesync"
)

// StreamMerger merges pipeline progress and Firestore subscriptions into a unified event stream
type StreamMerger struct {
	sessionStore filesync.SessionStore
	fileStore    filesync.FileStore
	eventsCh     chan SSEEvent
	done         chan struct{}
	mu           sync.Mutex
	stopped      bool
}

// NewStreamMerger creates a new stream merger
func NewStreamMerger(sessionStore filesync.SessionStore, fileStore filesync.FileStore) (*StreamMerger, error) {
	if sessionStore == nil {
		return nil, fmt.Errorf("sessionStore is required")
	}
	if fileStore == nil {
		return nil, fmt.Errorf("fileStore is required")
	}

	return &StreamMerger{
		sessionStore: sessionStore,
		fileStore:    fileStore,
		eventsCh:     make(chan SSEEvent, 100),
		done:         make(chan struct{}),
	}, nil
}

// StartProgressForwarder forwards pipeline progress events to the events channel
func (m *StreamMerger) StartProgressForwarder(ctx context.Context, progressCh <-chan filesync.Progress) {
	go func() {
		// Recover from panics to prevent server crash
		defer func() {
			if r := recover(); r != nil {
				HandlePanic(r, "progress forwarder")
			}
		}()

		for {
			select {
			case <-ctx.Done():
				return
			case <-m.done:
				return
			case progress, ok := <-progressCh:
				if !ok {
					return
				}
				event := SSEEvent{
					Type:      EventTypeProgress,
					Timestamp: time.Now(),
					Data: ProgressEvent{
						Operation:  progress.Operation,
						File:       progress.File,
						Percentage: progress.Percentage,
					},
				}
				// Use non-blocking send with done check to prevent panic on closed channel
				select {
				case m.eventsCh <- event:
				case <-ctx.Done():
					return
				case <-m.done:
					return
				}
			}
		}
	}()
}

// StartSessionSubscription subscribes to session updates from Firestore
func (m *StreamMerger) StartSessionSubscription(ctx context.Context, sessionID string) error {
	return m.sessionStore.Subscribe(ctx, sessionID, func(session *filesync.SyncSession) {
		// Recover from panics in callback to prevent server crash
		defer func() {
			if r := recover(); r != nil {
				HandlePanic(r, "session subscription callback")
			}
		}()

		if session == nil {
			return
		}

		event := SSEEvent{
			Type:      EventTypeSession,
			Timestamp: time.Now(),
			Data: SessionEvent{
				ID:          session.ID,
				Status:      session.Status,
				Stats:       session.Stats,
				CompletedAt: session.CompletedAt,
			},
		}
		select {
		case m.eventsCh <- event:
		case <-m.done:
			return
		}

		// Send action buttons update (separate event, not OOB)
		actionsEvent := SSEEvent{
			Type:      EventTypeActions,
			Timestamp: time.Now(),
			Data: ActionsEvent{
				SessionID: session.ID,
				Stats:     session.Stats,
			},
		}
		select {
		case m.eventsCh <- actionsEvent:
		case <-m.done:
			return
		}

		// If session is completed or failed, send complete event
		if session.Status == filesync.SessionStatusCompleted || session.Status == filesync.SessionStatusFailed {
			completeEvent := SSEEvent{
				Type:      EventTypeComplete,
				Timestamp: time.Now(),
				Data: CompleteEvent{
					SessionID: session.ID,
					Status:    session.Status,
				},
			}
			select {
			case m.eventsCh <- completeEvent:
			case <-m.done:
				return
			}
		}
	}, func(err error) {
		// Send error event on subscription failure
		if err == nil {
			return
		}

		errorEvent := NewErrorEvent(
			fmt.Sprintf("Session subscription error: %v", err),
			"error",
		)
		select {
		case m.eventsCh <- errorEvent:
		case <-m.done:
			return
		}
	})
}

// StartFileSubscription subscribes to file updates from Firestore
func (m *StreamMerger) StartFileSubscription(ctx context.Context, sessionID string) error {
	return m.fileStore.SubscribeBySession(ctx, sessionID, func(file *filesync.SyncFile) {
		// Recover from panics in callback to prevent server crash
		defer func() {
			if r := recover(); r != nil {
				HandlePanic(r, "file subscription callback")
			}
		}()

		if file == nil {
			return
		}

		event := SSEEvent{
			Type:      EventTypeFile,
			Timestamp: time.Now(),
			Data: FileEvent{
				ID:        file.ID,
				SessionID: file.SessionID,
				LocalPath: file.LocalPath,
				Status:    file.Status,
				Metadata:  file.Metadata,
				Error:     file.Error,
				IsUpdate:  true, // Subscription update - will use OOB swap
			},
		}
		select {
		case m.eventsCh <- event:
		case <-m.done:
			return
		}
	}, func(err error) {
		// Send error event on subscription failure
		if err == nil {
			return
		}

		errorEvent := NewErrorEvent(
			fmt.Sprintf("File subscription error: %v", err),
			"error",
		)
		select {
		case m.eventsCh <- errorEvent:
		case <-m.done:
			return
		}
	})
}

// Events returns the unified events channel
func (m *StreamMerger) Events() <-chan SSEEvent {
	return m.eventsCh
}

// Stop stops the stream merger and signals all forwarders to stop.
//
// Channel Closing Strategy:
// The events channel is NOT closed to avoid panics from concurrent
// Firestore callbacks. Cleanup happens via:
// 1. close(m.done) signals goroutines to stop
// 2. Context cancellation stops subscriptions
// The channel is garbage collected after broadcaster exits.
func (m *StreamMerger) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.stopped {
		return
	}
	m.stopped = true

	close(m.done)
	// NOTE: Do NOT close m.eventsCh here - it causes "send on closed channel" panics
	// due to race conditions with concurrent Firestore subscription callbacks.
	// The channel will be garbage collected when no longer referenced.
}
