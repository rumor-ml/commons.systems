package runner

import (
	"fmt"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/config"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/firebase"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/gcp"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/github"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/terraform"
)

// Runner orchestrates the infrastructure setup
type Runner struct {
	config config.Config
}

// New creates a new Runner
func New(cfg config.Config) *Runner {
	return &Runner{config: cfg}
}

// Run executes the infrastructure setup steps
func (r *Runner) Run() error {
	if r.config.CI {
		output.Header("Infrastructure Setup (CI/CD Mode)")
	} else {
		output.Header("Fellspiral Infrastructure Setup")
	}

	// Step 1: Check prerequisites (unless in CI mode)
	if !r.config.CI {
		if err := r.checkPrerequisites(); err != nil {
			return err
		}
	}

	// Step 2: Authenticate to GCP (unless in CI mode)
	if !r.config.CI {
		if err := gcp.Authenticate(); err != nil {
			return err
		}
	}

	// Step 3: Get or prompt for project ID
	if err := r.resolveProjectID(); err != nil {
		return err
	}

	// Step 4: GCP Setup (unless skipped)
	if !r.config.SkipGCPSetup {
		if err := r.setupGCP(); err != nil {
			return err
		}
	}

	// Step 5: Firebase Setup
	if err := r.setupFirebase(); err != nil {
		return err
	}

	// Step 6: Terraform Setup (unless skipped)
	if !r.config.SkipTerraform {
		if err := r.setupTerraform(); err != nil {
			return err
		}
	}

	output.Success("\nInfrastructure setup complete! ✓")
	return nil
}

// checkPrerequisites checks if required tools are installed
func (r *Runner) checkPrerequisites() error {
	output.Header("Checking Prerequisites")

	// Check for gcloud
	if !gcp.IsGCloudInstalled() {
		return fmt.Errorf("gcloud CLI is not installed\nInstall from: https://cloud.google.com/sdk/docs/install")
	}
	output.Success("gcloud CLI found")

	// Check for terraform (if not skipping)
	if !r.config.SkipTerraform {
		if !terraform.IsTerraformInstalled() {
			return fmt.Errorf("terraform is not installed\nInstall from: https://www.terraform.io/downloads")
		}
		output.Success("terraform found")
	}

	return nil
}

// resolveProjectID gets the project ID from config or prompts for it
func (r *Runner) resolveProjectID() error {
	if r.config.ProjectID != "" {
		output.Info(fmt.Sprintf("Using project: %s", r.config.ProjectID))
		return nil
	}

	// In CI mode, we must have a project ID
	if r.config.CI {
		return fmt.Errorf("GCP_PROJECT_ID not set and no default project configured")
	}

	// Get from gcloud config
	projectID, err := gcp.GetDefaultProject()
	if err == nil && projectID != "" {
		r.config.ProjectID = projectID
		output.Info(fmt.Sprintf("Using project from gcloud config: %s", projectID))
		return nil
	}

	return fmt.Errorf("no project ID provided and unable to get from gcloud config")
}

// setupGCP runs GCP setup steps
func (r *Runner) setupGCP() error {
	output.Header("GCP Setup")

	// Enable APIs
	if err := gcp.EnableAPIs(r.config.ProjectID); err != nil {
		return fmt.Errorf("failed to enable APIs: %w", err)
	}

	// Setup Workload Identity
	wifProvider, err := gcp.SetupWorkloadIdentity(r.config.ProjectID, r.config.RepoOwner, r.config.RepoName)
	if err != nil {
		return fmt.Errorf("failed to setup workload identity: %w", err)
	}
	r.config.WorkloadIdentityProvider = wifProvider

	// Create Service Account
	saEmail, err := gcp.CreateServiceAccount(r.config.ProjectID, r.config.RepoOwner, r.config.RepoName, wifProvider)
	if err != nil {
		return fmt.Errorf("failed to create service account: %w", err)
	}
	r.config.ServiceAccountEmail = saEmail

	// Grant IAM Permissions
	if err := gcp.GrantIAMPermissions(r.config.ProjectID, saEmail); err != nil {
		return fmt.Errorf("failed to grant IAM permissions: %w", err)
	}

	// Setup GitHub API Token Secret
	if err := gcp.SetupGitHubTokenSecret(r.config.ProjectID); err != nil {
		// Non-fatal - user can create manually
		output.Warning(fmt.Sprintf("Failed to setup GitHub token: %v", err))
	}

	return nil
}

// setupFirebase runs Firebase setup steps
func (r *Runner) setupFirebase() error {
	output.Header("Firebase Setup")

	// Initialize Firebase project
	if err := firebase.InitializeProject(r.config.ProjectID); err != nil {
		return fmt.Errorf("failed to initialize Firebase: %w", err)
	}

	// Create hosting sites
	siteMappings, err := firebase.CreateHostingSites(r.config.ProjectID)
	if err != nil {
		return fmt.Errorf("failed to create hosting sites: %w", err)
	}

	// Update firebase.json with actual site names
	if err := firebase.UpdateConfig(siteMappings); err != nil {
		// Non-fatal - user can update manually
		output.Warning(fmt.Sprintf("Failed to update firebase.json: %v", err))
	}

	return nil
}

// setupTerraform runs Terraform setup steps
func (r *Runner) setupTerraform() error {
	output.Header("Terraform Setup")

	// Create state bucket
	if err := terraform.CreateStateBucket(r.config.ProjectID); err != nil {
		return fmt.Errorf("failed to create state bucket: %w", err)
	}

	// Generate terraform.tfvars
	if err := terraform.GenerateVars(r.config.ProjectID); err != nil {
		return fmt.Errorf("failed to generate terraform.tfvars: %w", err)
	}

	// Run terraform
	if err := terraform.Run(r.config.AutoApprove); err != nil {
		return fmt.Errorf("failed to run terraform: %w", err)
	}

	// Setup GitHub secrets (if gh CLI available)
	if r.config.ServiceAccountEmail != "" && r.config.WorkloadIdentityProvider != "" {
		if err := github.SetupSecrets(r.config.ProjectID, r.config.RepoOwner, r.config.RepoName, r.config.WorkloadIdentityProvider, r.config.ServiceAccountEmail); err != nil {
			// Non-fatal - show manual instructions
			output.Warning("Unable to auto-create GitHub secrets")
			github.ShowManualInstructions(r.config.ProjectID, r.config.RepoOwner, r.config.RepoName, r.config.WorkloadIdentityProvider, r.config.ServiceAccountEmail)
		}
	}

	return nil
}
