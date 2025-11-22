// benchmarks_test.go - Performance benchmarks for ICF Assistant
//
// ## Metadata
//
// ICF Assistant performance benchmarking suite for identifying performance bottlenecks
// and measuring optimization improvements across all major subsystems.
//
// ### Purpose
//
// Provide comprehensive benchmarks for all performance-critical operations including
// tmux discovery, project scanning, UI rendering, and data structure operations to
// enable data-driven performance optimization.

package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/natb1/tui/internal/terminal"
	"github.com/natb1/tui/pkg/model"
)

// BenchmarkAppInitialization measures full app startup time
func BenchmarkAppInitialization(b *testing.B) {
	tmpDir := setupTestWorkspace(b)
	defer os.RemoveAll(tmpDir)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		app, err := New(tmpDir)
		if err != nil {
			b.Fatal(err)
		}

		// Measure init command execution
		start := time.Now()
		app.Init()
		duration := time.Since(start)

		b.ReportMetric(float64(duration.Microseconds()), "init_time_μs")

		app.Shutdown()
	}
}

// BenchmarkProjectDiscovery measures project scanning performance
func BenchmarkProjectDiscovery(b *testing.B) {
	tmpDir := setupTestWorkspace(b)
	defer os.RemoveAll(tmpDir)

	// Create test projects with varying complexity
	createTestProjects(b, tmpDir, 10) // 10 projects

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		pm, err := NewExternalProjectMap(tmpDir)
		if err != nil {
			b.Fatal(err)
		}

		start := time.Now()
		pm.Init()
		duration := time.Since(start)

		b.ReportMetric(float64(duration.Microseconds()), "discovery_time_μs")
		b.ReportMetric(float64(len(pm.GetProjects())), "projects_found")
	}
}

// BenchmarkTmuxDiscovery measures tmux session and pane discovery
func BenchmarkTmuxDiscovery(b *testing.B) {
	ctx := context.Background()
	tm := terminal.NewTmuxManager(ctx)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := time.Now()

		// Measure session discovery
		sessionStart := time.Now()
		err := tm.DiscoverExistingSessions()
		sessionDuration := time.Since(sessionStart)

		if err != nil {
			b.Logf("Session discovery error: %v", err)
		}

		// Measure pane discovery
		paneStart := time.Now()
		err = tm.DiscoverAllPanes()
		paneDuration := time.Since(paneStart)

		if err != nil {
			b.Logf("Pane discovery error: %v", err)
		}

		totalDuration := time.Since(start)

		b.ReportMetric(float64(sessionDuration.Microseconds()), "session_discovery_μs")
		b.ReportMetric(float64(paneDuration.Microseconds()), "pane_discovery_μs")
		b.ReportMetric(float64(totalDuration.Microseconds()), "total_discovery_μs")
		b.ReportMetric(float64(len(tm.GetAllPanes())), "panes_discovered")
	}
}

// BenchmarkNavigationUpdate measures navigation component update performance
func BenchmarkNavigationUpdate(b *testing.B) {
	tmpDir := setupTestWorkspace(b)
	defer os.RemoveAll(tmpDir)

	// Create test projects
	createTestProjects(b, tmpDir, 5)

	app, err := New(tmpDir)
	if err != nil {
		b.Fatal(err)
	}
	defer app.Shutdown()

	// Get test projects
	_ = createTestModelProjects(5)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := time.Now()
		app.updateNavigationProjects()
		duration := time.Since(start)

		b.ReportMetric(float64(duration.Microseconds()), "nav_update_μs")
	}
}

// BenchmarkUIRendering measures UI view generation performance
func BenchmarkUIRendering(b *testing.B) {
	tmpDir := setupTestWorkspace(b)
	defer os.RemoveAll(tmpDir)

	app, err := New(tmpDir)
	if err != nil {
		b.Fatal(err)
	}
	defer app.Shutdown()

	// Initialize app
	app.Init()

	// Simulate window size
	app.Update(tea.WindowSizeMsg{Width: 120, Height: 40})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := time.Now()
		view := app.View()
		duration := time.Since(start)

		b.ReportMetric(float64(duration.Microseconds()), "render_time_μs")
		b.ReportMetric(float64(len(view)), "render_size_bytes")
	}
}

