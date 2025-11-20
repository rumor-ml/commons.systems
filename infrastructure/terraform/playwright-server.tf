# Playwright Test Server - Cloud Run Deployment

# Note: Required APIs (run.googleapis.com, artifactregistry.googleapis.com) are enabled via setup.py
# or manually via gcloud/console before running Terraform

# Artifact Registry repository for Docker images
resource "google_artifact_registry_repository" "playwright_server" {
  location      = var.region
  repository_id = "playwright-server"
  description   = "Docker repository for Playwright test server"
  format        = "DOCKER"
}

# Service account for Cloud Run service
resource "google_service_account" "playwright_server" {
  account_id   = "playwright-server"
  display_name = "Playwright Test Server"
  description  = "Service account for Playwright test server Cloud Run service"
}

# Note: Cloud Run service is created by the deployment workflow (deploy-playwright-server.yml)
# using `gcloud run deploy`. This avoids the chicken-and-egg problem of needing the Docker
# image to exist before Terraform can create the service.

# Note: GitHub Actions IAM permissions (cloud_run, artifact_registry, service_account_user)
# are defined in ci-logs-proxy.tf to avoid duplication

# Outputs
output "playwright_artifact_registry" {
  value       = google_artifact_registry_repository.playwright_server.name
  description = "Artifact Registry repository name"
}

output "playwright_docker_image" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/playwright-server/playwright-server"
  description = "Docker image path for Playwright server"
}

output "playwright_service_account" {
  value       = google_service_account.playwright_server.email
  description = "Service account email for Playwright server"
}
