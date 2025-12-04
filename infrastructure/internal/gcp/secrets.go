package gcp

import (
	"fmt"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/exec"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
)

// SetupGitHubTokenSecret creates or updates the GitHub API token secret
func SetupGitHubTokenSecret(projectID string) error {
	output.Info("Setting up GitHub API token secret...")
	secretName := "GITHUB_API_TOKEN"

	// Check if secret exists
	secretExists, _ := exec.RunQuiet(fmt.Sprintf("gcloud secrets describe %s --project=%s", secretName, projectID))

	if secretExists != "" {
		output.Info("GitHub API token secret already exists (not updating)")
		output.Info("To update the token manually:")
		output.Info(fmt.Sprintf(`  echo -n "token" | gcloud secrets versions add %s --data-file=- --project=%s`, secretName, projectID))
		return nil
	}

	output.Info("GitHub API token secret not found")
	output.Info("You can create it later with:")
	output.Info(fmt.Sprintf(`  gcloud secrets create %s --replication-policy="automatic" --project=%s`, secretName, projectID))
	output.Info(fmt.Sprintf(`  echo -n "token" | gcloud secrets versions add %s --data-file=-`, secretName))

	return nil
}
