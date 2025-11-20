# Static Site Module

Reusable Terraform module for deploying static websites on GCP with Cloud Storage and Cloud CDN.

## Features

- Static site hosting on Google Cloud Storage
- Cloud CDN with configurable TTL
- Global load balancer with static IP
- Optional backup bucket with automatic cleanup
- Cost optimization through lifecycle policies
- CORS configuration for API access

## Usage

```hcl
module "my_site" {
  source = "./modules/static-site"

  project_id = var.project_id
  site_name  = "mysite"
  region     = "us-central1"

  # Optional configurations
  enable_cdn    = true
  cdn_ttl       = 3600
  enable_backup = true
}
```

## Inputs

| Name | Description | Type | Default | Required |
|------|-------------|------|---------|----------|
| project_id | GCP Project ID | string | - | yes |
| site_name | Name of the site (used for resource naming) | string | - | yes |
| region | GCP region for resources | string | us-central1 | no |
| enable_cdn | Enable Cloud CDN | bool | true | no |
| cdn_ttl | CDN TTL in seconds | number | 3600 | no |
| cdn_max_ttl | CDN maximum TTL in seconds | number | 86400 | no |
| enable_backup | Enable backup bucket | bool | true | no |
| backup_retention_days | Backup retention in days | number | 7 | no |
| enable_lifecycle_policies | Enable lifecycle policies for cost optimization | bool | true | no |

## Outputs

| Name | Description |
|------|-------------|
| bucket_name | Name of the storage bucket |
| bucket_url | GCS URL of the bucket |
| backup_bucket_name | Name of the backup bucket (if enabled) |
| site_ip | Static IP address for the site |
| site_url | HTTP URL of the deployed site |

## Cost Estimate

- GCS Storage: ~$0.02/GB/month
- Cloud CDN: ~$0.08/GB egress (first 10TB)
- Load Balancer: ~$0.025/hour (~$18/month)

Typical small site: **~$0.13/month** (mostly storage + minimal traffic)
