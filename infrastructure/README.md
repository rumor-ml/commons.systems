# Infrastructure Documentation

This directory contains the infrastructure configuration for deploying the Fellspiral static site to Google Cloud Platform.

## Contents

- `terraform/` - Infrastructure as Code using Terraform
- `scripts/` - Deployment and setup scripts

## Architecture

```
┌─────────────────┐
│   GitHub        │
│   Actions       │
└────────┬────────┘
         │
         │ Deploy
         ▼
┌─────────────────┐
│  Cloud Storage  │
│  Static Bucket  │
└────────┬────────┘
         │
         │ Backend
         ▼
┌─────────────────┐
│   Cloud CDN     │
│   + Load        │
│   Balancer      │
└────────┬────────┘
         │
         │ Serve
         ▼
┌─────────────────┐
│     Users       │
└─────────────────┘
```

## Components

### Cloud Storage Bucket

- Hosts static files (HTML, CSS, JS)
- Configured for website hosting
- Publicly accessible
- Lifecycle policies for cost optimization

### Cloud CDN

- Global content delivery network
- Caches static assets
- Reduces latency
- Minimizes origin requests

### Load Balancer

- HTTP(S) load balancing
- URL map routing
- Static IP address
- SSL termination (when configured)

## Cost Breakdown

### Estimated Monthly Costs (Typical Traffic: ~1000 visitors/month)

| Service | Usage | Cost |
|---------|-------|------|
| Cloud Storage | 100 MB storage | $0.002 |
| Cloud Storage | 10k Class A ops | $0.05 |
| Cloud CDN | 1 GB cache egress | $0.08 |
| Static IP | 1 IP (attached) | $0.00 |
| **Total** | | **~$0.13/month** |

### Cost Optimization Features

1. **Cache-First Strategy**: Most requests served from CDN cache
2. **Lifecycle Policies**: Old/unused files automatically archived
3. **Compression**: All text assets served compressed
4. **Efficient Headers**: Long cache times for static assets

## Setup Options

### Option 1: Automated Script (Easiest)

```bash
cd scripts
./setup-gcp.sh
```

**Pros:**
- Quick setup
- Interactive
- Good for first-time setup

**Cons:**
- Less reproducible
- Manual cleanup required

### Option 2: Terraform (Recommended)

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

**Pros:**
- Infrastructure as Code
- Reproducible
- Version controlled
- Easy cleanup (`terraform destroy`)

**Cons:**
- Requires Terraform knowledge
- More initial setup

### Option 3: Manual (Most Control)

Follow the GCP console or gcloud CLI commands in `SETUP.md`.

**Pros:**
- Full control
- Learn each step
- No tools required

**Cons:**
- Time-consuming
- Error-prone
- Hard to reproduce

## Terraform Resources

The Terraform configuration creates:

1. **google_storage_bucket.site_bucket**
   - Storage for static files
   - Website configuration
   - CORS rules
   - Lifecycle policies

2. **google_compute_global_address.site_ip**
   - Static external IP

3. **google_compute_backend_bucket.site_backend**
   - Backend configuration
   - CDN settings
   - Cache policies

4. **google_compute_url_map.site_url_map**
   - Routing rules

5. **google_compute_target_http_proxy.site_http_proxy**
   - HTTP proxy for load balancer

6. **google_compute_global_forwarding_rule.site_http**
   - Forwarding rule for traffic

## Deployment Scripts

### deploy.sh

Deploys the built site to GCS.

**Usage:**
```bash
cd scripts
./deploy.sh
```

**Environment Variables:**
- `GCP_PROJECT_ID` - Your GCP project ID (required)
- `BUCKET_NAME` - Storage bucket name (optional)
- `CDN_ENABLED` - Enable CDN cache invalidation (optional)
- `DRY_RUN` - Simulate deployment (optional)

**Features:**
- Builds the site
- Uploads to GCS
- Sets cache headers
- Invalidates CDN cache
- Shows deployment URL

### setup-gcp.sh

Sets up initial GCP infrastructure.

