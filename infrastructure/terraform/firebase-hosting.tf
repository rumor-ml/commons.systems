# Firebase Hosting Sites Configuration
# Creates and manages Firebase Hosting sites for all projects in the monorepo

# Enable Firebase Hosting API
resource "google_project_service" "firebasehosting" {
  service            = "firebasehosting.googleapis.com"
  disable_on_destroy = false
}

# Create Firebase Hosting sites for each project
resource "google_firebase_hosting_site" "sites" {
  for_each = toset(var.sites)

  provider = google
  project  = var.project_id
  site_id  = each.value

  depends_on = [
    google_project_service.firebase,
    google_project_service.firebasehosting
  ]
}

# Outputs
output "hosting_sites" {
  value = {
    for site_id, site in google_firebase_hosting_site.sites :
    site_id => {
      name         = site.name
      default_url  = site.default_url
      app_id       = site.app_id
    }
  }
  description = "Firebase Hosting sites configuration"
}

output "hosting_urls" {
  value = {
    for site_id, site in google_firebase_hosting_site.sites :
    site_id => site.default_url
  }
  description = "Default URLs for Firebase Hosting sites"
}
