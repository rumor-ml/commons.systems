# Playwright Test Server - Cloud Run Deployment

# Note: Required APIs (run.googleapis.com, artifactregistry.googleapis.com) are enabled via setup.py
# or manually via gcloud/console before running Terraform

# Note: Artifact Registry repository is now defined in artifact-registry.tf with cleanup policies

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

# Note: playwright_artifact_registry and playwright_docker_image outputs moved to artifact-registry.tf

# Outputs
output "playwright_service_account" {
  value       = google_service_account.playwright_server.email
  description = "Service account email for Playwright server"
}
