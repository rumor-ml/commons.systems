// navigation_claude_integration.go - Claude status integration for navigation component

package ui

import (
	"context"
	"unicode"

	"github.com/natb1/tui/internal/status"
	"github.com/natb1/tui/pkg/model"
	"github.com/rumor-ml/log/pkg/log"
)

// NavigationClaudeIntegration handles Claude status integration for navigation component
type NavigationClaudeIntegration struct {
	claudeStatus *status.ClaudeStatusManager
	projects     []*model.Project
}

// NewNavigationClaudeIntegration creates a new Claude integration handler
func NewNavigationClaudeIntegration(claudeStatus *status.ClaudeStatusManager) *NavigationClaudeIntegration {
	return &NavigationClaudeIntegration{
		claudeStatus: claudeStatus,
	}
}

// StartClaudeMonitoring starts the Claude activity monitoring service
func (nci *NavigationClaudeIntegration) StartClaudeMonitoring(ctx context.Context) error {
	if nci.claudeStatus != nil {
		// Start the monitoring service
		if err := nci.claudeStatus.Start(ctx); err != nil {
			return err
		}

		// Don't subscribe to status updates here - it causes race conditions
		// The periodic tmux update will naturally pick up status changes

		return nil
	}
	return nil
}

// StopClaudeMonitoring stops the Claude activity monitoring service
func (nci *NavigationClaudeIntegration) StopClaudeMonitoring() {
	if nci.claudeStatus != nil {
		nci.claudeStatus.Stop()
	}
}

// GetClaudeStatusManager returns the ClaudeStatusManager for external configuration
func (nci *NavigationClaudeIntegration) GetClaudeStatusManager() *status.ClaudeStatusManager {
	return nci.claudeStatus
}

// SetProjects updates the projects reference for Alt key guessing context
func (nci *NavigationClaudeIntegration) SetProjects(projects []*model.Project) {
	nci.projects = projects
}

// guessAltCharacterFromContext attempts to guess which Alt+letter combination
// was pressed by looking at available project keybindings
func (nci *NavigationClaudeIntegration) guessAltCharacterFromContext(inputRune rune) rune {
	logger := log.Get()

	// For each available project keybinding, check if this rune could be Alt+letter
	// This is a heuristic-based approach for unmapped Alt combinations
	for _, project := range nci.projects {
		projKey := unicode.ToLower(project.KeyBinding)
		if projKey >= 'a' && projKey <= 'z' {
			logger.Info("Considering Alt combination for project",
				"inputRune", inputRune,
				"potentialChar", string(projKey),
				"project", project.Name)

			// If we see repeated patterns or have more context, we could be smarter here
			// For now, if this is the only valid key for this character position,
			// we'll guess it's the intended one
		}
	}

	// If we only have one project starting with a particular letter,
	// and we receive a high Unicode value, we could guess it's Alt+that letter
	// This is risky though, so we'll be conservative for now

	return 0 // Conservative: don't guess unless we're confident
}