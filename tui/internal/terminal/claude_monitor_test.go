package terminal

import (
	"strings"
	"testing"
)

func TestClaudeActivityPatterns(t *testing.T) {
	monitor := NewClaudeMonitor(nil)

	testCases := []struct {
		name     string
		content  string
		expected bool
	}{
		{
			name:     "Legacy pattern - Wondering without timing",
			content:  "\x1b[38;2;215;119;87m* Wondering...\x1b[0m",
			expected: false,
		},
		{
			name:     "Legacy pattern with timing",
			content:  "\x1b[38;2;215;119;87m* Thinking... (45s • ⚡ 2.1k tokens • esc to interrupt)\x1b[0m",
			expected: true,
		},
		{
			name:     "New pattern - Crafting without timing",
			content:  "\x1b[38;2;215;119;87m✳ Crafting…\x1b[0m",
			expected: false,
		},
		{
			name:     "New pattern with timing",
			content:  "\x1b[38;2;215;119;87m✳ Crafting… (535s · 18.7k tokens · esc to interrupt)\x1b[0m",
			expected: true,
		},
		{
			name:     "Ultrastreaming pattern without timing",
			content:  "\x1b[38;2;215;119;87m⚡ Ultrastreaming…\x1b[0m",
			expected: false,
		},
		{
			name:     "Ultrastreaming with timing",
			content:  "\x1b[38;2;215;119;87m⚡ Ultrastreaming… (120s · 5.3k tokens · esc to interrupt)\x1b[0m",
			expected: true,
		},
		{
			name:     "Action pattern without timing",
			content:  "\x1b[38;2;215;119;87m⏺ Update(internal/nix/integration.go)…\x1b[0m",
			expected: false,
		},
		{
			name:     "Dot prefix pattern - Determining without timing",
			content:  "\x1b[38;2;215;119;87m· Determining…\x1b[0m",
			expected: false,
		},
		{
			name:     "Dot prefix with timing",
			content:  "\x1b[38;2;215;119;87m· Determining… (100s · ⚒ 909 tokens · esc to interrupt)\x1b[0m",
			expected: true,
		},
		{
			name:     "Orange ANSI RGB color code with text but no timing",
			content:  "\x1b[38;2;215;119;87mGleaming…\x1b[39m",
			expected: false,
		},
		{
			name:     "Exact orange RGB code without timing",
			content:  "\x1b[38;2;215;119;87m",
			expected: false,
		},
		{
			name:     "Orange ANSI 8-bit color code without timing",
			content:  "\x1b[38;5;208mProcessing…\x1b[0m",
			expected: false,
		},
		{
			name:     "Activity word without color or timing",
			content:  "Crafting…",
			expected: false,
		},
		{
			name:     "Timing pattern without orange color",
			content:  "(45s · 2.3k tokens · esc to interrupt)",
			expected: true,
		},
		{
			name:     "Non-activity content",
			content:  "regular terminal output",
			expected: false,
		},
		{
			name:     "Command prompt",
			content:  "$ ls -la",
			expected: false,
		},
		{
			name:     "Empty content",
			content:  "",
			expected: false,
		},
		{
			name:     "Complex content with activity",
			content:  "Some output\n\x1b[38;2;215;119;87m✳ Crafting… (535s · 18.7k tokens · esc to interrupt)\x1b[0m\nMore output",
			expected: true,
		},
		{
			name:     "Duration-less pattern - just (esc to interrupt)",
			content:  "(esc to interrupt)",
			expected: true,
		},
		{
			name:     "Real Claude pane pattern without duration",
			content:  "\x1b[38;2;215;119;87m✻\x1b[39m \x1b[38;2;215;119;87mSlithering… \x1b[2m\x1b[39m(esc to interrupt)\x1b[0m",
			expected: true,
		},
		{
			name:     "Pattern with additional content after interrupt",
			content:  "(esc to interrupt · ctrl+t to show todos)",
			expected: true,
		},
		{
			name:     "Real flashing pattern with extra content",
			content:  "· Investigating… (esc to interrupt · ctrl+t to show todos)",
			expected: true,
		},
		{
			name:     "Pattern with newline at start",
			content:  "(\nesc to interrupt · ctrl+t to show todos)",
			expected: true,
		},
		{
			name:     "Pattern with newline before 'esc'",
			content:  "· Processing… (\nesc to interrupt)",
			expected: true,
		},
		{
			name:     "Pattern with newline between 'esc to interrupt'",
			content:  "(esc\nto interrupt)",
			expected: true,
		},
		{
			name:     "Pattern with multiple newlines",
			content:  "(\n\nesc\nto\ninterrupt\n· ctrl+t to show todos\n)",
			expected: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := monitor.detectClaudeActivity(tc.content)
			if result != tc.expected {
				t.Errorf("Pattern detection failed for %q: expected %v, got %v",
					tc.content, tc.expected, result)
			}
		})
	}
}

