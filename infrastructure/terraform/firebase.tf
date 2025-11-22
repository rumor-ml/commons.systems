# Firebase Security Rules Management
# Manages Firestore and Storage security rules via Terraform

# Firestore Security Rules
resource "google_firebaserules_ruleset" "firestore" {
  project = var.project_id

  source {
    files {
      name    = "firestore.rules"
      content = file("${path.module}/../../firestore.rules")
    }
  }

  lifecycle {
    create_before_destroy = true
  }
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

# Storage Security Rules
resource "google_firebaserules_ruleset" "storage" {
  project = var.project_id

  source {
    files {
      name    = "storage.rules"
      content = file("${path.module}/../../storage.rules")
    }
  }

  lifecycle {
    create_before_destroy = true
  }
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
output "firestore_rules_version" {
  value       = google_firebaserules_ruleset.firestore.name
  description = "Current Firestore rules version"
}

output "storage_rules_version" {
  value       = google_firebaserules_ruleset.storage.name
  description = "Current Storage rules version"
}
