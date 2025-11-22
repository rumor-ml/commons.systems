package terminal

import (
	"strings"
	"testing"
)

// BenchmarkClaudeActivityDetection benchmarks the Claude activity detection performance
func BenchmarkClaudeActivityDetection(b *testing.B) {
	// Create a mock TmuxExecutor (nil is fine for activity detection benchmarks)
	monitor := NewClaudeMonitor(nil)

	// Test content that will be detected as active
	activeContent := `Some output
\x1b[38;2;215;119;87m* Thinking... (45s • 2.1k tokens • esc to interrupt)\x1b[0m
More output`

	// Test content that will be detected as inactive
	inactiveContent := `Some output
Regular terminal content
$ ls -la
More regular output`

	// Mixed content with multiple lines
	mixedContent := strings.Repeat("Regular line\n", 25) + 
		`\x1b[38;2;215;119;87m✳ Crafting… (535s · 18.7k tokens · esc to interrupt)\x1b[0m` + 
		strings.Repeat("\nMore content", 25)

	b.Run("Active Content Detection", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = monitor.detectClaudeActivity(activeContent)
		}
	})

	b.Run("Inactive Content Detection", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = monitor.detectClaudeActivity(inactiveContent)
		}
	})

	b.Run("Large Mixed Content Detection", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = monitor.detectClaudeActivity(mixedContent)
		}
	})

	b.Run("Activity With Duration Extraction", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = monitor.detectClaudeActivityWithDuration(activeContent)
		}
	})
}

// BenchmarkRegexPerformance benchmarks the individual regex patterns
func BenchmarkRegexPerformance(b *testing.B) {
	testLine := `\x1b[38;2;215;119;87m* Thinking... (45s • 2.1k tokens • esc to interrupt)\x1b[0m`

	b.Run("Timing Pattern Regex", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = timingPattern.MatchString(testLine)
		}
	})

	b.Run("Duration Before Pattern Regex", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = durationBeforePattern.FindStringSubmatch(testLine)
		}
	})

	b.Run("Duration After Pattern Regex", func(b *testing.B) {
		testLineAfter := `· Working… (esc to interrupt · 45s)`
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = durationAfterPattern.FindStringSubmatch(testLineAfter)
		}
	})
}

// BenchmarkMultiplePaneDetection simulates monitoring multiple panes
func BenchmarkMultiplePaneDetection(b *testing.B) {
	// Create a mock TmuxExecutor (nil is fine for activity detection benchmarks)
	monitor := NewClaudeMonitor(nil)

	// Simulate content from 10 different panes
	paneContents := make([]string, 10)
	for i := range paneContents {
		if i%3 == 0 {
			// Every 3rd pane has active Claude
			paneContents[i] = `\x1b[38;2;215;119;87m* Working... (30s • 1.5k tokens • esc to interrupt)\x1b[0m`
		} else {
			// Other panes have regular content
			paneContents[i] = strings.Repeat("Regular terminal line\n", 10)
		}
	}

	b.Run("10 Panes Detection", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			for _, content := range paneContents {
				_ = monitor.detectClaudeActivity(content)
			}
		}
	})

	b.Run("50 Panes Detection", func(b *testing.B) {
		// Extend to 50 panes
		largePaneContents := make([]string, 50)
		for i := range largePaneContents {
			largePaneContents[i] = paneContents[i%10]
		}
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			for _, content := range largePaneContents {
				_ = monitor.detectClaudeActivity(content)
			}
		}
	})
}