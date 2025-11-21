// renderer.go - UI rendering methods and view generation
//
// ## Metadata
//
// TUI UI rendering engine for different layout modes and components.
//
// ### Purpose
//
// Handle all view rendering operations for different UI modes including terminal focus,
// assistant focus, and split view layouts while maintaining consistent styling and
// proper component coordination throughout the interface.
//
// ### Instructions
//
// #### Mode Rendering
//
// ##### Layout-Specific Rendering
//
// Implement mode-specific rendering functions that coordinate multiple components
// into cohesive layouts while respecting component boundaries and sizing requirements.
//
// ##### Component Integration
//
// Coordinate component rendering with proper styling, positioning, and size management
// to ensure consistent visual presentation across all interface modes.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing design patterns and component integration approaches
// that inform the rendering architecture and layout coordination.

package ui

import (
	"fmt"
	"strings"
)



// renderAssistantFocus renders assistant-focused mode
func (m *Manager) renderAssistantFocus() string {
	// SIMPLIFIED APPROACH: Build the layout manually line by line

	// Calculate dimensions
	totalWidth := m.width
	totalHeight := m.height
	if totalWidth == 0 {
		totalWidth = 120
	}
	if totalHeight == 0 {
		totalHeight = 40
	}

	// Build the complete view
	var lines []string

	// 1. LOGS SECTION (5 lines) - Get from logs component
	var logsContent string
	if logs, exists := m.components["logs"]; exists {
		if logsComp, ok := logs.(*LogsComponent); ok {
			logsComp.SetSize(totalWidth, 5)
		}
		logsContent = logs.(interface{ View() string }).View()
	}

	// Add logs lines (ensure exactly 5)
	logsLines := strings.Split(logsContent, "\n")
	for i := 0; i < 5; i++ {
		if i < len(logsLines) {
			line := logsLines[i]
			visualLen := visualLength(line)
			if visualLen < totalWidth {
				line = line + strings.Repeat(" ", totalWidth-visualLen)
			}
			// Don't truncate here - logs component handles truncation
			lines = append(lines, line)
		} else {
			lines = append(lines, strings.Repeat(" ", totalWidth))
		}
	}

	// 2. MAIN SECTION - This is simplified and handled in renderNavigationMode

	// 3. HELP SECTION (2 lines)
	if help, exists := m.components["help"]; exists {
		if helpComp, ok := help.(*HelpComponent); ok {
			helpComp.SetSize(totalWidth, 2)
		}
		helpView := help.(interface{ View() string }).View()
		helpLines := strings.Split(helpView, "\n")
		for i := 0; i < 2; i++ {
			if i < len(helpLines) {
				line := helpLines[i]
				if len(line) > totalWidth {
					line = line[:totalWidth]
				} else if len(line) < totalWidth {
					line = line + strings.Repeat(" ", totalWidth-len(line))
				}
				lines = append(lines, line)
			} else {
				// Add empty line if help doesn't have enough lines
				lines = append(lines, strings.Repeat(" ", totalWidth))
			}
		}
	} else {
		// Fallback help
		helpText := "^[key] claude • alt+[key] zsh • ^s screenshot • ^q quit"
		helpLines := strings.Split(helpText, "\n")
		for i := 0; i < 2; i++ {
			if i < len(helpLines) {
				line := helpLines[i]
				if len(line) > totalWidth {
					line = line[:totalWidth]
				} else if len(line) < totalWidth {
					line = line + strings.Repeat(" ", totalWidth-len(line))
				}
				lines = append(lines, line)
			} else {
				lines = append(lines, strings.Repeat(" ", totalWidth))
			}
		}
	}

	// Ensure we have exactly the right number of lines
	for len(lines) < totalHeight {
		lines = append(lines, strings.Repeat(" ", totalWidth))
	}
	if len(lines) > totalHeight {
		lines = lines[:totalHeight]
	}

	return strings.Join(lines, "\n")
}








