package detector

import (
	"fmt"
	"testing"

	"github.com/commons-systems/tmux-tui/internal/watcher"
)

func TestState_String(t *testing.T) {
	tests := []struct {
		name  string
		state State
		want  string
	}{
		{
			name:  "StateWorking",
			state: StateWorking,
			want:  "working",
		},
		{
			name:  "StateIdle",
			state: StateIdle,
			want:  "idle",
		},
		{
			name:  "Unknown state value (defensive)",
			state: State(999),
			want:  "unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.state.String()
			if got != tt.want {
				t.Errorf("State.String() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestEventTypeToState(t *testing.T) {
	tests := []struct {
		name      string
		eventType string
		want      State
	}{
		{
			name:      "EventTypeIdle",
			eventType: watcher.EventTypeIdle,
			want:      StateIdle,
		},
		{
			name:      "EventTypeWorking",
			eventType: watcher.EventTypeWorking,
			want:      StateWorking,
		},
		{
			name:      "EventTypeStop maps to idle",
			eventType: watcher.EventTypeStop,
			want:      StateIdle,
		},
		{
			name:      "EventTypePermission maps to idle",
			eventType: watcher.EventTypePermission,
			want:      StateIdle,
		},
		{
			name:      "EventTypeElicitation maps to idle",
			eventType: watcher.EventTypeElicitation,
			want:      StateIdle,
		},
		{
			name:      "Unknown event type maps to idle",
			eventType: "unknown",
			want:      StateIdle,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := eventTypeToState(tt.eventType)
			if got != tt.want {
				t.Errorf("eventTypeToState(%v) = %v, want %v", tt.eventType, got, tt.want)
			}
		})
	}
}

func TestNewState(t *testing.T) {
	tests := []struct {
		name    string
		value   int
		want    State
		wantErr bool
	}{
		{
			name:    "Valid StateWorking",
			value:   0,
			want:    StateWorking,
			wantErr: false,
		},
		{
			name:    "Valid StateIdle",
			value:   1,
			want:    StateIdle,
			wantErr: false,
		},
		{
			name:    "Invalid state returns error",
			value:   999,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NewState(tt.value)
			if tt.wantErr {
				if err == nil {
					t.Errorf("NewState(%d) expected error, got nil", tt.value)
				}
				return
			}
			if err != nil {
				t.Errorf("NewState(%d) unexpected error: %v", tt.value, err)
				return
			}
			if got != tt.want {
				t.Errorf("NewState(%d) = %v, want %v", tt.value, got, tt.want)
			}
		})
	}
}

func TestNewStateFromString(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    State
		wantErr bool
	}{
		{
			name:    "working",
			input:   "working",
			want:    StateWorking,
			wantErr: false,
		},
		{
			name:    "idle",
			input:   "idle",
			want:    StateIdle,
			wantErr: false,
		},
		{
			name:    "invalid",
			input:   "invalid",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NewStateFromString(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Errorf("NewStateFromString(%q) expected error, got nil", tt.input)
				}
				return
			}
			if err != nil {
				t.Errorf("NewStateFromString(%q) unexpected error: %v", tt.input, err)
				return
			}
			if got != tt.want {
				t.Errorf("NewStateFromString(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestStateEvent_Constructors(t *testing.T) {
	t.Run("NewStateChangeEvent creates valid event", func(t *testing.T) {
		event := NewStateChangeEvent("%123", StateIdle)
		if event.IsError() {
			t.Error("Expected non-error event")
		}
		if event.PaneID() != "%123" {
			t.Errorf("PaneID() = %q, want %q", event.PaneID(), "%123")
		}
		if event.State() != StateIdle {
			t.Errorf("State() = %v, want %v", event.State(), StateIdle)
		}
	})

	t.Run("NewStateErrorEvent creates error event", func(t *testing.T) {
		testErr := fmt.Errorf("test error")
		event := NewStateErrorEvent(testErr)
		if !event.IsError() {
			t.Error("Expected error event")
		}
		if event.Error() != testErr {
			t.Errorf("Error() = %v, want %v", event.Error(), testErr)
		}
	})

	t.Run("Panics on invalid constructor calls", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("Expected panic for empty paneID")
			}
		}()
		NewStateChangeEvent("", StateIdle)
	})
}
