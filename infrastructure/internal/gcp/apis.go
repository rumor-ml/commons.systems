package gcp

import (
	"fmt"
	"strings"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/exec"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
)

var requiredAPIs = []string{
	"compute.googleapis.com",
	"storage.googleapis.com",
	"cloudresourcemanager.googleapis.com",
	"run.googleapis.com",
	"artifactregistry.googleapis.com",
	"secretmanager.googleapis.com",
	"iam.googleapis.com",
	"iamcredentials.googleapis.com",
	"sts.googleapis.com",
	"firebase.googleapis.com",
	"firebaserules.googleapis.com",
	"firebasestorage.googleapis.com",
	"firebasehosting.googleapis.com",
	"identitytoolkit.googleapis.com",
}

// EnableAPIs enables all required GCP APIs
func EnableAPIs(projectID string) error {
	output.Step(1, 5, "Enabling required GCP APIs...")

	// Set project
	if _, err := exec.Run(fmt.Sprintf("gcloud config set project %s", projectID), false); err != nil {
		return fmt.Errorf("failed to set project: %w", err)
	}

	// First, try to enable the Service Usage API
	output.Info("Checking Service Usage API...")
	result, err := exec.Run(fmt.Sprintf("gcloud services enable serviceusage.googleapis.com --project=%s 2>&1", projectID), true)
	if err != nil || (result != nil && strings.Contains(result.Stdout, "SERVICE_DISABLED")) {
		return fmt.Errorf(`Service Usage API is not enabled.

The Service Usage API must be enabled before other APIs can be enabled.
This is a one-time manual step.

Please enable it by clicking this link:
https://console.developers.google.com/apis/api/serviceusage.googleapis.com/overview?project=%s

Steps:
1. Click the link above
2. Click the 'Enable' button
3. Wait 1-2 minutes for it to propagate
4. Run this setup script again`, projectID)
	}

	// Enable all required APIs
	output.Info("Enabling project APIs...")
	apiList := strings.Join(requiredAPIs, " ")
	if _, err := exec.Run(fmt.Sprintf("gcloud services enable %s --quiet", apiList), false); err != nil {
		return fmt.Errorf("failed to enable APIs: %w", err)
	}

	output.Success("APIs enabled (already-enabled APIs skipped)")
	return nil
}
