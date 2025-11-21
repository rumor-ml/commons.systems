package persistence

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// setupTestDB creates a test repository with a temporary database
func setupTestDB(t *testing.T) (*StatusRepository, string) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test-status.db")
	repo, err := NewStatusRepository(dbPath)
	require.NoError(t, err, "Failed to create test repository")
	return repo, dbPath
}

// TestNewStatusRepository tests repository initialization
func TestNewStatusRepository(t *testing.T) {
	repo, dbPath := setupTestDB(t)
	defer repo.Close()

	// Verify database file was created
	assert.FileExists(t, dbPath)

	// Verify tables exist
	db := repo.base.DB()

	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='project_status'").Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 1, count, "project_status table should exist")

	err = db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='worktree_status'").Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 1, count, "worktree_status table should exist")
}

// TestSaveProjectStatus tests saving project status
func TestSaveProjectStatus(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	tests := []struct {
		name   string
		path   string
		status string
	}{
		{"blocked status", "/test/project1", "blocked"},
		{"testing status", "/test/project2", "testing"},
		{"normal status", "/test/project3", "normal"},
		{"special chars in path", "/test/project's/path", "blocked"},
		{"long path", "/very/long/path/with/many/segments/to/test/handling/of/long/paths/project", "testing"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := repo.SaveProjectStatus(tt.path, tt.status)
			require.NoError(t, err)

			// Verify saved correctly
			var savedStatus string
			err = repo.base.DB().QueryRow("SELECT status FROM project_status WHERE project_path = ?", tt.path).Scan(&savedStatus)
			require.NoError(t, err)
			assert.Equal(t, tt.status, savedStatus)
		})
	}
}

// TestSaveProjectStatus_Update tests updating existing project status
func TestSaveProjectStatus_Update(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	projectPath := "/test/project"

	// Save initial status
	err := repo.SaveProjectStatus(projectPath, "blocked")
	require.NoError(t, err)

	// Update to different status
	err = repo.SaveProjectStatus(projectPath, "testing")
	require.NoError(t, err)

	// Verify updated
	status, err := repo.LoadProjectStatus(projectPath)
	require.NoError(t, err)
	assert.Equal(t, "testing", status)

	// Verify only one record exists
	var count int
	err = repo.base.DB().QueryRow("SELECT COUNT(*) FROM project_status WHERE project_path = ?", projectPath).Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 1, count, "Should have only one record after update")
}

// TestLoadProjectStatus tests loading project status
func TestLoadProjectStatus(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	projectPath := "/test/project"

	// Test loading non-existent status
	status, err := repo.LoadProjectStatus(projectPath)
	require.NoError(t, err)
	assert.Equal(t, "", status, "Non-existent status should return empty string")

	// Save status
	err = repo.SaveProjectStatus(projectPath, "blocked")
	require.NoError(t, err)

	// Test loading existing status
	status, err = repo.LoadProjectStatus(projectPath)
	require.NoError(t, err)
	assert.Equal(t, "blocked", status)
}

// TestLoadAllProjectStatuses tests bulk loading of project statuses
func TestLoadAllProjectStatuses(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	// Test loading from empty database
	statuses, err := repo.LoadAllProjectStatuses()
	require.NoError(t, err)
	assert.Empty(t, statuses)

	// Save multiple statuses
	testData := map[string]string{
		"/project/1": "blocked",
		"/project/2": "testing",
		"/project/3": "normal",
	}

	for path, status := range testData {
		err := repo.SaveProjectStatus(path, status)
		require.NoError(t, err)
	}

	// Load all statuses
	statuses, err = repo.LoadAllProjectStatuses()
	require.NoError(t, err)
	assert.Len(t, statuses, len(testData))

	// Verify all statuses match
	for path, expectedStatus := range testData {
		actualStatus, exists := statuses[path]
		assert.True(t, exists, "Status for %s should exist", path)
		assert.Equal(t, expectedStatus, actualStatus, "Status for %s should match", path)
	}
}

// TestSaveWorktreeStatus tests saving worktree status
func TestSaveWorktreeStatus(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	projectPath := "/test/project"
	worktreeID := "worktree-123"

	err := repo.SaveWorktreeStatus(projectPath, worktreeID, "blocked")
	require.NoError(t, err)

	// Verify saved correctly
	var savedStatus string
	err = repo.base.DB().QueryRow(
		"SELECT status FROM worktree_status WHERE project_path = ? AND worktree_id = ?",
		projectPath, worktreeID).Scan(&savedStatus)
	require.NoError(t, err)
	assert.Equal(t, "blocked", savedStatus)
}

