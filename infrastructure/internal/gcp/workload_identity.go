package gcp

import (
	"fmt"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/exec"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
)

// SetupWorkloadIdentity creates Workload Identity Federation pool and provider
func SetupWorkloadIdentity(projectID, repoOwner, repoName string) (string, error) {
	output.Step(2, 5, "Setting up Workload Identity Federation...")

	// Get project number
	result, err := exec.Run(fmt.Sprintf(`gcloud projects describe %s --format="value(projectNumber)"`, projectID), true)
	if err != nil {
		return "", fmt.Errorf("failed to get project number: %w", err)
	}
	projectNumber := result.Stdout

	poolName := "github-actions"
	providerName := "github"

	// Create Workload Identity Pool
	poolExists, _ := exec.RunQuiet(fmt.Sprintf(
		"gcloud iam workload-identity-pools describe %s --location=global --project=%s",
		poolName, projectID))

	if poolExists == "" {
		if _, err := exec.Run(fmt.Sprintf(
			`gcloud iam workload-identity-pools create %s --location=global --project=%s --display-name="GitHub Actions Pool" --quiet`,
			poolName, projectID), true); err != nil {
			return "", fmt.Errorf("failed to create workload identity pool: %w", err)
		}
		output.Success("Workload Identity Pool created")
	} else {
		output.Info("Pool already exists")
	}

	// Create Workload Identity Provider
	providerExists, _ := exec.RunQuiet(fmt.Sprintf(
		"gcloud iam workload-identity-pools providers describe %s --workload-identity-pool=%s --location=global --project=%s",
		providerName, poolName, projectID))

	attributeCondition := fmt.Sprintf("assertion.repository=='%s/%s'", repoOwner, repoName)

	if providerExists == "" {
		if _, err := exec.Run(fmt.Sprintf(
			`gcloud iam workload-identity-pools providers create-oidc %s --workload-identity-pool=%s --location=global --project=%s --issuer-uri="https://token.actions.githubusercontent.com" --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" --attribute-condition="%s" --quiet`,
			providerName, poolName, projectID, attributeCondition), true); err != nil {
			return "", fmt.Errorf("failed to create workload identity provider: %w", err)
		}
		output.Success("Workload Identity Provider created")
	} else {
		output.Info("Provider already exists")
		// Update the attribute condition to match the current repository
		output.Info("Updating provider attribute condition...")
		exec.Run(fmt.Sprintf(
			`gcloud iam workload-identity-pools providers update-oidc %s --workload-identity-pool=%s --location=global --project=%s --attribute-condition="%s" --quiet`,
			providerName, poolName, projectID, attributeCondition), true)
		output.Success("Provider updated with correct repository condition")
	}

	// Return workload identity provider path
	wifProvider := fmt.Sprintf("projects/%s/locations/global/workloadIdentityPools/%s/providers/%s",
		projectNumber, poolName, providerName)

	return wifProvider, nil
}
