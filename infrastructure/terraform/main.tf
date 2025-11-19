terraform {
  required_version = ">= 1.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  # Uncomment to use GCS backend for state
  # backend "gcs" {
  #   bucket = "fellspiral-terraform-state"
  #   prefix = "terraform/state"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Storage bucket for static site hosting
resource "google_storage_bucket" "site_bucket" {
  name          = "${var.project_id}-fellspiral-site"
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true

  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
  }

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  # Lifecycle policy to reduce costs
  lifecycle_rule {
    condition {
      age = 30
      matches_prefix = ["old/"]
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }
}

# Make bucket publicly readable
resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.site_bucket.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# Backup bucket for rollback functionality
resource "google_storage_bucket" "backup_bucket" {
  name          = "${var.project_id}-fellspiral-site-backup"
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true

  # Lifecycle policy to clean up old backups and reduce costs
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      age                = 1
      num_newer_versions = 5
    }
    action {
      type = "Delete"
    }
  }
}

# Reserve static IP for load balancer
resource "google_compute_global_address" "site_ip" {
  name = "fellspiral-site-ip"
}

# Backend bucket for Cloud CDN
resource "google_compute_backend_bucket" "site_backend" {
  name        = "fellspiral-backend"
  bucket_name = google_storage_bucket.site_bucket.name
  enable_cdn  = true

  cdn_policy {
    cache_mode        = "CACHE_ALL_STATIC"
    client_ttl        = 3600
    default_ttl       = 3600
    max_ttl           = 86400
    negative_caching  = true
    serve_while_stale = 86400
  }
}

# URL map
resource "google_compute_url_map" "site_url_map" {
  name            = "fellspiral-url-map"
  default_service = google_compute_backend_bucket.site_backend.id
}

# HTTP proxy
resource "google_compute_target_http_proxy" "site_http_proxy" {
  name    = "fellspiral-http-proxy"
  url_map = google_compute_url_map.site_url_map.id
}

# Forwarding rule
resource "google_compute_global_forwarding_rule" "site_http" {
  name       = "fellspiral-http-forwarding-rule"
  target     = google_compute_target_http_proxy.site_http_proxy.id
  port_range = "80"
  ip_address = google_compute_global_address.site_ip.address
}

# Service account for GitHub Actions deployments
resource "google_service_account" "github_actions" {
  account_id   = "github-actions-deployer"
  display_name = "GitHub Actions Deployer"
  description  = "Service account used by GitHub Actions for deployments"
}

# Grant storage admin to deployment service account
resource "google_project_iam_member" "github_actions_storage" {
  project = var.project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# Grant compute load balancer admin to deployment service account
resource "google_project_iam_member" "github_actions_compute" {
  project = var.project_id
  role    = "roles/compute.loadBalancerAdmin"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# Optional: HTTPS setup (requires SSL certificate)
# Uncomment these resources after obtaining an SSL certificate

# resource "google_compute_ssl_certificate" "site_cert" {
#   name_prefix = "fellspiral-cert-"
#   private_key = file("path/to/private.key")
#   certificate = file("path/to/certificate.crt")
#
#   lifecycle {
#     create_before_destroy = true
#   }
# }

# resource "google_compute_target_https_proxy" "site_https_proxy" {
#   name             = "fellspiral-https-proxy"
#   url_map          = google_compute_url_map.site_url_map.id
#   ssl_certificates = [google_compute_ssl_certificate.site_cert.id]
# }

# resource "google_compute_global_forwarding_rule" "site_https" {
#   name       = "fellspiral-https-forwarding-rule"
#   target     = google_compute_target_https_proxy.site_https_proxy.id
#   port_range = "443"
#   ip_address = google_compute_global_address.site_ip.address
# }

# Output values
output "bucket_name" {
  value       = google_storage_bucket.site_bucket.name
  description = "Name of the storage bucket"
}

output "bucket_url" {
  value       = "gs://${google_storage_bucket.site_bucket.name}"
  description = "GCS URL of the bucket"
}

output "site_ip" {
  value       = google_compute_global_address.site_ip.address
  description = "Static IP address for the site"
}

output "site_url" {
  value       = "http://${google_compute_global_address.site_ip.address}"
  description = "URL of the deployed site"
}

output "deployment_service_account_email" {
  value       = google_service_account.github_actions.email
  description = "Email of the service account for deployments"
}
