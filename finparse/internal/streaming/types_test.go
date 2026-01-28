package streaming

import (
	"encoding/json"
	"testing"
)

// TestJSONMarshaling verifies SSEEvent marshals correctly with private data field
func TestJSONMarshaling(t *testing.T) {
	// Test ProgressEvent
	progressEvent := NewProgressEvent(ProgressEvent{
		FileID:     "file1",
		FileName:   "test.csv",
		Processed:  5,
		Total:      10,
		Percentage: 50.0,
		Status:     "processing",
	})

	data, err := json.Marshal(progressEvent)
	if err != nil {
		t.Fatalf("Failed to marshal ProgressEvent: %v", err)
	}

	// Verify it contains expected fields
	var result map[string]interface{}
	if err := json.Unmarshal(data, &result); err != nil {
		t.Fatalf("Failed to unmarshal JSON: %v", err)
	}

	if result["type"] != string(EventTypeProgress) {
		t.Errorf("Expected type=%s, got %v", EventTypeProgress, result["type"])
	}

	dataField, ok := result["data"].(map[string]interface{})
	if !ok {
		t.Fatalf("Expected data field to be object, got %T", result["data"])
	}

	if dataField["fileId"] != "file1" {
		t.Errorf("Expected data.fileId=file1, got %v", dataField["fileId"])
	}
}

// TestTypeSafeAccessors verifies type-safe accessor methods work correctly
func TestTypeSafeAccessors(t *testing.T) {
	progressEvent := NewProgressEvent(ProgressEvent{
		FileID:     "file1",
		FileName:   "test.csv",
		Processed:  5,
		Total:      10,
		Percentage: 50.0,
		Status:     "processing",
	})

	// Test correct accessor
	progress, ok := progressEvent.ProgressData()
	if !ok {
		t.Fatal("ProgressData() should return true for ProgressEvent")
	}
	if progress.FileID != "file1" {
		t.Errorf("Expected FileID=file1, got %s", progress.FileID)
	}

	// Test wrong accessor (should return false)
	if _, ok := progressEvent.ErrorData(); ok {
		t.Error("ErrorData() should return false for ProgressEvent")
	}

	if _, ok := progressEvent.FileData(); ok {
		t.Error("FileData() should return false for ProgressEvent")
	}
}

// TestEventConstructors verifies all event constructors set correct type
func TestEventConstructors(t *testing.T) {
	tests := []struct {
		name      string
		event     SSEEvent
		eventType EventType
	}{
		{
			name:      "ProgressEvent",
			event:     NewProgressEvent(ProgressEvent{FileID: "file1"}),
			eventType: EventTypeProgress,
		},
		{
			name:      "FileEvent",
			event:     NewFileEvent(FileEvent{ID: "file1"}),
			eventType: EventTypeFile,
		},
		{
			name:      "ErrorEvent",
			event:     NewErrorEvent(ErrorEvent{Message: "error"}),
			eventType: EventTypeError,
		},
		{
			name:      "CompleteEvent",
			event:     NewCompleteEvent(map[string]string{"status": "done"}),
			eventType: EventTypeComplete,
		},
		{
			name:      "HeartbeatEvent",
			event:     NewHeartbeatEvent(),
			eventType: EventTypeHeartbeat,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.event.Type != tt.eventType {
				t.Errorf("Expected type=%s, got %s", tt.eventType, tt.event.Type)
			}
			if tt.event.Timestamp.IsZero() {
				t.Error("Timestamp should be set")
			}
		})
	}
}

// TestDataAccessorReturnsCorrectData verifies Data() method returns underlying data
func TestDataAccessorReturnsCorrectData(t *testing.T) {
	progress := ProgressEvent{
		FileID:     "file1",
		FileName:   "test.csv",
		Processed:  5,
		Total:      10,
		Percentage: 50.0,
		Status:     "processing",
	}

	event := NewProgressEvent(progress)

	// Data() should return the original struct
	data := event.Data()
	progressData, ok := data.(ProgressEvent)
	if !ok {
		t.Fatalf("Data() should return ProgressEvent, got %T", data)
	}

	if progressData.FileID != "file1" {
		t.Errorf("Expected FileID=file1, got %s", progressData.FileID)
	}
}