// Test edge cases for ANSI sequences and Unicode characters
func TestClaudeActivityEdgeCases(t *testing.T) {
	monitor := NewClaudeMonitor(nil)

	testCases := []struct {
		name     string
		content  string
		expected bool
	}{
		// ANSI sequence edge cases - our regex actually handles these well!
		{
			name:     "ANSI codes splitting 'esc to interrupt' - now supported",
			content:  "* Working... (45s • \x1b[32mesc\x1b[0m to \x1b[31minterrupt\x1b[0m)",
			expected: true, // .*? handles ANSI codes between words
		},
		{
			name:     "ANSI color codes within timing pattern - now supported",
			content:  "* Processing... (\x1b[33m45s\x1b[0m • \x1b[36m2.1k tokens\x1b[0m • esc to interrupt)",
			expected: true, // .*? handles ANSI codes anywhere
		},
		{
			name:     "Complex ANSI sequences around interrupt phrase - now supported",
			content:  "* Thinking... (30s • 1.5k tokens • \x1b[1m\x1b[31mesc\x1b[0m\x1b[22m to \x1b[4minterrupt\x1b[24m)",
			expected: true, // .*? handles complex ANSI sequences
		},

		// Unicode character edge cases  
		{
			name:     "Unicode separators in timing pattern",
			content:  "* Wondering... (45s · ⚡ 2.1k tokens · esc to interrupt)",
			expected: true,
		},
		{
			name:     "Unicode bullets and separators",
			content:  "• Processing… (120s ∙ ⚒ 909 tokens ∙ esc to interrupt)",
			expected: true,
		},
		{
			name:     "Unicode arrows and symbols",
			content:  "⚡ Ultrastreaming… (60s → 3.2k tokens ← esc to interrupt)",
			expected: true,
		},
		{
			name:     "Mixed Unicode and ASCII separators",
			content:  "✳ Crafting… (535s · 18.7k tokens • esc to interrupt)",
			expected: true,
		},

		// Partial match edge cases
		{
			name:     "Partial phrase - 'esc to cancel' instead of 'interrupt'",
			content:  "* Working... (45s • press esc to cancel)",
			expected: false,
		},
		{
			name:     "Partial phrase - 'escape to interrupt'",
			content:  "* Processing... (30s • escape to interrupt)",
			expected: true, // .*? will match "esc" within "escape"
		},
		{
			name:     "Partial phrase - 'esc key interrupts'",
			content:  "* Loading... (45s • esc key interrupts)",
			expected: false,
		},
		{
			name:     "Partial phrase - just 'esc' without 'to interrupt'",
			content:  "* Thinking... (60s • press esc)",
			expected: false,
		},
		{
			name:     "Partial phrase - just 'interrupt' without 'esc to'",
			content:  "* Working... (40s • will interrupt soon)",
			expected: false,
		},

		// Whitespace and formatting edge cases
		{
			name:     "Extra whitespace around 'esc to interrupt' - now supported",
			content:  "* Processing... (45s •   esc   to   interrupt   )",
			expected: true, // .*? handles extra whitespace
		},
		{
			name:     "Tabs and newlines in timing pattern",
			content:  "* Working... (30s •\t2k tokens\t• esc\tto\tinterrupt)",
			expected: true,
		},

		// Case sensitivity edge cases
		{
			name:     "Mixed case - 'ESC TO INTERRUPT'",
			content:  "* Thinking... (45s • ESC TO INTERRUPT)",
			expected: false, // Our regex is case-sensitive
		},
		{
			name:     "Mixed case - 'Esc To Interrupt'", 
			content:  "* Processing... (30s • Esc To Interrupt)",
			expected: false, // Our regex is case-sensitive
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := monitor.detectClaudeActivity(tc.content)
			if result != tc.expected {
				t.Errorf("Edge case detection failed for %q: expected %v, got %v",
					tc.content, tc.expected, result)
			}
		})
	}
}