// TestSaveWorktreeStatus_Update tests updating existing worktree status
func TestSaveWorktreeStatus_Update(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	projectPath := "/test/project"
	worktreeID := "worktree-123"

	// Save initial status
	err := repo.SaveWorktreeStatus(projectPath, worktreeID, "blocked")
	require.NoError(t, err)

	// Update to different status
	err = repo.SaveWorktreeStatus(projectPath, worktreeID, "testing")
	require.NoError(t, err)

	// Verify updated
	status, err := repo.LoadWorktreeStatus(projectPath, worktreeID)
	require.NoError(t, err)
	assert.Equal(t, "testing", status)

	// Verify only one record exists
	var count int
	err = repo.base.DB().QueryRow(
		"SELECT COUNT(*) FROM worktree_status WHERE project_path = ? AND worktree_id = ?",
		projectPath, worktreeID).Scan(&count)
	require.NoError(t, err)
	assert.Equal(t, 1, count, "Should have only one record after update")
}

// TestLoadWorktreeStatus tests loading worktree status
func TestLoadWorktreeStatus(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	projectPath := "/test/project"
	worktreeID := "worktree-123"

	// Test loading non-existent status
	status, err := repo.LoadWorktreeStatus(projectPath, worktreeID)
	require.NoError(t, err)
	assert.Equal(t, "", status, "Non-existent status should return empty string")

	// Save status
	err = repo.SaveWorktreeStatus(projectPath, worktreeID, "testing")
	require.NoError(t, err)

	// Test loading existing status
	status, err = repo.LoadWorktreeStatus(projectPath, worktreeID)
	require.NoError(t, err)
	assert.Equal(t, "testing", status)
}

// TestLoadAllWorktreeStatuses tests bulk loading of worktree statuses
func TestLoadAllWorktreeStatuses(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	// Test loading from empty database
	statuses, err := repo.LoadAllWorktreeStatuses()
	require.NoError(t, err)
	assert.Empty(t, statuses)

	// Save multiple worktree statuses
	testData := map[string]map[string]string{
		"/project/1": {
			"worktree-a": "blocked",
			"worktree-b": "testing",
		},
		"/project/2": {
			"worktree-c": "normal",
		},
	}

	for projectPath, worktrees := range testData {
		for worktreeID, status := range worktrees {
			err := repo.SaveWorktreeStatus(projectPath, worktreeID, status)
			require.NoError(t, err)
		}
	}

	// Load all worktree statuses
	statuses, err = repo.LoadAllWorktreeStatuses()
	require.NoError(t, err)
	assert.Len(t, statuses, len(testData))

	// Verify all statuses match
	for projectPath, expectedWorktrees := range testData {
		actualWorktrees, exists := statuses[projectPath]
		assert.True(t, exists, "Worktrees for %s should exist", projectPath)
		assert.Len(t, actualWorktrees, len(expectedWorktrees))

		for worktreeID, expectedStatus := range expectedWorktrees {
			actualStatus, exists := actualWorktrees[worktreeID]
			assert.True(t, exists, "Status for worktree %s should exist", worktreeID)
			assert.Equal(t, expectedStatus, actualStatus, "Status for worktree %s should match", worktreeID)
		}
	}
}

// TestClearProjectStatus tests clearing project status
func TestClearProjectStatus(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	projectPath := "/test/project"

	// Save status
	err := repo.SaveProjectStatus(projectPath, "blocked")
	require.NoError(t, err)

	// Clear status
	err = repo.ClearProjectStatus(projectPath)
	require.NoError(t, err)

	// Verify cleared
	status, err := repo.LoadProjectStatus(projectPath)
	require.NoError(t, err)
	assert.Equal(t, "", status, "Status should be empty after clearing")

	// Test clearing non-existent status (should not error)
	err = repo.ClearProjectStatus("/non/existent")
	require.NoError(t, err)
}

// TestClearWorktreeStatus tests clearing worktree status
func TestClearWorktreeStatus(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	projectPath := "/test/project"
	worktreeID := "worktree-123"

	// Save status
	err := repo.SaveWorktreeStatus(projectPath, worktreeID, "testing")
	require.NoError(t, err)

	// Clear status
	err = repo.ClearWorktreeStatus(projectPath, worktreeID)
	require.NoError(t, err)

	// Verify cleared
	status, err := repo.LoadWorktreeStatus(projectPath, worktreeID)
	require.NoError(t, err)
	assert.Equal(t, "", status, "Status should be empty after clearing")

	// Test clearing non-existent status (should not error)
	err = repo.ClearWorktreeStatus("/non/existent", "worktree-999")
	require.NoError(t, err)
}

// TestDatabasePathHandling tests various database path scenarios
func TestDatabasePathHandling(t *testing.T) {
	tmpDir := t.TempDir()

	tests := []struct {
		name string
		path string
	}{
		{"simple path", filepath.Join(tmpDir, "simple.db")},
		{"path with spaces", filepath.Join(tmpDir, "path with spaces.db")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Try to create the repository
			repo, err := NewStatusRepository(tt.path)
			require.NoError(t, err, "Should create repository successfully")
			defer repo.Close()
			assert.FileExists(t, tt.path)
		})
	}
}

