package ui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// BranchPicker is a simple interactive picker for selecting branches
type BranchPicker struct {
	branches []string
	selected int
	width    int
	height   int
}

var (
	pickerStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("63")).
			Padding(1, 2)

	selectedItemStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("0")).
				Background(lipgloss.Color("63")).
				Bold(true)

	normalItemStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("252"))

	titleStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("63")).
			Bold(true).
			MarginBottom(1)

	helpStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			MarginTop(1)
)

// NewBranchPicker creates a new branch picker
func NewBranchPicker(branches []string, width, height int) *BranchPicker {
	return &BranchPicker{
		branches: branches,
		selected: 0,
		width:    width,
		height:   height,
	}
}

// SetBranches updates the list of branches
func (p *BranchPicker) SetBranches(branches []string) {
	p.branches = branches
	if p.selected >= len(branches) {
		p.selected = len(branches) - 1
	}
	if p.selected < 0 {
		p.selected = 0
	}
}

// MoveUp moves the selection up
func (p *BranchPicker) MoveUp() {
	if p.selected > 0 {
		p.selected--
	}
}

// MoveDown moves the selection down
func (p *BranchPicker) MoveDown() {
	if p.selected < len(p.branches)-1 {
		p.selected++
	}
}

// Selected returns the currently selected branch
func (p *BranchPicker) Selected() string {
	if p.selected >= 0 && p.selected < len(p.branches) {
		return p.branches[p.selected]
	}
	return ""
}

// Render renders the picker as a string
func (p *BranchPicker) Render() string {
	if len(p.branches) == 0 {
		return pickerStyle.Render("No branches available")
	}

	var lines []string

	// Title (fit within 40 cols - 4 for border/padding = 36)
	title := "Block branch:"
	lines = append(lines, titleStyle.Render(title))

	// Branch list (limit visible items if too many)
	maxVisible := 8 // Reduced to fit better
	startIdx := 0
	endIdx := len(p.branches)

	if len(p.branches) > maxVisible {
		// Keep selected item in view
		if p.selected >= maxVisible/2 {
			startIdx = p.selected - maxVisible/2
		}
		endIdx = startIdx + maxVisible
		if endIdx > len(p.branches) {
			endIdx = len(p.branches)
			startIdx = endIdx - maxVisible
			if startIdx < 0 {
				startIdx = 0
			}
		}
	}

	// Max branch name length (40 cols - 4 border/padding - 2 for "> " = 34)
	maxBranchLen := 34
	for i := startIdx; i < endIdx; i++ {
		branch := p.branches[i]
		// Truncate if too long
		if len(branch) > maxBranchLen {
			branch = branch[:maxBranchLen-1] + "…"
		}
		if i == p.selected {
			lines = append(lines, selectedItemStyle.Render("> "+branch))
		} else {
			lines = append(lines, normalItemStyle.Render("  "+branch))
		}
	}

	// Help text (shortened to fit)
	lines = append(lines, helpStyle.Render("↑/k ↓/j ⏎:ok esc:✗"))

	content := strings.Join(lines, "\n")
	return pickerStyle.Width(36).Render(content)
}
