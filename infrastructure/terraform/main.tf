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

# Artifact Registry repository for production Docker images
resource "google_artifact_registry_repository" "production" {
  location      = var.region
  repository_id = "fellspiral-production"
  description   = "Production Docker images for Fellspiral site"
  format        = "DOCKER"

  cleanup_policies {
    id     = "keep-recent-versions"
    action = "KEEP"

    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"

    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s"  # 7 days
    }
  }
}

# Artifact Registry repository for feature branch preview images
resource "google_artifact_registry_repository" "previews" {
  location      = var.region
  repository_id = "fellspiral-previews"
  description   = "Feature branch preview Docker images"
  format        = "DOCKER"

  cleanup_policies {
    id     = "delete-old-previews"
    action = "DELETE"

    condition {
      older_than = "2592000s"  # 30 days
    }
  }

  cleanup_policies {
    id     = "keep-recent-versions"
    action = "KEEP"

    most_recent_versions {
      keep_count = 3
    }
  }
}

# Cloud Run service for production (managed by workflow, but Terraform ensures IAM is set)
# Note: The actual service deployment is handled by GitHub Actions, not Terraform
# This is intentional to allow fast deployments without Terraform state updates

# Service account for GitHub Actions deployments (created and configured by setup.py)
# IAM permissions for this service account are managed by setup.py, not Terraform,
# to avoid chicken-and-egg problems where Terraform would need permissions to grant itself permissions.
data "google_service_account" "github_actions" {
  account_id = "github-actions-sa"
}

# Grant necessary permissions to GitHub Actions service account
resource "google_artifact_registry_repository_iam_member" "github_actions_production" {
  project    = var.project_id
  location   = google_artifact_registry_repository.production.location
  repository = google_artifact_registry_repository.production.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_service_account.github_actions.email}"
}

resource "google_artifact_registry_repository_iam_member" "github_actions_previews" {
  project    = var.project_id
  location   = google_artifact_registry_repository.previews.location
  repository = google_artifact_registry_repository.previews.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_service_account.github_actions.email}"
}

# Output values
output "production_registry" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.production.repository_id}"
  description = "Production Artifact Registry URL"
}

output "preview_registry" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.previews.repository_id}"
  description = "Preview Artifact Registry URL"
}

output "deployment_service_account_email" {
  value       = data.google_service_account.github_actions.email
  description = "Email of the service account for deployments"
}