// Test the actual captured content format we saw
func TestScreenshotPatterns(t *testing.T) {
	monitor := NewClaudeMonitor(nil)

	testCases := []struct {
		name     string
		content  string
		expected bool
	}{
		{
			name:     "Active: Screenshot pattern 1",
			content:  "\x1b[38;2;215;119;87m* Wondering... (41s • 1 5.7k tokens • esc to interrupt)\x1b[0m",
			expected: true,
		},
		{
			name:     "Active: Screenshot pattern 2",
			content:  "\x1b[38;2;215;119;87m* Verifying... (116s • * 3.5k tokens • esc to interrupt)\x1b[0m",
			expected: true,
		},
		{
			name:     "Idle: User input prompt",
			content:  "Do you want to proceed?",
			expected: false,
		},
		{
			name:     "Idle: Choice options",
			content:  "1. Yes\n2. No, and tell Claude what to do differently (esc)",
			expected: false,
		},
		{
			name:     "Idle: Bash command prompt",
			content:  "Bash command",
			expected: false,
		},
		{
			name:     "Active: Generic activity format without timing",
			content:  "\x1b[38;2;215;119;87m* Processing...\x1b[0m",
			expected: false,
		},
		{
			name:     "Active: Timing pattern without orange",
			content:  "(120s • 5.3k tokens • esc to interrupt)",
			expected: true,
		},
		{
			name:     "Active: Screenshot pattern with arrow",
			content:  "\x1b[38;2;215;119;87m* Troubleshooting... (58s • ↑ 322 tokens • esc to interrupt)\x1b[0m",
			expected: true,
		},
		{
			name:     "Active: Configuring pattern from screenshot",
			content:  "\x1b[38;2;215;119;87m* Configuring... (125s ↓ ↓ 3.4k tokens • esc to interrupt)\x1b[0m",
			expected: true,
		},
		{
			name:     "Active: Old scrollback timing pattern still considered active",
			content:  "Previous output: (30s • 5k tokens • esc to interrupt)",
			expected: true,
		},
		{
			name:     "Active: Exact screenshot pattern with Configuring",
			content:  "\x1b[38;2;215;119;87m* Configuring... (125s ↓ ↓ 3.4k tokens • esc to interrupt)\x1b[0m",
			expected: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := monitor.detectClaudeActivity(tc.content)
			if result != tc.expected {
				t.Errorf("Expected %v, got %v for content: %q", tc.expected, result, tc.content)
			}
		})
	}
}

func TestClaudeActivityDetectionAnywhereInContent(t *testing.T) {
	monitor := NewClaudeMonitor(nil)

	// Test that activity is detected regardless of position in content
	testCases := []struct {
		name        string
		content     string
		expected    bool
		description string
	}{
		{
			name:        "Activity at the beginning",
			content:     "\x1b[38;2;215;119;87m* Wondering... (41s • 5.7k tokens • esc to interrupt)\x1b[0m\n" + strings.Repeat("Other content\n", 50),
			expected:    true,
			description: "Should detect activity at the start of content",
		},
		{
			name:        "Activity in the middle",
			content:     strings.Repeat("Other content\n", 25) + "\x1b[38;2;215;119;87m✳ Crafting… (535s · 18.7k tokens · esc to interrupt)\x1b[0m\n" + strings.Repeat("More content\n", 25),
			expected:    true,
			description: "Should detect activity in the middle of content",
		},
		{
			name:        "Activity at the end",
			content:     strings.Repeat("Other content\n", 50) + "\x1b[38;2;215;119;87m⚡ Ultrastreaming… (120s · 5.3k tokens · esc to interrupt)\x1b[0m",
			expected:    true,
			description: "Should detect activity at the end of content",
		},
		{
			name:        "Activity beyond 30 lines from bottom",
			content:     strings.Repeat("Line\n", 10) + "\x1b[38;2;215;119;87m· Determining… (100s · ⚒ 909 tokens · esc to interrupt)\x1b[0m\n" + strings.Repeat("Line\n", 40),
			expected:    true,
			description: "Should detect activity even when it's more than 30 lines from the bottom",
		},
		{
			name:        "No activity in large content",
			content:     strings.Repeat("Regular terminal output\n", 100),
			expected:    false,
			description: "Should not detect activity when none exists",
		},
		{
			name: "Multiple activities - first one counts",
			content: "\x1b[38;2;215;119;87m* First... (10s • 1k tokens • esc to interrupt)\x1b[0m\n" +
				strings.Repeat("Other\n", 20) +
				"\x1b[38;2;215;119;87m* Second... (20s • 2k tokens • esc to interrupt)\x1b[0m",
			expected:    true,
			description: "Should detect first activity when multiple exist",
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			result := monitor.detectClaudeActivity(tc.content)
			if result != tc.expected {
				t.Errorf("%s: Expected %v, got %v", tc.description, tc.expected, result)
			}
		})
	}
}
