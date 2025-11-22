// pane_registry.go - Pane registry for stable pane-to-project mappings

package terminal

import (
	"sort"
	"sync"
	"time"

	"github.com/natb1/tui/pkg/model"
)

// PaneRegistryEntry tracks the original project association and metadata for a pane
type PaneRegistryEntry struct {
	PaneTarget      string          // tmux pane target (session:window.pane)
	OriginalProject *model.Project  // project when first discovered
	OriginalPath    string          // working directory when first discovered
	FirstSeen       time.Time       // when pane was first discovered
	LastActive      time.Time       // when pane was last active/focused
	ShellType       model.ShellType // shell type (claude, zsh, etc)
}

// PaneRegistry maintains stable pane-to-project mappings during TUI session
type PaneRegistry struct {
	entries map[string]*PaneRegistryEntry // pane target -> registry entry
	mutex   sync.RWMutex
}

// NewPaneRegistry creates a new pane registry
func NewPaneRegistry() *PaneRegistry {
	return &PaneRegistry{
		entries: make(map[string]*PaneRegistryEntry),
	}
}

// Register adds or updates a pane in the registry
func (r *PaneRegistry) Register(pane *TmuxPane, project *model.Project) {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	target := pane.GetTmuxTarget()

	if entry, exists := r.entries[target]; exists {
		// Update existing entry
		entry.LastActive = pane.LastActivity
		if pane.Active {
			entry.LastActive = time.Now()
		}
	} else {
		// Create new entry
		r.entries[target] = &PaneRegistryEntry{
			PaneTarget:      target,
			OriginalProject: project,
			OriginalPath:    pane.CurrentPath,
			FirstSeen:       time.Now(),
			LastActive:      pane.LastActivity,
			ShellType:       pane.ShellType,
		}
	}
}

// GetEntry retrieves a registry entry for a pane
func (r *PaneRegistry) GetEntry(paneTarget string) (*PaneRegistryEntry, bool) {
	r.mutex.RLock()
	defer r.mutex.RUnlock()

	entry, exists := r.entries[paneTarget]
	return entry, exists
}

// GetProjectPanes returns all panes registered for a specific project
func (r *PaneRegistry) GetProjectPanes(project *model.Project, shellType model.ShellType) []*PaneRegistryEntry {
	r.mutex.RLock()
	defer r.mutex.RUnlock()

	var result []*PaneRegistryEntry
	for _, entry := range r.entries {
		if entry.OriginalProject != nil &&
			entry.OriginalProject.Path == project.Path &&
			entry.ShellType == shellType {
			result = append(result, entry)
		}
	}

	// Sort by priority: most recently active first, then by first seen
	sort.Slice(result, func(i, j int) bool {
		// If one was active in the last minute, prefer it
		now := time.Now()
		iRecent := now.Sub(result[i].LastActive) < time.Minute
		jRecent := now.Sub(result[j].LastActive) < time.Minute

		if iRecent != jRecent {
			return iRecent
		}

		// Otherwise, prefer the one that was active more recently
		if !result[i].LastActive.Equal(result[j].LastActive) {
			return result[i].LastActive.After(result[j].LastActive)
		}

		// Finally, prefer the one created first (stable ordering)
		return result[i].FirstSeen.Before(result[j].FirstSeen)
	})

	return result
}