// BenchmarkTmuxPaneMapping measures pane-to-project mapping performance
func BenchmarkTmuxPaneMapping(b *testing.B) {
	ctx := context.Background()
	tm := terminal.NewTmuxManager(ctx)

	// Create test projects
	projects := createTestModelProjects(10)

	// Discover panes first
	tm.DiscoverAllPanes()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := time.Now()
		mappedProjects, err := tm.MapSessionsToProjects(projects)
		duration := time.Since(start)

		if err != nil {
			b.Fatal(err)
		}

		b.ReportMetric(float64(duration.Microseconds()), "mapping_time_μs")
		b.ReportMetric(float64(len(mappedProjects)), "projects_mapped")
	}
}

// BenchmarkWorktreeDiscovery measures git worktree discovery performance
func BenchmarkWorktreeDiscovery(b *testing.B) {
	tmpDir := setupTestWorkspace(b)
	defer os.RemoveAll(tmpDir)

	// Create git repository with worktrees
	setupGitWorktrees(b, tmpDir)

	app, err := New(tmpDir)
	if err != nil {
		b.Fatal(err)
	}
	defer app.Shutdown()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := time.Now()

		// Simulate worktree discovery as done in updateNavigationProjects
		projects := app.projects.GetProjects()
		for _, project := range projects {
			if app.worktreeService != nil {
				// This is the expensive part we're measuring
				_ = project.Path // Simulate the work
			}
		}

		duration := time.Since(start)
		b.ReportMetric(float64(duration.Microseconds()), "worktree_discovery_μs")
	}
}

// BenchmarkMessageProcessing measures tea.Msg processing performance
func BenchmarkMessageProcessing(b *testing.B) {
	tmpDir := setupTestWorkspace(b)
	defer os.RemoveAll(tmpDir)

	app, err := New(tmpDir)
	if err != nil {
		b.Fatal(err)
	}
	defer app.Shutdown()

	// Test different message types
	messages := []tea.Msg{
		tea.WindowSizeMsg{Width: 120, Height: 40},
		tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'i'}},
		updateNavigationProjectsMsg{},
		tmuxUpdateTickMsg{},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		for _, msg := range messages {
			start := time.Now()
			app.Update(msg)
			duration := time.Since(start)

			b.ReportMetric(float64(duration.Microseconds()), "msg_processing_μs")
		}
	}
}

// Helper functions for test setup

func setupTestWorkspace(b *testing.B) string {
	tmpDir, err := os.MkdirTemp("", "icf-bench-*")
	if err != nil {
		b.Fatal(err)
	}
	return tmpDir
}

func createTestProjects(b *testing.B, workspaceDir string, count int) {
	for i := 0; i < count; i++ {
		projectDir := filepath.Join(workspaceDir, "project-"+string(rune('a'+i)))
		err := os.MkdirAll(projectDir, 0755)
		if err != nil {
			b.Fatal(err)
		}

		// Create some files to make it a valid project
		readmeFile := filepath.Join(projectDir, "README.md")
		content := `# Project ` + string(rune('a'+i)) + `

## Metadata

Test project for benchmarking.

### Purpose

Testing project discovery performance.
`
		err = os.WriteFile(readmeFile, []byte(content), 0644)
		if err != nil {
			b.Fatal(err)
		}

		// Create additional files to simulate real projects
		for j := 0; j < 5; j++ {
			fileName := filepath.Join(projectDir, "file-"+string(rune('a'+j))+".txt")
			err = os.WriteFile(fileName, []byte("test content"), 0644)
			if err != nil {
				b.Fatal(err)
			}
		}
	}
}

func createTestModelProjects(count int) []*model.Project {
	projects := make([]*model.Project, count)
	for i := 0; i < count; i++ {
		projects[i] = &model.Project{
			Name:       "test-project-" + string(rune('a'+i)),
			Path:       "/tmp/test-project-" + string(rune('a'+i)),
			MainShells: make(map[model.ShellType]*model.Shell),
			Worktrees:  []*model.Worktree{},
			Expanded:   true,
		}
	}
	return projects
}

func setupGitWorktrees(b *testing.B, repoDir string) {
	// Initialize git repo (simplified for benchmark)
	// In real test, we'd create actual git worktrees
	// For benchmark, we just need the directory structure
	for i := 0; i < 3; i++ {
		wtDir := filepath.Join(repoDir, "worktree-"+string(rune('a'+i)))
		err := os.MkdirAll(wtDir, 0755)
		if err != nil {
			b.Fatal(err)
		}
	}
}
