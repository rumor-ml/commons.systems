package persistence

import (
	"database/sql"
	"fmt"

	"github.com/rumor-ml/log/pkg/log"
	"github.com/rumor-ml/store/pkg/store"
)

// StatusRepository handles persistence of project and worktree status flags
type StatusRepository struct {
	base   *store.BaseStore
	logger log.Logger
}

// NewStatusRepository creates a new status repository with the given database path
func NewStatusRepository(dbPath string) (*StatusRepository, error) {
	// Create base store
	base, err := store.New(dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create base store: %w", err)
	}

	repo := &StatusRepository{
		base:   base,
		logger: log.Get().WithComponent("persistence"),
	}

	// Initialize our schema (separate from store module's schema)
	if err := repo.initSchema(); err != nil {
		base.Close()
		return nil, fmt.Errorf("failed to initialize schema: %w", err)
	}

	repo.logger.Debug("Status repository initialized", "db_path", dbPath)
	return repo, nil
}

// initSchema creates the necessary tables for status persistence
func (r *StatusRepository) initSchema() error {
	// Create project_status table
	_, err := r.base.DB().Exec(`
		CREATE TABLE IF NOT EXISTS project_status (
			project_path TEXT PRIMARY KEY,
			status TEXT NOT NULL,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create project_status table: %w", err)
	}

	// Create index on status for potential filtering
	_, err = r.base.DB().Exec(`
		CREATE INDEX IF NOT EXISTS idx_project_status_status ON project_status(status)
	`)
	if err != nil {
		return fmt.Errorf("failed to create project_status index: %w", err)
	}

	// Create worktree_status table
	_, err = r.base.DB().Exec(`
		CREATE TABLE IF NOT EXISTS worktree_status (
			project_path TEXT NOT NULL,
			worktree_id TEXT NOT NULL,
			status TEXT NOT NULL,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (project_path, worktree_id)
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create worktree_status table: %w", err)
	}

	// Create index on status for potential filtering
	_, err = r.base.DB().Exec(`
		CREATE INDEX IF NOT EXISTS idx_worktree_status_status ON worktree_status(status)
	`)
	if err != nil {
		return fmt.Errorf("failed to create worktree_status index: %w", err)
	}

	return nil
}

// SaveProjectStatus persists the status for a project
func (r *StatusRepository) SaveProjectStatus(projectPath, status string) error {
	_, err := r.base.DB().Exec(`
		INSERT OR REPLACE INTO project_status (project_path, status, updated_at)
		VALUES (?, ?, CURRENT_TIMESTAMP)
	`, projectPath, status)

	if err != nil {
		r.logger.Warn("Failed to save project status", "path", projectPath, "status", status, "error", err)
		return fmt.Errorf("failed to save project status: %w", err)
	}

	return nil
}

// LoadProjectStatus retrieves the status for a project
// Returns empty string if not found
func (r *StatusRepository) LoadProjectStatus(projectPath string) (string, error) {
	var status string
	err := r.base.DB().QueryRow(`
		SELECT status FROM project_status WHERE project_path = ?
	`, projectPath).Scan(&status)

	if err == sql.ErrNoRows {
		// Not found is not an error - return empty status
		return "", nil
	}

	if err != nil {
		return "", fmt.Errorf("failed to load project status: %w", err)
	}

	return status, nil
}

// LoadAllProjectStatuses retrieves all project statuses
// Returns a map of project path to status
func (r *StatusRepository) LoadAllProjectStatuses() (map[string]string, error) {
	rows, err := r.base.DB().Query(`
		SELECT project_path, status FROM project_status
	`)
	if err != nil {
		r.logger.Warn("Failed to load all project statuses", "error", err)
		return nil, fmt.Errorf("failed to load all project statuses: %w", err)
	}
	defer rows.Close()

	statuses := make(map[string]string)
	for rows.Next() {
		var path, status string
		if err := rows.Scan(&path, &status); err != nil {
			r.logger.Warn("Failed to scan project status row", "error", err)
			continue
		}
		statuses[path] = status
	}

	if err := rows.Err(); err != nil {
		r.logger.Warn("Error iterating project status rows", "error", err)
		return nil, fmt.Errorf("error iterating project status rows: %w", err)
	}

	// Removed: High-frequency DEBUG log (fires on every status load)
	return statuses, nil
}

// SaveWorktreeStatus persists the status for a worktree
func (r *StatusRepository) SaveWorktreeStatus(projectPath, worktreeID, status string) error {
	_, err := r.base.DB().Exec(`
		INSERT OR REPLACE INTO worktree_status (project_path, worktree_id, status, updated_at)
		VALUES (?, ?, ?, CURRENT_TIMESTAMP)
	`, projectPath, worktreeID, status)

	if err != nil {
		r.logger.Warn("Failed to save worktree status",
			"project_path", projectPath,
			"worktree_id", worktreeID,
			"status", status,
			"error", err)
		return fmt.Errorf("failed to save worktree status: %w", err)
	}

	return nil
}

// LoadWorktreeStatus retrieves the status for a worktree
// Returns empty string if not found
func (r *StatusRepository) LoadWorktreeStatus(projectPath, worktreeID string) (string, error) {
	var status string
	err := r.base.DB().QueryRow(`
		SELECT status FROM worktree_status
		WHERE project_path = ? AND worktree_id = ?
	`, projectPath, worktreeID).Scan(&status)

	if err == sql.ErrNoRows {
		// Not found is not an error - return empty status
		return "", nil
	}

	if err != nil {
		return "", fmt.Errorf("failed to load worktree status: %w", err)
	}

	return status, nil
}

// LoadAllWorktreeStatuses retrieves all worktree statuses
// Returns a nested map: project path -> worktree ID -> status
func (r *StatusRepository) LoadAllWorktreeStatuses() (map[string]map[string]string, error) {
	rows, err := r.base.DB().Query(`
		SELECT project_path, worktree_id, status FROM worktree_status
	`)
	if err != nil {
		r.logger.Warn("Failed to load all worktree statuses", "error", err)
		return nil, fmt.Errorf("failed to load all worktree statuses: %w", err)
	}
	defer rows.Close()

	statuses := make(map[string]map[string]string)
	for rows.Next() {
		var projectPath, worktreeID, status string
		if err := rows.Scan(&projectPath, &worktreeID, &status); err != nil {
			r.logger.Warn("Failed to scan worktree status row", "error", err)
			continue
		}

		if statuses[projectPath] == nil {
			statuses[projectPath] = make(map[string]string)
		}
		statuses[projectPath][worktreeID] = status
	}

	if err := rows.Err(); err != nil {
		r.logger.Warn("Error iterating worktree status rows", "error", err)
		return nil, fmt.Errorf("error iterating worktree status rows: %w", err)
	}

	// Removed: High-frequency DEBUG log (fires on every status load)
	return statuses, nil
}

// ClearProjectStatus removes the persisted status for a project
func (r *StatusRepository) ClearProjectStatus(projectPath string) error {
	_, err := r.base.DB().Exec(`
		DELETE FROM project_status WHERE project_path = ?
	`, projectPath)

	if err != nil {
		r.logger.Warn("Failed to clear project status", "path", projectPath, "error", err)
		return fmt.Errorf("failed to clear project status: %w", err)
	}

	r.logger.Debug("Cleared project status", "path", projectPath)
	return nil
}

// ClearWorktreeStatus removes the persisted status for a worktree
func (r *StatusRepository) ClearWorktreeStatus(projectPath, worktreeID string) error {
	_, err := r.base.DB().Exec(`
		DELETE FROM worktree_status WHERE project_path = ? AND worktree_id = ?
	`, projectPath, worktreeID)

	if err != nil {
		r.logger.Warn("Failed to clear worktree status",
			"project_path", projectPath,
			"worktree_id", worktreeID,
			"error", err)
		return fmt.Errorf("failed to clear worktree status: %w", err)
	}

	r.logger.Debug("Cleared worktree status",
		"project_path", projectPath,
		"worktree_id", worktreeID)
	return nil
}

// Close closes the underlying database connection
func (r *StatusRepository) Close() error {
	r.logger.Debug("Closing status repository")
	return r.base.Close()
}
