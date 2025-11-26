# Artifact Registry Repositories with Cleanup Policies
#
# Retention Strategy:
# - playwright-server: Keep 5 most recent within 7 days + latest
# - {site}-production: Keep 5 most recent within 7 days + latest
# - {site}-previews: Keep only latest within 7 days, CI/CD deletes all on branch delete

locals {
  sites = ["fellspiral", "videobrowser", "audiobrowser", "print"]
}

# Playwright server - 5 most recent within 7 days + latest
resource "google_artifact_registry_repository" "playwright_server" {
  location      = var.region
  repository_id = "playwright-server"
  format        = "DOCKER"
  description   = "Docker repository for Playwright test server"

  cleanup_policies {
    id     = "delete-older-than-7-days"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "604800s"  # 7 days
    }
  }

  cleanup_policies {
    id     = "keep-5-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  cleanup_policies {
    id     = "keep-latest"
    action = "KEEP"
    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["latest"]
    }
  }
}

# Production repos - 5 most recent within 7 days + latest
resource "google_artifact_registry_repository" "site_production" {
  for_each      = toset(local.sites)
  location      = var.region
  repository_id = "${each.key}-production"
  format        = "DOCKER"
  description   = "Production Docker images for ${each.key}"

  cleanup_policies {
    id     = "delete-older-than-7-days"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "604800s"  # 7 days
    }
  }

  cleanup_policies {
    id     = "keep-5-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  cleanup_policies {
    id     = "keep-latest"
    action = "KEEP"
    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["latest"]
    }
  }
}

# Preview repos - only latest within 7 days, CI/CD deletes all on branch delete
resource "google_artifact_registry_repository" "site_previews" {
  for_each      = toset(local.sites)
  location      = var.region
  repository_id = "${each.key}-previews"
  format        = "DOCKER"
  description   = "Preview Docker images for ${each.key}"

  cleanup_policies {
    id     = "delete-older-than-7-days"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "604800s"  # 7 days
    }
  }

  cleanup_policies {
    id     = "keep-latest-only"
    action = "KEEP"
    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["latest"]
    }
  }
}

# Outputs
output "playwright_artifact_registry" {
  value       = google_artifact_registry_repository.playwright_server.name
  description = "Artifact Registry repository name"
}

output "playwright_docker_image" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/playwright-server/playwright-server"
  description = "Docker image path for Playwright server"
}
