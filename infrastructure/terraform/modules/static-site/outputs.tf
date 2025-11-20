output "bucket_name" {
  value       = google_storage_bucket.site_bucket.name
  description = "Name of the storage bucket"
}

output "bucket_url" {
  value       = "gs://${google_storage_bucket.site_bucket.name}"
  description = "GCS URL of the bucket"
}

output "backup_bucket_name" {
  value       = var.enable_backup ? google_storage_bucket.backup_bucket[0].name : null
  description = "Name of the backup bucket (if enabled)"
}

output "backup_bucket_url" {
  value       = var.enable_backup ? "gs://${google_storage_bucket.backup_bucket[0].name}" : null
  description = "GCS URL of the backup bucket (if enabled)"
}

output "site_ip" {
  value       = google_compute_global_address.site_ip.address
  description = "Static IP address for the site"
}

output "site_url" {
  value       = "http://${google_compute_global_address.site_ip.address}"
  description = "URL of the deployed site"
}

output "cdn_enabled" {
  value       = var.enable_cdn
  description = "Whether CDN is enabled"
}
