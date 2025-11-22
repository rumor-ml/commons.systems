package terminal

import (
	"testing"
)

func TestClaudeActivityDetection(t *testing.T) {
	// Create a mock TmuxExecutor (nil is fine since detectClaudeActivityWithDuration doesn't use it)
	monitor := NewClaudeMonitor(nil)

	tests := []struct {
		name           string
		content        string
		expectedActive bool
		description    string
	}{
		{
			name:           "Standard activity with bullet point",
			content:        "\x1b[38;2;215;119;87m* Wondering... (41s • 5.7k tokens • esc to interrupt)\x1b[0m",
			expectedActive: true,
			description:    "Should detect standard Claude activity pattern with orange color",
		},
		{
			name:           "Activity with middle dot",
			content:        "\x1b[38;2;215;119;87m* Verifying... (116s · 3.5k tokens · esc to interrupt)\x1b[0m",
			expectedActive: true,
			description:    "Should detect with middle dot separator",
		},
		{
			name:           "Activity with asterisk separator",
			content:        "\x1b[38;2;215;119;87m* Thinking... (25s * 2.1k tokens * esc to interrupt)\x1b[0m",
			expectedActive: true,
			description:    "Should detect with asterisk separator",
		},
		{
			name:           "Activity with orange ANSI codes but no timing",
			content:        "\x1b[38;5;208m* Working on task...\x1b[0m",
			expectedActive: false,
			description:    "Should NOT detect orange without timing pattern",
		},
		{
			name:           "Activity with RGB orange codes but no timing",
			content:        "\x1b[38;2;215;119;87m* Processing...\x1b[0m",
			expectedActive: false,
			description:    "Should NOT detect RGB orange without timing pattern",
		},
		{
			name:           "Mixed spacing in timing pattern",
			content:        "\x1b[38;2;215;119;87m* Working... (45s  •  8.2k tokens  •  esc  to  interrupt)\x1b[0m",
			expectedActive: true,
			description:    "Should handle variable spacing",
		},
		{
			name:           "No tokens indicator",
			content:        "\x1b[38;2;215;119;87m* Working... (45s • 8200 tokens • esc to interrupt)\x1b[0m",
			expectedActive: true,
			description:    "Should handle tokens without 'k'",
		},
		{
			name:           "Inactive Claude pane",
			content:        "> User prompt here",
			expectedActive: false,
			description:    "Should not detect user prompts as activity",
		},
		{
			name:           "Partial pattern",
			content:        "* Wondering about something",
			expectedActive: false,
			description:    "Should not detect partial patterns",
		},
		{
			name:           "Old activity in scrollback now detected as active",
			content:        "Previous output: (30s • 5k tokens • esc to interrupt)",
			expectedActive: true,
			description:    "Text-only detection now considers any 'esc to interrupt' as active",
		},
		{
			name:           "Duration-less pattern detection",
			content:        "✻ Slithering… (esc to interrupt)",
			expectedActive: true,
			description:    "Should detect Claude activity even without duration prefix",
		},
		{
			name:           "Real world ANSI pattern without duration",
			content:        "\x1b[38;2;215;119;87m✻\x1b[39m \x1b[38;2;215;119;87mSlithering… \x1b[2m\x1b[39m(esc to interrupt)\x1b[0m",
			expectedActive: true,
			description:    "Should detect real Claude pane content with ANSI codes",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status := monitor.detectClaudeActivityWithDuration(tt.content)

			if status.Active != tt.expectedActive {
				t.Errorf("%s: Expected active=%v, got %v", tt.description, tt.expectedActive, status.Active)
			}
		})
	}
}

func TestClaudeActivityRealWorldPatterns(t *testing.T) {
	// Create a mock TmuxExecutor (nil is fine since detectClaudeActivityWithDuration doesn't use it)
	monitor := NewClaudeMonitor(nil)

	// Test with actual patterns from screenshots
	realPatterns := []struct {
		name             string
		content          string
		expectedActive   bool
		expectedDuration string
	}{
		{
			name:             "Screenshot pattern 1",
			content:          "\x1b[38;2;215;119;87m* Wondering... (41s • 5.7k tokens • esc to interrupt)\x1b[0m",
			expectedActive:   true,
			expectedDuration: "41s",
		},
		{
			name:             "Screenshot pattern 2",
			content:          "\x1b[38;2;215;119;87m* Verifying... (116s • 3.5k tokens • esc to interrupt)\x1b[0m",
			expectedActive:   true,
			expectedDuration: "116s",
		},
		{
			name:             "Screenshot pattern with emoji - Mending",
			content:          "\x1b[38;2;215;119;87m• Mending… (664s • ⚡ 11.1k tokens • esc to interrupt)\x1b[0m",
			expectedActive:   true,
			expectedDuration: "664s",
		},
		{
			name:             "Screenshot pattern - Refining with ANSI reset",
			content:          "\x1b[38;2;215;119;87m• Refining…\x1b[0m (18s • ⚡ 3.4k tokens • esc to interrupt)",
			expectedActive:   true,
			expectedDuration: "18s",
		},
		{
			name:             "Real tmux output - Investigating with ANSI in timing",
			content:          "\x1b[38;2;215;119;87m·\x1b[39m \x1b[38;2;215;119;87mInvestigating… \x1b[38;2;153;153;153m(0s · ⚒\x1b[39m \x1b[38;2;153;153;153m18 tokens · \x1b[1mesc \x1b[0m\x1b[38;2;153;153;153mto interrupt)\x1b[39m",
			expectedActive:   true,
			expectedDuration: "0s",
		},
		{
			name:             "Duration after interrupt - simple",
			content:          "· Processing… (esc to interrupt · 28s)",
			expectedActive:   true,
			expectedDuration: "28s",
		},
		{
			name:             "Duration after interrupt - with extras",
			content:          "· Working… (esc to interrupt · 45s · ctrl+t to show todos)",
			expectedActive:   true,
			expectedDuration: "45s",
		},
		{
			name:             "Duration after interrupt - minutes",
			content:          "· Analyzing… (esc to interrupt · 2m)",
			expectedActive:   true,
			expectedDuration: "2m",
		},
	}

	for _, tt := range realPatterns {
		t.Run(tt.name, func(t *testing.T) {
			status := monitor.detectClaudeActivityWithDuration(tt.content)

			if status.Active != tt.expectedActive {
				t.Errorf("Expected active=%v, got %v for content: %q", tt.expectedActive, status.Active, tt.content)
			}

			if tt.expectedActive && status.DurationText != tt.expectedDuration {
				t.Errorf("Expected duration=%q, got %q for content: %q", tt.expectedDuration, status.DurationText, tt.content)
			}
		})
	}
}
