// workspace_root_test.go - Tests for modern project discovery
//
// These tests ensure that the application correctly handles project discovery
// from the current working directory without requiring ICF-specific workspace
// root detection. The modern approach uses dynamic project discovery that
// scans for directories containing files.

package app

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/rumor-ml/log/pkg/log"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestCurrentDirectoryUsage tests that the application can work from any directory
func TestCurrentDirectoryUsage(t *testing.T) {
	// Initialize logging for tests
	log.Get().WithComponent("test")

	// Save current working directory
	originalCwd, err := os.Getwd()
	require.NoError(t, err)
	defer os.Chdir(originalCwd)

	// Create temporary directory structure with some project-like directories
	tmpDir := t.TempDir()

	// Create some mock projects
	project1 := filepath.Join(tmpDir, "project1")
	project2 := filepath.Join(tmpDir, "subdir", "project2")

	require.NoError(t, os.MkdirAll(project1, 0755))
	require.NoError(t, os.MkdirAll(project2, 0755))

	// Add some files to make them look like projects
	require.NoError(t, os.WriteFile(filepath.Join(project1, "main.go"), []byte("package main"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(project2, "README.md"), []byte("# Project 2"), 0644))

	// Test that we can create an app from different working directories
	testCases := []struct {
		name       string
		workingDir string
	}{
		{
			name:       "from root temp directory",
			workingDir: tmpDir,
		},
		{
			name:       "from project1 directory",
			workingDir: project1,
		},
		{
			name:       "from nested project directory",
			workingDir: project2,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Note: ICF_WORKSPACE_ROOT is no longer used, discovery is based on git submodules

			// Change to test directory
			err := os.Chdir(tc.workingDir)
			require.NoError(t, err)

			// Test that we can create an app instance
			// (This tests the modern approach where discovery auto-detects current directory)
			app, err := New("")
			assert.NoError(t, err)
			assert.NotNil(t, app)

			// Test that the app has resolved the workspace root to current directory
			// Use EvalSymlinks to handle macOS /var -> /private/var symlink
			expectedResolved, _ := filepath.EvalSymlinks(tc.workingDir)
			actualResolved, _ := filepath.EvalSymlinks(app.workspaceRoot)
			assert.Equal(t, expectedResolved, actualResolved)
		})
	}
}
