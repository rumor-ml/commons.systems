package terraform

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
)

// GenerateVars creates the terraform.tfvars file
func GenerateVars(projectID string) error {
	output.Info("Creating terraform.tfvars...")

	// Get the repository root
	currentDir, err := os.Getwd()
	if err != nil {
		return err
	}

	// Terraform directory is infrastructure/terraform
	terraformDir := filepath.Join(currentDir, "..", "..", "terraform")
	if _, err := os.Stat(terraformDir); os.IsNotExist(err) {
		// Try from infrastructure directory
		terraformDir = filepath.Join(currentDir, "terraform")
	}

	tfvarsPath := filepath.Join(terraformDir, "terraform.tfvars")

	content := fmt.Sprintf(`project_id  = "%s"
region      = "us-central1"
environment = "production"
`, projectID)

	if err := os.WriteFile(tfvarsPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write terraform.tfvars: %w", err)
	}

	output.Success("terraform.tfvars created")
	return nil
}
