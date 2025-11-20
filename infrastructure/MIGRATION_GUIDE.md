# Cloud Run Migration Guide

This guide documents the migration from GCS + CDN architecture to Cloud Run architecture.

## Overview

**Old Architecture:**
- Static files hosted in Google Cloud Storage (GCS)
- Cloud CDN for global distribution
- Load balancer with static IP
- Manual backup/rollback using GCS buckets

**New Architecture:**
- Docker containers running on Cloud Run
- nginx alpine for static file serving
- Managed HTTPS and global load balancing included
- Automatic rollback using Cloud Run revisions
- Consistent deployment for both production and feature branches

## Migration Status

- ✅ Cloud Run deployment workflows created
- ✅ Feature branch preview deployments configured
- ✅ Production deployment workflow updated
- ✅ Terraform configuration updated
- ⏳ Old infrastructure cleanup (manual step required)

## Post-Migration Cleanup

**Good news:** Terraform handles all cleanup automatically! No manual intervention needed.

### Prerequisites

Before cleanup (automatic via Terraform), ensure:

1. ✅ Cloud Run production deployment is working and accessible
2. ✅ DNS is updated (if you had custom domain pointing to static IP)
3. ✅ All required data is backed up from GCS buckets (if needed)
4. ✅ Team has tested and approved the new Cloud Run deployment

### Step 1: Verify Cloud Run Deployment

Check that your production Cloud Run service is running:

```bash
gcloud run services describe fellspiral-site \
  --region=us-central1 \
  --project=chalanding \
  --format='value(status.url)'
```

Visit the URL and verify the site works correctly.

### Step 2: Update DNS (if applicable)

If you were using a custom domain with the old static IP:

1. Get the Cloud Run service URL from Step 1
2. Update your DNS records to point to the Cloud Run URL
3. Wait for DNS propagation (can take up to 48 hours)
4. Verify the custom domain works with Cloud Run

**Note:** Cloud Run provides automatic SSL certificates for custom domains.

### Step 3: Terraform Automatic Cleanup

Once the PR is merged to main, the Infrastructure workflow will run automatically.

**What happens:**
1. Infrastructure workflow runs `terraform apply`
2. Terraform detects old resources are no longer in configuration
3. Terraform automatically destroys:
   - GCS buckets (site + backup)
   - Load balancer components (URL map, HTTP proxy, forwarding rule)
   - Backend bucket (Cloud CDN)
   - Static IP address
4. Terraform updates state to reflect the removal

**No manual intervention needed!** Terraform handles everything.

### Step 4: Monitor the Cleanup

Watch the Infrastructure workflow:

```bash
# Via GitHub Actions UI
# https://github.com/rumor-ml/commons.systems/actions/workflows/infrastructure.yml

# Or check Terraform plan (before merge)
cd infrastructure/terraform
terraform plan
```

The plan will show resources being destroyed.

### Optional: Manual Backup Before Cleanup

If you want to backup GCS data before Terraform destroys the buckets:

```bash
# Create local backup of site bucket
gsutil -m rsync -r gs://chalanding-fellspiral-site ./gcs-backup/site/

# Create local backup of backup bucket
gsutil -m rsync -r gs://chalanding-fellspiral-site-backup ./gcs-backup/backup/
```

Store these backups somewhere safe before merging the PR.

## Resources Removed

The following GCP resources are removed during cleanup:

1. **GCS Buckets:**
   - `chalanding-fellspiral-site` (production site files)
   - `chalanding-fellspiral-site-backup` (rollback backups)

2. **Load Balancer Components:**
   - `fellspiral-http-forwarding-rule` (forwarding rule)
   - `fellspiral-http-proxy` (HTTP proxy)
   - `fellspiral-url-map` (URL map)
   - `fellspiral-backend` (backend bucket)

3. **Networking:**
   - `fellspiral-site-ip` (static IP address)

## Cost Impact

**Before (GCS + CDN):**
- GCS storage: ~$0.01/month
- CDN bandwidth: ~$0.10/month (1000 visitors)
- Static IP: ~$0.01/month
- Load balancer: ~$0.01/month
- **Total: ~$0.13/month**

**After (Cloud Run):**
- Cloud Run (production, min-instances=1): ~$5-10/month
- Artifact Registry storage: ~$0.10/month
- Feature branch previews: ~$0.00/month (scale to zero)
- **Total: ~$5-10/month**

**Note:** Cost increase is due to always-on production instance (min-instances=1) to avoid cold starts. If cold starts are acceptable, you can set min-instances=0 to reduce cost to ~$0.10/month.

To reduce production costs to near-zero:

```bash
# In .github/workflows/deploy.yml, change line 191:
--min-instances=0 \  # Instead of --min-instances=1
```

This trades cost for ~2-3 second cold start on first request.

## Benefits of Cloud Run Architecture

1. **Consistency:** Same deployment method for main and feature branches
2. **Developer Experience:** Automatic preview URLs for every feature branch
3. **Simplicity:** No separate CDN, load balancer, or static IP to manage
4. **HTTPS:** Managed SSL certificates included at no extra cost
5. **Rollback:** Instant rollback to previous revisions
6. **Scalability:** Auto-scales from 0 (or 1) to 10 instances based on traffic
7. **Global:** Cloud Run uses Google's global network automatically

## Rollback to GCS (Emergency)

If you need to rollback to the old GCS architecture:

1. The cleanup script creates backups in `gcs-migration-backup-{timestamp}/`
2. Use `gsutil` to restore files to GCS
3. Re-run the old Terraform configuration
4. Update DNS back to static IP

**Note:** This should only be needed if there's a critical issue with Cloud Run.

## Questions?

If you encounter issues during migration:

1. Check GitHub Actions workflow logs
2. Check Cloud Run service logs: `gcloud run logs read fellspiral-site --region=us-central1`
3. Verify IAM permissions for service account
4. Open an issue on the repository

## Timeline

Recommended migration timeline:

- **Week 1:** Deploy to Cloud Run (main branch)
- **Week 2:** Monitor Cloud Run performance and costs
- **Week 3:** Test feature branch previews
- **Week 4:** Run cleanup script and remove old infrastructure

Take your time and verify each step works before proceeding to cleanup.
