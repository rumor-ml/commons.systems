package gcp

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/exec"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
)

// IAMPolicy represents a simplified IAM policy
type IAMPolicy struct {
	Bindings []IAMBinding `json:"bindings"`
}

// IAMBinding represents an IAM role binding
type IAMBinding struct {
	Role    string   `json:"role"`
	Members []string `json:"members"`
}

// CreateServiceAccount creates the GitHub Actions service account and binds it to Workload Identity
func CreateServiceAccount(projectID, repoOwner, repoName, wifProvider string) (string, error) {
	output.Step(3, 5, "Creating GitHub Actions service account...")

	saName := "github-actions-terraform"
	saEmail := fmt.Sprintf("%s@%s.iam.gserviceaccount.com", saName, projectID)

	// Create service account
	saExists, _ := exec.RunQuiet(fmt.Sprintf("gcloud iam service-accounts describe %s", saEmail))

	if saExists == "" {
		if _, err := exec.Run(fmt.Sprintf(
			`gcloud iam service-accounts create %s --display-name="GitHub Actions Terraform" --quiet`,
			saName), true); err != nil {
			return "", fmt.Errorf("failed to create service account: %w", err)
		}
		output.Success("Service account created")
	} else {
		output.Info("Service account already exists")
	}

	// Bind Workload Identity
	output.Info("Configuring Workload Identity binding...")

	member := fmt.Sprintf("principalSet://iam.googleapis.com/%s/attribute.repository/%s/%s",
		wifProvider, repoOwner, repoName)

	// Check if binding exists
	bindingExists := false
	result, err := exec.Run(fmt.Sprintf("gcloud iam service-accounts get-iam-policy %s --format=json", saEmail), true)
	if err == nil && result.Stdout != "" {
		var policy IAMPolicy
		if err := json.Unmarshal([]byte(result.Stdout), &policy); err == nil {
			for _, binding := range policy.Bindings {
				if binding.Role == "roles/iam.workloadIdentityUser" {
					for _, existingMember := range binding.Members {
						if existingMember == member {
							bindingExists = true
							output.Info("Correct workload identity binding already exists")
							break
						}
					}
				}
			}
		}
	}

	// Add the binding if it doesn't exist
	if !bindingExists {
		args := []string{
			"iam", "service-accounts", "add-iam-policy-binding", saEmail,
			"--member=" + member,
			"--role=roles/iam.workloadIdentityUser",
			"--quiet",
		}
		exec.RunCommand("gcloud", args, true)
		output.Success("Workload Identity binding created")
	}

	output.Info("(IAM permissions will be managed by Terraform)")
	return saEmail, nil
}

// GrantIAMPermissions grants necessary IAM roles to the service account
func GrantIAMPermissions(projectID, saEmail string) error {
	output.Step(4, 5, "Granting IAM permissions to service account...")

	roles := []string{
		"roles/secretmanager.admin",
		"roles/artifactregistry.admin",
		"roles/run.admin",
		"roles/iam.serviceAccountUser",
		"roles/storage.admin",
		"roles/compute.loadBalancerAdmin",
		"roles/compute.networkAdmin",
	}

	// Get current project IAM policy
	result, err := exec.Run(fmt.Sprintf("gcloud projects get-iam-policy %s --format=json", projectID), true)
	if err != nil {
		return fmt.Errorf("failed to get project IAM policy: %w", err)
	}

	var policy IAMPolicy
	existingRoles := make(map[string]bool)
	member := fmt.Sprintf("serviceAccount:%s", saEmail)

	if result.Stdout != "" {
		if err := json.Unmarshal([]byte(result.Stdout), &policy); err == nil {
			for _, binding := range policy.Bindings {
				for _, existingMember := range binding.Members {
					if existingMember == member {
						existingRoles[binding.Role] = true
					}
				}
			}
		}
	}

	// Grant each role if not already granted
	for _, role := range roles {
		if existingRoles[role] {
			output.Info(fmt.Sprintf("Already has %s", role))
			continue
		}

		output.Info(fmt.Sprintf("Granting %s...", role))
		result, err := exec.Run(fmt.Sprintf(
			`gcloud projects add-iam-policy-binding %s --member="serviceAccount:%s" --role="%s" --condition=None --quiet 2>&1`,
			projectID, saEmail, role), true)

		if err == nil && result != nil && (strings.Contains(result.Stdout, "Updated IAM policy") || strings.Contains(result.Stdout, "bindings:")) {
			output.Success(fmt.Sprintf("Granted %s", role))
		} else if result != nil && strings.Contains(result.Stdout, "PERMISSION_DENIED") {
			output.Warning(fmt.Sprintf("Failed to grant %s - permission denied", role))
		}
	}

	// Grant Service Account Token Creator on the service account itself (for self-impersonation)
	output.Info("Granting Service Account Token Creator permissions...")
	exec.Run(fmt.Sprintf(
		`gcloud iam service-accounts add-iam-policy-binding %s --member="serviceAccount:%s" --role="roles/iam.serviceAccountTokenCreator" --quiet`,
		saEmail, saEmail), true)
	output.Success("Service Account Token Creator role granted")

	return nil
}