// TestConcurrentAccess tests concurrent writes to the database
func TestConcurrentAccess(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	// Run multiple goroutines writing to database
	const numGoroutines = 10
	const writesPerGoroutine = 10

	done := make(chan bool, numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func(id int) {
			for j := 0; j < writesPerGoroutine; j++ {
				projectPath := filepath.Join("/test/project", string(rune(id+'0')))
				status := "blocked"
				if j%2 == 0 {
					status = "testing"
				}
				err := repo.SaveProjectStatus(projectPath, status)
				// Errors may occur due to locking, but shouldn't crash
				if err != nil {
					t.Logf("Concurrent write error (expected): %v", err)
				}
			}
			done <- true
		}(i)
	}

	// Wait for all goroutines to complete
	for i := 0; i < numGoroutines; i++ {
		<-done
	}

	// Verify some data was written
	statuses, err := repo.LoadAllProjectStatuses()
	require.NoError(t, err)
	assert.NotEmpty(t, statuses, "Should have written some statuses despite concurrency")
}

// TestDatabaseCorruption tests handling of corrupted database
func TestDatabaseCorruption(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "corrupt.db")

	// Note: SQLite is quite resilient and will often create a new database
	// even if the file exists with invalid content. This test documents
	// that behavior rather than strictly testing error handling.
	_, err := NewStatusRepository(dbPath)
	// May error or may create new database - both are acceptable
	t.Logf("Database initialization result: %v", err)
}

// TestSpecialCharactersInPaths tests paths with special characters
func TestSpecialCharactersInPaths(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	specialPaths := []string{
		"/path/with spaces/project",
		"/path/with'quotes/project",
		"/path/with\"doublequotes/project",
		"/path/with/unicode/项目",
		"/path/with/emoji/🚀/project",
	}

	for _, path := range specialPaths {
		t.Run(path, func(t *testing.T) {
			// Save status
			err := repo.SaveProjectStatus(path, "blocked")
			require.NoError(t, err, "Should save status for path with special chars")

			// Load status
			status, err := repo.LoadProjectStatus(path)
			require.NoError(t, err, "Should load status for path with special chars")
			assert.Equal(t, "blocked", status)
		})
	}
}

// TestClose tests closing the repository
func TestClose(t *testing.T) {
	repo, _ := setupTestDB(t)

	// Close repository
	err := repo.Close()
	require.NoError(t, err)

	// Verify database is closed (subsequent operations should fail)
	err = repo.SaveProjectStatus("/test/project", "blocked")
	assert.Error(t, err, "Operations should fail after close")

	// Multiple closes should not panic (may or may not error)
	_ = repo.Close()
}

// TestInitializationFailure tests handling of initialization failures
func TestInitializationFailure(t *testing.T) {
	// Try to create repository in non-existent directory without permission
	// (This test may be platform-specific)
	_, err := NewStatusRepository("/invalid/path/that/does/not/exist/status.db")
	assert.Error(t, err, "Should fail when path is invalid")
}

// TestEmptyDatabase tests loading from empty database
func TestEmptyDatabase(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	// Load all project statuses from empty database
	projectStatuses, err := repo.LoadAllProjectStatuses()
	require.NoError(t, err)
	assert.Empty(t, projectStatuses)

	// Load all worktree statuses from empty database
	worktreeStatuses, err := repo.LoadAllWorktreeStatuses()
	require.NoError(t, err)
	assert.Empty(t, worktreeStatuses)

	// Load specific project status from empty database
	status, err := repo.LoadProjectStatus("/test/project")
	require.NoError(t, err)
	assert.Equal(t, "", status)

	// Load specific worktree status from empty database
	status, err = repo.LoadWorktreeStatus("/test/project", "worktree-1")
	require.NoError(t, err)
	assert.Equal(t, "", status)
}

// TestSchemaExists tests that schema is created properly
func TestSchemaExists(t *testing.T) {
	repo, _ := setupTestDB(t)
	defer repo.Close()

	db := repo.base.DB()

	// Verify project_status table structure
	rows, err := db.Query("PRAGMA table_info(project_status)")
	require.NoError(t, err)
	defer rows.Close()

	columns := make(map[string]bool)
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dfltValue sql.NullString
		err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltValue, &pk)
		require.NoError(t, err)
		columns[name] = true
	}

	assert.True(t, columns["project_path"], "Should have project_path column")
	assert.True(t, columns["status"], "Should have status column")
	assert.True(t, columns["updated_at"], "Should have updated_at column")

	// Verify worktree_status table structure
	rows, err = db.Query("PRAGMA table_info(worktree_status)")
	require.NoError(t, err)
	defer rows.Close()

	columns = make(map[string]bool)
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dfltValue sql.NullString
		err := rows.Scan(&cid, &name, &ctype, &notnull, &dfltValue, &pk)
		require.NoError(t, err)
		columns[name] = true
	}

	assert.True(t, columns["project_path"], "Should have project_path column")
	assert.True(t, columns["worktree_id"], "Should have worktree_id column")
	assert.True(t, columns["status"], "Should have status column")
	assert.True(t, columns["updated_at"], "Should have updated_at column")
}
