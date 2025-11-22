# Site configurations using Cloud Run architecture
# Each site gets: Production Artifact Registry + Preview Artifact Registry

# Fellspiral - Tactical tabletop RPG
resource "google_artifact_registry_repository" "fellspiral_production" {
  location      = var.region
  repository_id = "fellspiral-production"
  description   = "Production Docker images for Fellspiral site"
  format        = "DOCKER"

  cleanup_policies {
    id     = "keep-recent-versions"
    action = "KEEP"

    most_recent_versions {
      keep_count = 3
    }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"

    condition {
      tag_state  = "UNTAGGED"
      older_than = "172800s"  # 2 days
    }
  }
}

resource "google_artifact_registry_repository" "fellspiral_previews" {
  location      = var.region
  repository_id = "fellspiral-previews"
  description   = "Feature branch preview Docker images for Fellspiral"
  format        = "DOCKER"

  cleanup_policies {
    id     = "delete-old-previews"
    action = "DELETE"

    condition {
      older_than = "1209600s"  # 14 days
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

resource "google_artifact_registry_repository_iam_member" "fellspiral_production_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.fellspiral_production.location
  repository = google_artifact_registry_repository.fellspiral_production.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_service_account.github_actions.email}"
}

resource "google_artifact_registry_repository_iam_member" "fellspiral_previews_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.fellspiral_previews.location
  repository = google_artifact_registry_repository.fellspiral_previews.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_service_account.github_actions.email}"
}

# Video Browser - Navigate video binaries from GCS
resource "google_artifact_registry_repository" "videobrowser_production" {
  location      = var.region
  repository_id = "videobrowser-production"
  description   = "Production Docker images for Video Browser site"
  format        = "DOCKER"

  cleanup_policies {
    id     = "keep-recent-versions"
    action = "KEEP"

    most_recent_versions {
      keep_count = 3
    }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"

    condition {
      tag_state  = "UNTAGGED"
      older_than = "172800s"  # 2 days
    }
  }
}

resource "google_artifact_registry_repository" "videobrowser_previews" {
  location      = var.region
  repository_id = "videobrowser-previews"
  description   = "Feature branch preview Docker images for Video Browser"
  format        = "DOCKER"

  cleanup_policies {
    id     = "delete-old-previews"
    action = "DELETE"

    condition {
      older_than = "1209600s"  # 14 days
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

resource "google_artifact_registry_repository_iam_member" "videobrowser_production_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.videobrowser_production.location
  repository = google_artifact_registry_repository.videobrowser_production.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_service_account.github_actions.email}"
}

resource "google_artifact_registry_repository_iam_member" "videobrowser_previews_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.videobrowser_previews.location
  repository = google_artifact_registry_repository.videobrowser_previews.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_service_account.github_actions.email}"
}

# Outputs for all sites
output "fellspiral_production_registry" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.fellspiral_production.repository_id}"
  description = "Fellspiral production Artifact Registry URL"
}

output "fellspiral_preview_registry" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.fellspiral_previews.repository_id}"
  description = "Fellspiral preview Artifact Registry URL"
}

output "videobrowser_production_registry" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.videobrowser_production.repository_id}"
  description = "Video Browser production Artifact Registry URL"
}

output "videobrowser_preview_registry" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.videobrowser_previews.repository_id}"
  description = "Video Browser preview Artifact Registry URL"
}

# Audio Browser - Navigate audio files from GCS
resource "google_artifact_registry_repository" "audiobrowser_production" {
  location      = var.region
  repository_id = "audiobrowser-production"
  description   = "Production Docker images for Audio Browser site"
  format        = "DOCKER"

  cleanup_policies {
    id     = "keep-recent-versions"
    action = "KEEP"

    most_recent_versions {
      keep_count = 3
    }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"

    condition {
      tag_state  = "UNTAGGED"
      older_than = "172800s"  # 2 days
    }
  }
}

resource "google_artifact_registry_repository" "audiobrowser_previews" {
  location      = var.region
  repository_id = "audiobrowser-previews"
  description   = "Feature branch preview Docker images for Audio Browser"
  format        = "DOCKER"

  cleanup_policies {
    id     = "delete-old-previews"
    action = "DELETE"

    condition {
      older_than = "1209600s"  # 14 days
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

resource "google_artifact_registry_repository_iam_member" "audiobrowser_production_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.audiobrowser_production.location
  repository = google_artifact_registry_repository.audiobrowser_production.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_service_account.github_actions.email}"
}

resource "google_artifact_registry_repository_iam_member" "audiobrowser_previews_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.audiobrowser_previews.location
  repository = google_artifact_registry_repository.audiobrowser_previews.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_service_account.github_actions.email}"
}

# Outputs for all sites
output "audiobrowser_production_registry" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.audiobrowser_production.repository_id}"
  description = "Audio Browser production Artifact Registry URL"
}

output "audiobrowser_preview_registry" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.audiobrowser_previews.repository_id}"
  description = "Audio Browser preview Artifact Registry URL"
}
