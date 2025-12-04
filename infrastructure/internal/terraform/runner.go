package terraform

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/exec"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
)

// IsTerraformInstalled checks if terraform is installed
func IsTerraformInstalled() bool {
	return exec.CommandExists("terraform")
}

// Run executes the full Terraform workflow
func Run(autoApprove bool) error {
	output.Info("Running Terraform...")

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

	// Change to terraform directory
	originalDir, _ := os.Getwd()
	if err := os.Chdir(terraformDir); err != nil {
		return fmt.Errorf("failed to change to terraform directory: %w", err)
	}
	defer os.Chdir(originalDir)

	// Terraform init
	output.Info("Running terraform init...")
	if _, err := exec.Run("terraform init -reconfigure", false); err != nil {
		return fmt.Errorf("terraform init failed: %w", err)
	}
	output.Success("Terraform initialized")

	// Terraform validate
	output.Info("Running terraform validate...")
	result, err := exec.Run("terraform validate -no-color", true)
	if err != nil || (result != nil && result.ExitCode != 0) {
		return fmt.Errorf("terraform validate failed")
	}
	output.Success("Terraform configuration valid")

	// Terraform plan
	output.Info("Running terraform plan...")
	if _, err := exec.Run("terraform plan -no-color -out=tfplan", false); err != nil {
		return fmt.Errorf("terraform plan failed: %w", err)
	}
	output.Success("Terraform plan created")

	// Terraform apply
	output.Info("Running terraform apply...")
	applyCmd := "terraform apply tfplan"
	if !autoApprove {
		applyCmd = "terraform apply -no-color"
	}

	if _, err := exec.Run(applyCmd, false); err != nil {
		return fmt.Errorf("terraform apply failed: %w", err)
	}
	output.Success("Terraform applied successfully")

	return nil
}
