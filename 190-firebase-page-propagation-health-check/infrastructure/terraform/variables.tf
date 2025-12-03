variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resources"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment (dev, staging, production)"
  type        = string
  default     = "production"
}

variable "sites" {
  description = "List of site names in the monorepo (used for Cloud Run service domains)"
  type        = list(string)
  default     = ["fellspiral", "videobrowser", "audiobrowser"]
}

variable "site_domains" {
  description = "List of production custom domains for sites (for Firebase Auth authorized domains)"
  type        = list(string)
  default     = [
    "fellspiral.commons.systems",
    "videobrowser.commons.systems",
    "audiobrowser.commons.systems"
  ]
}
