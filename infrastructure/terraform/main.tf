terraform {
  required_version = ">= 1.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # GCS backend for state persistence across workflow runs
  backend "gcs" {
    bucket = "fellspiral-terraform-state"
    prefix = "terraform/state"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Service account for GitHub Actions deployments (created and configured by setup.py)
# IAM permissions for this service account are managed by setup.py, not Terraform,
# to avoid chicken-and-egg problems where Terraform would need permissions to grant itself permissions.
data "google_service_account" "github_actions" {
  account_id = "github-actions-terraform"
}

# Output for shared resources
output "deployment_service_account_email" {
  value       = data.google_service_account.github_actions.email
  description = "Email of the service account for deployments"
}
