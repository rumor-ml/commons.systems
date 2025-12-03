package github

import (
	"fmt"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/exec"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
)

// SetupSecrets creates GitHub repository secrets using gh CLI
func SetupSecrets(projectID, repoOwner, repoName, wifProvider, saEmail string) error {
	// Check if gh CLI is available and authenticated
	if !exec.CommandExists("gh") {
		return fmt.Errorf("gh CLI not installed")
	}

	authStatus, err := exec.Run("gh auth status 2>&1", true)
	if err != nil || authStatus.Stdout == "" || authStatus.ExitCode != 0 {
		return fmt.Errorf("gh CLI not authenticated")
	}

	output.Info("Creating GitHub secrets...")
	repoFull := fmt.Sprintf("%s/%s", repoOwner, repoName)

	// Create GCP_PROJECT_ID secret
	if _, err := exec.RunWithInput(
		fmt.Sprintf("gh secret set GCP_PROJECT_ID -R %s 2>&1", repoFull),
		projectID); err != nil {
		return fmt.Errorf("failed to create GCP_PROJECT_ID secret: %w", err)
	}

	// Create GCP_WORKLOAD_IDENTITY_PROVIDER secret
	if _, err := exec.RunWithInput(
		fmt.Sprintf("gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER -R %s 2>&1", repoFull),
		wifProvider); err != nil {
		return fmt.Errorf("failed to create GCP_WORKLOAD_IDENTITY_PROVIDER secret: %w", err)
	}

	// Create GCP_SERVICE_ACCOUNT secret
	if _, err := exec.RunWithInput(
		fmt.Sprintf("gh secret set GCP_SERVICE_ACCOUNT -R %s 2>&1", repoFull),
		saEmail); err != nil {
		return fmt.Errorf("failed to create GCP_SERVICE_ACCOUNT secret: %w", err)
	}

	output.Success("GitHub secrets created successfully!")
	return nil
}

// ShowManualInstructions displays manual instructions for creating GitHub secrets
func ShowManualInstructions(projectID, repoOwner, repoName, wifProvider, saEmail string) {
	output.Info("")
	output.BlueText("GitHub Secrets Configuration:")
	output.Info(fmt.Sprintf("Go to: https://github.com/%s/%s/settings/secrets/actions", repoOwner, repoName))
	output.Info("")
	output.Info("Add these secrets:")

	output.Info("")
	output.YellowText("Secret 1: GCP_PROJECT_ID")
	fmt.Println(projectID)

	output.Info("")
	output.YellowText("Secret 2: GCP_WORKLOAD_IDENTITY_PROVIDER")
	fmt.Println(wifProvider)

	output.Info("")
	output.YellowText("Secret 3: GCP_SERVICE_ACCOUNT")
	fmt.Println(saEmail)

	output.Info("")
	output.BlueText("Next Steps:")
	output.Info("1. Add the 3 secrets above to GitHub")
	output.Info("2. Push changes to trigger the Infrastructure as Code workflow:")
	output.Info("   git push origin your-branch")
	output.Info("3. The IaC workflow will automatically:")
	output.Info("   - Create Terraform state bucket")
	output.Info("   - Run Terraform to create infrastructure (buckets, CDN, IAM roles)")
	output.Info("   - Deploy the main site")
	output.Info("   - Deploy the CI logs proxy (if on proxy branch)")
}
