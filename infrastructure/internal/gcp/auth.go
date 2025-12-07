package gcp

import (
	"fmt"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/exec"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
)

// Authenticate checks if user is authenticated to GCP and prompts for login if not
func Authenticate() error {
	output.Header("GCP Authentication")

	activeAccount, err := exec.RunQuiet(`gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1`)
	if err != nil || activeAccount == "" {
		output.Info("Not authenticated. Opening browser for authentication...")
		if _, err := exec.Run("gcloud auth login", false); err != nil {
			return fmt.Errorf("authentication failed: %w", err)
		}

		// Get the active account after login
		result, err := exec.Run(`gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1`, true)
		if err != nil {
			return fmt.Errorf("failed to get active account: %w", err)
		}
		activeAccount = result.Stdout
	}

	output.Success(fmt.Sprintf("Authenticated as: %s", activeAccount))
	return nil
}

// IsGCloudInstalled checks if gcloud CLI is installed
func IsGCloudInstalled() bool {
	return exec.CommandExists("gcloud")
}

// GetDefaultProject gets the default project from gcloud config
func GetDefaultProject() (string, error) {
	projectID, err := exec.RunQuiet("gcloud config get-value project")
	if err != nil {
		return "", err
	}
	return projectID, nil
}
