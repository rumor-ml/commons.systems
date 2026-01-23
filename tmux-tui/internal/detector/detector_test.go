package detector

import (
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
			name:  "Unknown state",
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
