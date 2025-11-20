# Site configurations using the reusable static-site module

# Fellspiral - Tactical tabletop RPG
module "fellspiral" {
  source = "./modules/static-site"

  project_id = var.project_id
  site_name  = "fellspiral"
  region     = var.region

  enable_cdn                = true
  cdn_ttl                   = 3600
  cdn_max_ttl               = 86400
  enable_backup             = true
  backup_retention_days     = 7
  enable_lifecycle_policies = true
}

# Video Browser - Navigate video binaries from GCS
module "videobrowser" {
  source = "./modules/static-site"

  project_id = var.project_id
  site_name  = "videobrowser"
  region     = var.region

  enable_cdn                = true
  cdn_ttl                   = 3600
  cdn_max_ttl               = 86400
  enable_backup             = false # No need for backup on video browser
  enable_lifecycle_policies = false # Video browser doesn't need lifecycle policies
}

# Outputs for all sites
output "fellspiral_bucket_name" {
  value       = module.fellspiral.bucket_name
  description = "Fellspiral storage bucket name"
}

output "fellspiral_site_url" {
  value       = module.fellspiral.site_url
  description = "Fellspiral site URL"
}

output "fellspiral_site_ip" {
  value       = module.fellspiral.site_ip
  description = "Fellspiral static IP"
}

output "videobrowser_bucket_name" {
  value       = module.videobrowser.bucket_name
  description = "Video Browser storage bucket name"
}

output "videobrowser_site_url" {
  value       = module.videobrowser.site_url
  description = "Video Browser site URL"
}

output "videobrowser_site_ip" {
  value       = module.videobrowser.site_ip
  description = "Video Browser static IP"
}
