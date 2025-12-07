package terraform

import (
	"fmt"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/exec"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
)

const stateBucketName = "fellspiral-terraform-state"

// CreateStateBucket creates the Terraform state bucket if it doesn't exist
func CreateStateBucket(projectID string) error {
	output.Info("Creating Terraform state bucket...")

	// Check if bucket exists
	bucketExists, _ := exec.RunQuiet(fmt.Sprintf(
		"gcloud storage buckets describe gs://%s --project=%s",
		stateBucketName, projectID))

	if bucketExists == "" {
		output.Info(fmt.Sprintf("Creating bucket gs://%s...", stateBucketName))

		// Create bucket
		if _, err := exec.Run(fmt.Sprintf(
			"gcloud storage buckets create gs://%s --project=%s --location=us-central1 --uniform-bucket-level-access",
			stateBucketName, projectID), true); err != nil {
			return fmt.Errorf("failed to create state bucket: %w", err)
		}

		// Enable versioning
		if _, err := exec.Run(fmt.Sprintf(
			"gcloud storage buckets update gs://%s --versioning",
			stateBucketName), true); err != nil {
			return fmt.Errorf("failed to enable versioning: %w", err)
		}

		output.Success("Terraform state bucket created with versioning enabled")
	} else {
		output.Info("Terraform state bucket already exists")
	}

	return nil
}
