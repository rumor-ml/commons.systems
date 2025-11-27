package streaming

import (
	"context"
	"time"

	"github.com/commons-systems/filesync"
)

// StreamMerger merges pipeline progress and Firestore subscriptions into a unified event stream
type StreamMerger struct {
	sessionStore filesync.SessionStore
	fileStore    filesync.FileStore
	eventsCh     chan SSEEvent
	done         chan struct{}
}

// NewStreamMerger creates a new stream merger
func NewStreamMerger(sessionStore filesync.SessionStore, fileStore filesync.FileStore) *StreamMerger {
	return &StreamMerger{
		sessionStore: sessionStore,
		fileStore:    fileStore,
		eventsCh:     make(chan SSEEvent, 100),
		done:         make(chan struct{}),
	}
}

// StartProgressForwarder forwards pipeline progress events to the events channel
func (m *StreamMerger) StartProgressForwarder(ctx context.Context, progressCh <-chan filesync.Progress) {
	go func() {
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
	})
}

// StartFileSubscription subscribes to file updates from Firestore
func (m *StreamMerger) StartFileSubscription(ctx context.Context, sessionID string) error {
	return m.fileStore.SubscribeBySession(ctx, sessionID, func(file *filesync.SyncFile) {
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
			},
		}
		select {
		case m.eventsCh <- event:
		case <-m.done:
			return
		}
	})
}

// Events returns the unified events channel
func (m *StreamMerger) Events() <-chan SSEEvent {
	return m.eventsCh
}

// Stop stops the stream merger and closes the events channel
func (m *StreamMerger) Stop() {
	close(m.done)
	close(m.eventsCh)
}
