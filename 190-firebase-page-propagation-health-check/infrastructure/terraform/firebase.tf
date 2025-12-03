# Firebase Security Rules Management
# Deploys Firestore and Storage security rules to Firebase

# Enable required Firebase APIs
resource "google_project_service" "firebase" {
  service            = "firebase.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "firebaserules" {
  service            = "firebaserules.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "firebasestorage" {
  service            = "firebasestorage.googleapis.com"
  disable_on_destroy = false
}

# Firestore security rules for fellspiral
resource "google_firebaserules_ruleset" "firestore" {
  source {
    files {
      name    = "firestore.rules"
      content = file("../../fellspiral/firestore.rules")
    }
  }

  project = var.project_id

  depends_on = [
    google_project_service.firebase,
    google_project_service.firebaserules
  ]
}

resource "google_firebaserules_release" "firestore" {
  name         = "cloud.firestore"
  ruleset_name = google_firebaserules_ruleset.firestore.name
  project      = var.project_id

  lifecycle {
    replace_triggered_by = [
      google_firebaserules_ruleset.firestore
    ]
  }
}

# Note: Firebase Storage rules for rml-media bucket are now managed in storage-bucket.tf
# This provides proper separation of concerns and supports the shared bucket used by
# videobrowser and print sites

# Outputs
output "firestore_ruleset_name" {
  value       = google_firebaserules_ruleset.firestore.name
  description = "Name of the deployed Firestore ruleset"
}
