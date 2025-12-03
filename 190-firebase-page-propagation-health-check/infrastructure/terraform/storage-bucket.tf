# GCS Bucket for Firebase Storage
# Shared storage bucket for videobrowser and print sites

# Enable Cloud Storage API
resource "google_project_service" "storage" {
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

# Create rml-media GCS bucket
resource "google_storage_bucket" "rml_media" {
  name          = "rml-media"
  location      = "US"
  project       = var.project_id
  force_destroy = false

  # Enable uniform bucket-level access
  uniform_bucket_level_access = true

  # CORS configuration for web access
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD", "PUT", "POST", "DELETE"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  # Lifecycle rule to clean up old objects if needed
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 365 # Delete objects older than 1 year
    }
  }

  depends_on = [
    google_project_service.storage
  ]
}

# Link GCS bucket to Firebase Storage
# This is done via the Firebase Storage API addFirebase method
# Note: Terraform doesn't have a native resource for this, so we use null_resource with local-exec
resource "null_resource" "link_rml_media_to_firebase" {
  triggers = {
    bucket_name = google_storage_bucket.rml_media.name
  }

  provisioner "local-exec" {
    command = <<-EOT
      curl -X POST \
        -H "Authorization: Bearer $(gcloud auth print-access-token)" \
        -H "Content-Type: application/json" \
        -d '{"bucket": "projects/${var.project_id}/buckets/${google_storage_bucket.rml_media.name}"}' \
        "https://firebasestorage.googleapis.com/v1beta/projects/${var.project_id}/buckets/${google_storage_bucket.rml_media.name}:addFirebase" \
        || echo "Bucket may already be linked to Firebase Storage (this is expected)"
    EOT
  }

  depends_on = [
    google_storage_bucket.rml_media,
    google_project_service.firebasestorage
  ]
}

# Deploy Firebase Storage rules to rml-media bucket
resource "google_firebaserules_ruleset" "rml_media_storage" {
  source {
    files {
      name    = "storage.rules"
      content = file("../../shared/storage.rules")
    }
  }

  project = var.project_id

  depends_on = [
    google_project_service.firebase,
    google_project_service.firebaserules,
    google_project_service.firebasestorage,
    null_resource.link_rml_media_to_firebase
  ]
}

resource "google_firebaserules_release" "rml_media_storage" {
  name         = "firebase.storage/rml-media"
  ruleset_name = google_firebaserules_ruleset.rml_media_storage.name
  project      = var.project_id

  lifecycle {
    replace_triggered_by = [
      google_firebaserules_ruleset.rml_media_storage
    ]
  }

  depends_on = [
    null_resource.link_rml_media_to_firebase
  ]
}

# Outputs
output "rml_media_bucket_name" {
  value       = google_storage_bucket.rml_media.name
  description = "Name of the rml-media GCS bucket"
}

output "rml_media_ruleset_name" {
  value       = google_firebaserules_ruleset.rml_media_storage.name
  description = "Name of the deployed rml-media Storage ruleset"
}