// renderNavigationMode renders the navigation mode for project/dashboard/worktree selection
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (m *Manager) renderNavigationMode() string {
	width := m.width
	height := m.height
	if width <= 0 {
		width = 120
	}
	if height <= 0 {
		height = 40
	}

	var output []string

	// 1. LOGS SECTION (7 lines at top) - ALWAYS show logs FIRST
	// Get logs content from component
	if logs, exists := m.components["logs"]; exists {
		if logsComp, ok := logs.(*LogsComponent); ok {
			logsComp.SetSize(width, 7)
			logsContent := logsComp.View()

			// Split the content into lines
			logsLines := strings.Split(logsContent, "\n")

			// Take exactly 7 lines from the logs component
			for i := 0; i < 7; i++ {
				if i < len(logsLines) {
					// Ensure line uses full visual width
					// NOTE: Don't truncate here - logs component already handles truncation
					// We only need to pad if needed
					line := logsLines[i]
					visualLen := visualLength(line)
					if visualLen < width {
						line = line + strings.Repeat(" ", width-visualLen)
					}
					// If visual length exceeds width, something is wrong but don't truncate
					// as that would cut through ANSI codes and remove ellipses
					output = append(output, line)
				} else {
					output = append(output, strings.Repeat(" ", width))
				}
			}
		}
	} else {
		// If no logs component, add empty lines
		for i := 0; i < 7; i++ {
			output = append(output, strings.Repeat(" ", width))
		}
	}

	// 2. NAVIGATION SECTION (full width, main height)
	// Always reserve space for logs (7 lines), dev server (1 line), and help (2 lines)
	mainHeight := height - 10 // 7 for logs, 1 for dev server, 2 for help

	var navContent string
	if nav, exists := m.components["navigation"]; exists {
		if navComp, ok := nav.(*NavigationComponent); ok {
			navComp.SetSize(width, mainHeight)
		}
		navContent = nav.(interface{ View() string }).View()
	} else {
		// Default navigation content
		navContent = fmt.Sprintf("TUI Navigation - Window 1\n\n" +
			"Projects:\n" +
			"  i  assistant\n" +
			"  f  finance\n" +
			"  e  health\n" +
			"\n" +
			"Dashboards:\n" +
			"  d  status overview\n" +
			"\n" +
			"Worktrees:\n" +
			"  w  new worktree\n")
	}

	navLines := strings.Split(navContent, "\n")
	for i := 0; i < mainHeight; i++ {
		if i < len(navLines) {
			line := padToWidth(navLines[i], width)
			output = append(output, line)
		} else {
			output = append(output, strings.Repeat(" ", width))
		}
	}

	// 3. DEV SERVER STATUS (1 line)
	var devServerContent string
	if devServer, exists := m.components["devServerStatus"]; exists {
		if devComp, ok := devServer.(*DevServerStatusComponent); ok {
			devComp.SetSize(width, 1)
		}
		devServerContent = devServer.(interface{ View() string }).View()
	} else {
		devServerContent = "Dev Server: ⭕ Stopped | Path: / | Port: 8080"
	}

	// Ensure dev server line is padded to width
	devServerLine := padToWidth(devServerContent, width)
	output = append(output, devServerLine)

	// 4. HELP SECTION (2 lines at bottom)
	var helpContent string
	if help, exists := m.components["help"]; exists {
		if helpComp, ok := help.(*HelpComponent); ok {
			helpComp.SetSize(width, 2)

			// Get sequence status from navigation component
			hasSequence := false
			sequenceText := ""
			if nav, exists := m.components["navigation"]; exists {
				if navListComp, ok := nav.(*NavigationListComponent); ok {
					hasSequence, sequenceText = navListComp.GetSequenceStatus()
				}
			}

			helpContent = helpComp.ViewWithSequenceStatus(hasSequence, sequenceText)
		} else {
			helpContent = help.(interface{ View() string }).View()
		}
	} else {
		helpContent = "i(ssistant) f(cf) h(ealth) n(finance) → c(laude) z(sh) C/Z(+new) • ESC(cancel) • ^q(quit)"
	}

	// Split help content into lines and add them
	helpLines := strings.Split(helpContent, "\n")
	// Take exactly 2 lines for help section (no separator needed)
	for i := 0; i < 2 && i < len(helpLines); i++ {
		output = append(output, padToWidth(helpLines[i], width))
	}
	// Pad if we have fewer than 2 lines
	for len(helpLines) < 2 {
		output = append(output, strings.Repeat(" ", width))
	}

	// Ensure exactly the right number of lines
	for len(output) > height {
		output = output[:height]
	}
	for len(output) < height {
		output = append(output, strings.Repeat(" ", width))
	}

	// Return the complete view without modification
	return strings.Join(output, "\n")
}

// visualLength calculates the visual length of a string, ignoring ANSI escape codes
func visualLength(s string) int {
	length := 0
	inEscape := false
	for i := 0; i < len(s); i++ {
		if s[i] == '\x1b' && i+1 < len(s) && s[i+1] == '[' {
			inEscape = true
			i++ // skip '['
			continue
		}
		if inEscape {
			if s[i] == 'm' {
				inEscape = false
			}
			continue
		}
		length++
	}
	return length
}
