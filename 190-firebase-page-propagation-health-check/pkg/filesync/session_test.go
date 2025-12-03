package filesync

import (
	"testing"
	"time"
)

func TestSessionStatusConstants(t *testing.T) {
	tests := []struct {
		name     string
		status   SessionStatus
		expected string
	}{
		{"Running", SessionStatusRunning, "running"},
		{"Completed", SessionStatusCompleted, "completed"},
		{"Failed", SessionStatusFailed, "failed"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if string(tt.status) != tt.expected {
				t.Errorf("expected %s, got %s", tt.expected, string(tt.status))
			}
		})
	}
}

func TestFileStatusConstants(t *testing.T) {
	tests := []struct {
		name     string
		status   FileStatus
		expected string
	}{
		{"Pending", FileStatusPending, "pending"},
		{"Extracting", FileStatusExtracting, "extracting"},
		{"Uploading", FileStatusUploading, "uploading"},
		{"Uploaded", FileStatusUploaded, "uploaded"},
		{"Skipped", FileStatusSkipped, "skipped"},
		{"Error", FileStatusError, "error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if string(tt.status) != tt.expected {
				t.Errorf("expected %s, got %s", tt.expected, string(tt.status))
			}
		})
	}
}

func TestSessionStatsFields(t *testing.T) {
	stats := SessionStats{
		Discovered: 100,
		Extracted:  80,
		Uploaded:   75,
		Skipped:    5,
		Errors:     20,
	}

	if stats.Discovered != 100 {
		t.Errorf("expected Discovered to be 100, got %d", stats.Discovered)
	}
	if stats.Extracted != 80 {
		t.Errorf("expected Extracted to be 80, got %d", stats.Extracted)
	}
	if stats.Uploaded != 75 {
		t.Errorf("expected Uploaded to be 75, got %d", stats.Uploaded)
	}
	if stats.Skipped != 5 {
		t.Errorf("expected Skipped to be 5, got %d", stats.Skipped)
	}
	if stats.Errors != 20 {
		t.Errorf("expected Errors to be 20, got %d", stats.Errors)
	}
}

func TestSyncSessionFields(t *testing.T) {
	now := time.Now()
	completedAt := now.Add(5 * time.Minute)

	session := SyncSession{
		ID:          "test-session-123",
		UserID:      "user-456",
		Status:      SessionStatusRunning,
		StartedAt:   now,
		CompletedAt: &completedAt,
		RootDir:     "/path/to/files",
		Stats: SessionStats{
			Discovered: 10,
			Extracted:  8,
			Uploaded:   7,
			Skipped:    1,
			Errors:     2,
		},
	}

	if session.ID != "test-session-123" {
		t.Errorf("expected ID to be test-session-123, got %s", session.ID)
	}
	if session.UserID != "user-456" {
		t.Errorf("expected UserID to be user-456, got %s", session.UserID)
	}
	if session.Status != SessionStatusRunning {
		t.Errorf("expected Status to be running, got %s", session.Status)
	}
	if session.RootDir != "/path/to/files" {
		t.Errorf("expected RootDir to be /path/to/files, got %s", session.RootDir)
	}
	if session.CompletedAt == nil || !session.CompletedAt.Equal(completedAt) {
		t.Errorf("expected CompletedAt to be set correctly")
	}
}

func TestFileMetadataFields(t *testing.T) {
	metadata := FileMetadata{
		Title:       "Test Book",
		Author:      "John Doe",
		ISBN:        "1234567890",
		Publisher:   "Test Publisher",
		PublishDate: "2024",
		Extra: map[string]string{
			"custom1": "value1",
			"custom2": "value2",
		},
	}

	if metadata.Title != "Test Book" {
		t.Errorf("expected Title to be 'Test Book', got %s", metadata.Title)
	}
	if metadata.Author != "John Doe" {
		t.Errorf("expected Author to be 'John Doe', got %s", metadata.Author)
	}
	if metadata.ISBN != "1234567890" {
		t.Errorf("expected ISBN to be '1234567890', got %s", metadata.ISBN)
	}
	if metadata.Extra["custom1"] != "value1" {
		t.Errorf("expected Extra[custom1] to be 'value1', got %s", metadata.Extra["custom1"])
	}
}

func TestSyncFileFields(t *testing.T) {
	now := time.Now()

	file := SyncFile{
		ID:        "file-123",
		UserID:    "user-456",
		SessionID: "session-789",
		LocalPath: "/local/path/file.pdf",
		GCSPath:   "gs://bucket/path/file.pdf",
		Hash:      "abc123hash",
		Status:    FileStatusUploaded,
		Metadata: FileMetadata{
			Title:  "Test File",
			Author: "Jane Doe",
		},
		Error:     "",
		UpdatedAt: now,
	}

	if file.ID != "file-123" {
		t.Errorf("expected ID to be file-123, got %s", file.ID)
	}
	if file.UserID != "user-456" {
		t.Errorf("expected UserID to be user-456, got %s", file.UserID)
	}
	if file.SessionID != "session-789" {
		t.Errorf("expected SessionID to be session-789, got %s", file.SessionID)
	}
	if file.LocalPath != "/local/path/file.pdf" {
		t.Errorf("expected LocalPath to be /local/path/file.pdf, got %s", file.LocalPath)
	}
	if file.Status != FileStatusUploaded {
		t.Errorf("expected Status to be uploaded, got %s", file.Status)
	}
	if file.Metadata.Title != "Test File" {
		t.Errorf("expected Metadata.Title to be 'Test File', got %s", file.Metadata.Title)
	}
}
