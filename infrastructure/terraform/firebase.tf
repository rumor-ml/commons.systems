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

# Storage security rules for videobrowser
resource "google_firebaserules_ruleset" "storage" {
  source {
    files {
      name    = "storage.rules"
      content = file("../../videobrowser/storage.rules")
    }
  }

  project = var.project_id

  depends_on = [
    google_project_service.firebase,
    google_project_service.firebaserules,
    google_project_service.firebasestorage
  ]
}

resource "google_firebaserules_release" "storage" {
  name         = "firebase.storage/${var.project_id}.appspot.com"
  ruleset_name = google_firebaserules_ruleset.storage.name
  project      = var.project_id

  lifecycle {
    replace_triggered_by = [
      google_firebaserules_ruleset.storage
    ]
  }
}

# Outputs
output "firestore_ruleset_name" {
  value       = google_firebaserules_ruleset.firestore.name
  description = "Name of the deployed Firestore ruleset"
}

output "storage_ruleset_name" {
  value       = google_firebaserules_ruleset.storage.name
  description = "Name of the deployed Storage ruleset"
}
