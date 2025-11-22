# Firebase Authentication Configuration
# Manages authorized domains for OAuth
#
# IMPORTANT: When adding a new site to the monorepo:
# 1. Add the production domain to var.site_domains in variables.tf
# 2. Add the site to firebase.json hosting configuration
# 3. Run terraform plan/apply to update Firebase config
#
# Firebase Hosting domains (*.web.app, *.firebaseapp.com) are automatically
# authorized for Firebase Auth - no manual configuration needed!

# Enable Identity Platform API
resource "google_project_service" "identitytoolkit" {
  service            = "identitytoolkit.googleapis.com"
  disable_on_destroy = false
}

# Local variables for authorized domains
locals {
  # Base authorized domains (always required)
  base_auth_domains = [
    "localhost",                          # Local development
    "${var.project_id}.firebaseapp.com",  # Firebase hosting (main)
    "${var.project_id}.web.app",          # Firebase hosting (alternate)
  ]

  # Firebase Hosting site domains (production sites)
  # Each site gets: <site-name>.web.app and <site-name>.firebaseapp.com
  firebase_site_domains = flatten([
    for site in var.sites : [
      "${site}.web.app",
      "${site}.firebaseapp.com"
    ]
  ])

  # Custom production domains (for custom domain mapping)
  custom_site_domains = var.site_domains

  # Combine all authorized domains
  all_auth_domains = concat(
    local.base_auth_domains,
    local.firebase_site_domains,
    local.custom_site_domains
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

    ✅ All Firebase Hosting domains are automatically authorized:
    - Production sites: <site-name>.web.app, <site-name>.firebaseapp.com
    - Preview channels: <channel>--<site-name>.web.app
    - Custom domains: ${join(", ", var.site_domains)}

    No manual configuration needed for preview deployments!

    To add custom domains:
    1. Configure in Firebase Console: https://console.firebase.google.com/project/${var.project_id}/hosting/sites
    2. Add DNS records as instructed
    3. Custom domains are automatically authorized for OAuth
  EOT
  description = "Instructions for managing Firebase Auth authorized domains"
}
