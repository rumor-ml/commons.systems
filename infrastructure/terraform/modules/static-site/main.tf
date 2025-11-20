# Reusable module for static site hosting on GCP
# Creates: GCS bucket, CDN, Load Balancer, Static IP

# Storage bucket for static site hosting
resource "google_storage_bucket" "site_bucket" {
  name          = "${var.project_id}-${var.site_name}-site"
  location      = var.region
  force_destroy = var.force_destroy

  uniform_bucket_level_access = true

  website {
    main_page_suffix = var.main_page
    not_found_page   = var.not_found_page
  }

  cors {
    origin          = var.cors_origins
    method          = ["GET", "HEAD"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  # Lifecycle policy to reduce costs
  dynamic "lifecycle_rule" {
    for_each = var.enable_lifecycle_policies ? [1] : []
    content {
      condition {
        age            = 30
        matches_prefix = ["old/"]
      }
      action {
        type = "Delete"
      }
    }
  }

  dynamic "lifecycle_rule" {
    for_each = var.enable_lifecycle_policies ? [1] : []
    content {
      condition {
        age = 7
      }
      action {
        type          = "SetStorageClass"
        storage_class = "NEARLINE"
      }
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
  count         = var.enable_backup ? 1 : 0
  name          = "${var.project_id}-${var.site_name}-site-backup"
  location      = var.region
  force_destroy = var.force_destroy

  uniform_bucket_level_access = true

  # Lifecycle policy to clean up old backups and reduce costs
  lifecycle_rule {
    condition {
      age = var.backup_retention_days
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
  name = "${var.site_name}-site-ip"
}

# Backend bucket for Cloud CDN
resource "google_compute_backend_bucket" "site_backend" {
  name        = "${var.site_name}-backend"
  bucket_name = google_storage_bucket.site_bucket.name
  enable_cdn  = var.enable_cdn

  dynamic "cdn_policy" {
    for_each = var.enable_cdn ? [1] : []
    content {
      cache_mode        = "CACHE_ALL_STATIC"
      client_ttl        = var.cdn_ttl
      default_ttl       = var.cdn_ttl
      max_ttl           = var.cdn_max_ttl
      negative_caching  = true
      serve_while_stale = var.cdn_max_ttl
    }
  }
}

# URL map
resource "google_compute_url_map" "site_url_map" {
  name            = "${var.site_name}-url-map"
  default_service = google_compute_backend_bucket.site_backend.id
}

# HTTP proxy
resource "google_compute_target_http_proxy" "site_http_proxy" {
  name    = "${var.site_name}-http-proxy"
  url_map = google_compute_url_map.site_url_map.id
}

# Forwarding rule
resource "google_compute_global_forwarding_rule" "site_http" {
  name       = "${var.site_name}-http-forwarding-rule"
  target     = google_compute_target_http_proxy.site_http_proxy.id
  port_range = "80"
  ip_address = google_compute_global_address.site_ip.address
}
