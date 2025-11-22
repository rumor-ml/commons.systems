package ui

import (
	"fmt"
	"os"
	"testing"

	"github.com/charmbracelet/lipgloss"
)

func TestClaudeDiagnostic(t *testing.T) {
	fmt.Println("\n=== CLAUDE HIGHLIGHTING DIAGNOSTIC ===")

	// 1. Check environment
	fmt.Println("1. ENVIRONMENT:")
	fmt.Printf("   TERM=%s\n", os.Getenv("TERM"))
	fmt.Printf("   COLORTERM=%s\n", os.Getenv("COLORTERM"))
	fmt.Printf("   CLICOLOR=%s\n", os.Getenv("CLICOLOR"))
	fmt.Printf("   CLICOLOR_FORCE=%s\n", os.Getenv("CLICOLOR_FORCE"))
	fmt.Printf("   NO_COLOR=%s\n", os.Getenv("NO_COLOR"))
	fmt.Printf("   Is TTY: %v\n", isatty())

	// 2. Test lipgloss color output
	fmt.Println("\n2. LIPGLOSS COLOR TEST:")
	orangeStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("208"))
	testText := "TEST"
	styled := orangeStyle.Render(testText)
	fmt.Printf("   Plain text: %q\n", testText)
	fmt.Printf("   Styled text: %q\n", styled)
	fmt.Printf("   Has ANSI codes: %v\n", styled != testText)

	// 3. Manual ANSI test
	fmt.Println("\n3. MANUAL ANSI TEST:")
	fmt.Printf("   Normal: TEST\n")
	fmt.Printf("   Orange: \x1b[38;5;208mTEST\x1b[0m\n")
	fmt.Printf("   If you see orange text above, your terminal supports colors\n")

	// 4. What the Claude line should look like
	fmt.Println("\n4. EXPECTED CLAUDE LINE:")
	fmt.Printf("   Without highlight: │ 🤖 Claude: Claude Shell\n")
	fmt.Printf("   With highlight: │ \x1b[38;5;208m🤖 Claude\x1b[0m: Claude Shell\n")

	fmt.Println("\n5. RECOMMENDATIONS:")
	if styled == testText {
		fmt.Println("   ⚠️  Lipgloss is NOT outputting color codes")
		fmt.Println("   Try running the app with: CLICOLOR_FORCE=1 go run main.go")
	} else {
		fmt.Println("   ✓ Lipgloss IS outputting color codes")
		fmt.Println("   Claude panes should appear orange in the TUI")
	}

	fmt.Println("\n=====================================")
}

// Simple TTY check
func isatty() bool {
	// This is a simplified check
	fi, _ := os.Stdout.Stat()
	return (fi.Mode() & os.ModeCharDevice) != 0
}
