variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "site_name" {
  description = "Name of the site (used for resource naming)"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "main_page" {
  description = "Main page for the website"
  type        = string
  default     = "index.html"
}

variable "not_found_page" {
  description = "404 page for the website"
  type        = string
  default     = "index.html"
}

variable "cors_origins" {
  description = "CORS allowed origins"
  type        = list(string)
  default     = ["*"]
}

variable "enable_cdn" {
  description = "Enable Cloud CDN"
  type        = bool
  default     = true
}

variable "cdn_ttl" {
  description = "CDN TTL in seconds"
  type        = number
  default     = 3600
}

variable "cdn_max_ttl" {
  description = "CDN maximum TTL in seconds"
  type        = number
  default     = 86400
}

variable "enable_backup" {
  description = "Enable backup bucket"
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  description = "Backup retention in days"
  type        = number
  default     = 7
}

variable "enable_lifecycle_policies" {
  description = "Enable lifecycle policies for cost optimization"
  type        = bool
  default     = true
}

variable "force_destroy" {
  description = "Allow bucket to be destroyed even if not empty (use with caution)"
  type        = bool
  default     = false
}
