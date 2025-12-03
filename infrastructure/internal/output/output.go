package output

import (
	"fmt"
	"strings"

	"github.com/fatih/color"
)

var (
	green  = color.New(color.FgGreen)
	yellow = color.New(color.FgYellow, color.Bold)
	blue   = color.New(color.FgBlue)
	red    = color.New(color.FgRed)
)

// Header prints a formatted header
func Header(text string) {
	line := strings.Repeat("=", 60)
	green.Printf("\n%s\n", line)
	green.Printf("%-60s\n", center(text, 60))
	green.Printf("%s\n\n", line)
}

// Step prints a step indicator
func Step(stepNum, totalSteps int, text string) {
	yellow.Printf("[%d/%d] %s\n", stepNum, totalSteps, text)
}

// Success prints a success message
func Success(text string) {
	green.Printf("  → %s\n", text)
}

// Info prints an info message
func Info(text string) {
	fmt.Printf("  → %s\n", text)
}

// Warning prints a warning message
func Warning(text string) {
	yellow.Printf("  ⚠ %s\n", text)
}

// Error prints an error message
func Error(text string) {
	red.Printf("Error: %s\n", text)
}

// BlueText prints blue text
func BlueText(text string) {
	blue.Println(text)
}

// YellowText prints yellow text
func YellowText(text string) {
	yellow.Println(text)
}

// center centers text within a given width
func center(text string, width int) string {
	if len(text) >= width {
		return text
	}
	padding := (width - len(text)) / 2
	return strings.Repeat(" ", padding) + text
}
