# Firebase Authentication Configuration
# Manages authorized domains for OAuth
#
# IMPORTANT: When adding a new site to the monorepo:
# 1. Add the production domain to var.site_domains in variables.tf
# 2. OR manually add domains to the authorized_domains list below
# 3. Run terraform plan/apply to update Firebase config
#
# Note: Cloud Run preview deployment domains must be added manually
# via Firebase Console as they are dynamic and not managed by Terraform.

# Enable Identity Platform API
resource "google_project_service" "identitytoolkit" {
  service            = "identitytoolkit.googleapis.com"
  disable_on_destroy = false
}

# Local variables for authorized domains
locals {
  # Base authorized domains (always required)
  base_auth_domains = [
    "localhost",                      # Local development
    "${var.project_id}.firebaseapp.com",  # Firebase hosting
    "${var.project_id}.web.app",         # Firebase hosting alternate
  ]

  # Production site domains (stable, can be permanently authorized)
  site_production_domains = var.site_domains

  # Cloud Run production service domains
  cloud_run_production_domains = [
    for site in var.sites : "${site}-site.run.app"
  ]

  # Combine all authorized domains
  all_auth_domains = concat(
    local.base_auth_domains,
    local.site_production_domains,
    local.cloud_run_production_domains
  )
}

# Configure Identity Platform (Firebase Auth)
resource "google_identity_platform_config" "auth" {
  project = var.project_id

  # Authorized domains for OAuth redirects
  # Note: Firebase does not support wildcards like *.run.app
  # Preview deployment domains must be added manually via Firebase Console
  authorized_domains = local.all_auth_domains

  depends_on = [
    google_project_service.identitytoolkit
  ]
}

# Outputs
output "auth_authorized_domains" {
  value       = google_identity_platform_config.auth.authorized_domains
  description = "List of authorized domains for Firebase Auth"
}

output "auth_config_instructions" {
  value = <<-EOT
    Firebase Authentication is configured with authorized domains.

    To add preview deployment domains manually:
    1. Go to Firebase Console: https://console.firebase.google.com/project/${var.project_id}/authentication/settings
    2. Scroll to "Authorized domains"
    3. Click "Add domain"
    4. Add the Cloud Run preview domain (e.g., service-name-branch-hash.run.app)

    Preview domains are dynamic and must be added per deployment for auth testing.
    Recommendation: Test auth on production domains only.
  EOT
  description = "Instructions for managing Firebase Auth authorized domains"
}