**Usage:**
```bash
cd scripts
./setup-gcp.sh
```

**What it does:**
1. Enables required APIs
2. Creates storage bucket
3. Configures bucket for website hosting
4. Creates static IP
5. Sets up Cloud CDN
6. Creates load balancer
7. Outputs configuration details

## Security

### IAM Roles

For GitHub Actions deployment, the service account needs:
- `roles/storage.admin` - Manage bucket objects
- `roles/compute.loadBalancerAdmin` - Invalidate CDN cache

### Public Access

The storage bucket is configured for public read access to serve the website. This is required for static hosting.

### Secrets Management

Never commit:
- Service account keys
- Terraform state files (use remote backend)
- `.env` files with credentials

## Monitoring

### View Metrics

```bash
# Storage usage
gsutil du -sh gs://your-bucket-name

# CDN hit rate
gcloud compute backend-buckets describe fellspiral-backend

# Request logs
gcloud logging read "resource.type=gcs_bucket"
```

### Alerts

Consider setting up alerts for:
- High egress costs
- Low CDN hit rate
- Bucket errors
- Unusual traffic patterns

## Maintenance

### Update Infrastructure

**With Terraform:**
```bash
cd terraform
# Edit .tf files
terraform plan
terraform apply
```

**With Scripts:**
```bash
# Re-run setup script
cd scripts
./setup-gcp.sh
```

### Backup

Bucket lifecycle rules are configured but consider:
- Versioning for critical buckets
- Regular backups of important content
- Documentation of infrastructure

### Cleanup

**To destroy everything:**
```bash
cd terraform
terraform destroy
```

**Or manually:**
```bash
# Delete forwarding rules
gcloud compute forwarding-rules delete fellspiral-http-forwarding-rule --global

# Delete proxies and URL maps
gcloud compute target-http-proxies delete fellspiral-http-proxy
gcloud compute url-maps delete fellspiral-url-map

# Delete backend bucket
gcloud compute backend-buckets delete fellspiral-backend

# Delete IP
gcloud compute addresses delete fellspiral-site-ip --global

# Delete bucket (careful!)
gsutil rm -r gs://your-bucket-name
```

## Troubleshooting

### Deployment Fails

**Check authentication:**
```bash
gcloud auth list
gcloud config get-value project
```

**Check bucket exists:**
```bash
gsutil ls -b gs://your-bucket-name
```

### Site Not Accessible

**Check bucket is public:**
```bash
gsutil iam get gs://your-bucket-name
```

**Check files uploaded:**
```bash
gsutil ls gs://your-bucket-name
```

**Check load balancer:**
```bash
gcloud compute forwarding-rules describe fellspiral-http-forwarding-rule --global
```

### High Costs

**Check egress:**
```bash
gcloud logging read "resource.type=gcs_bucket AND metric.type=storage.googleapis.com/network/sent_bytes_count"
```

**Check CDN hit rate:**
```bash
gcloud monitoring read "compute.googleapis.com/https/request_count" --project=your-project
```

**Review cache settings:**
```bash
gcloud compute backend-buckets describe fellspiral-backend
```

## HTTPS Setup

To enable HTTPS:

1. **Obtain SSL certificate:**
   - Use Google-managed certificate (recommended)
   - Or upload your own certificate

2. **Update Terraform:**
   - Uncomment HTTPS resources in `main.tf`
   - Add certificate configuration
   - Apply changes

3. **Update DNS:**
   - Point domain to static IP
   - Wait for DNS propagation

4. **Test:**
   - Verify HTTPS works
   - Check certificate validity
   - Test redirects

## Additional Resources

- [GCP Cloud Storage Documentation](https://cloud.google.com/storage/docs)
- [GCP Cloud CDN Documentation](https://cloud.google.com/cdn/docs)
- [Terraform GCP Provider](https://registry.terraform.io/providers/hashicorp/google/latest/docs)
- [Cost Optimization Best Practices](https://cloud.google.com/architecture/cost-optimization-best-practices)
