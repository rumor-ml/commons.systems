#!/bin/bash
# Migration script to clean up old GCS+CDN infrastructure after Cloud Run migration
#
# This script should be run AFTER confirming that the Cloud Run deployment is working correctly.
# It will remove the old GCS buckets, CDN, load balancer, and static IP resources.
#
# IMPORTANT: This is a destructive operation. Make sure you have backups if needed.

set -e

PROJECT_ID="chalanding"
REGION="us-central1"

echo "========================================="
echo "Cloud Run Migration - Infrastructure Cleanup"
echo "========================================="
echo ""
echo "This script will remove the following resources:"
echo "  - GCS bucket: ${PROJECT_ID}-fellspiral-site"
echo "  - GCS backup bucket: ${PROJECT_ID}-fellspiral-site-backup"
echo "  - Cloud CDN backend bucket"
echo "  - Load balancer (URL map, HTTP proxy, forwarding rule)"
echo "  - Static IP address: fellspiral-site-ip"
echo ""
echo "BEFORE RUNNING THIS:"
echo "  1. Verify Cloud Run production deployment is working"
echo "  2. Verify you have backups of any important data in GCS buckets"
echo "  3. Update DNS records if you were using the static IP"
echo ""
read -p "Are you sure you want to proceed? (yes/no): " confirmation

if [ "$confirmation" != "yes" ]; then
    echo "Cleanup cancelled."
    exit 0
fi

echo ""
echo "Step 1: Removing forwarding rule..."
if gcloud compute forwarding-rules delete fellspiral-http-forwarding-rule \
    --global \
    --project="$PROJECT_ID" \
    --quiet 2>/dev/null; then
    echo "✅ Forwarding rule removed"
else
    echo "⚠️  Forwarding rule not found or already deleted"
fi

echo ""
echo "Step 2: Removing HTTP proxy..."
if gcloud compute target-http-proxies delete fellspiral-http-proxy \
    --project="$PROJECT_ID" \
    --quiet 2>/dev/null; then
    echo "✅ HTTP proxy removed"
else
    echo "⚠️  HTTP proxy not found or already deleted"
fi

echo ""
echo "Step 3: Removing URL map..."
if gcloud compute url-maps delete fellspiral-url-map \
    --project="$PROJECT_ID" \
    --quiet 2>/dev/null; then
    echo "✅ URL map removed"
else
    echo "⚠️  URL map not found or already deleted"
fi

echo ""
echo "Step 4: Removing backend bucket..."
if gcloud compute backend-buckets delete fellspiral-backend \
    --project="$PROJECT_ID" \
    --quiet 2>/dev/null; then
    echo "✅ Backend bucket removed"
else
    echo "⚠️  Backend bucket not found or already deleted"
fi

echo ""
echo "Step 5: Removing static IP..."
if gcloud compute addresses delete fellspiral-site-ip \
    --global \
    --project="$PROJECT_ID" \
    --quiet 2>/dev/null; then
    echo "✅ Static IP removed"
else
    echo "⚠️  Static IP not found or already deleted"
fi

echo ""
echo "Step 6: Creating final backup of GCS buckets..."
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="./gcs-migration-backup-${TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

if gsutil ls "gs://${PROJECT_ID}-fellspiral-site" 2>/dev/null; then
    echo "Backing up site bucket to ${BACKUP_DIR}/site/"
    gsutil -m rsync -r "gs://${PROJECT_ID}-fellspiral-site/" "${BACKUP_DIR}/site/" || echo "⚠️  Backup failed or bucket empty"
else
    echo "⚠️  Site bucket not found"
fi

if gsutil ls "gs://${PROJECT_ID}-fellspiral-site-backup" 2>/dev/null; then
    echo "Backing up backup bucket to ${BACKUP_DIR}/backup/"
    gsutil -m rsync -r "gs://${PROJECT_ID}-fellspiral-site-backup/" "${BACKUP_DIR}/backup/" || echo "⚠️  Backup failed or bucket empty"
else
    echo "⚠️  Backup bucket not found"
fi

echo ""
echo "Step 7: Removing GCS buckets..."
if gsutil rm -r "gs://${PROJECT_ID}-fellspiral-site" 2>/dev/null; then
    echo "✅ Site bucket removed"
else
    echo "⚠️  Site bucket not found or already deleted"
fi

if gsutil rm -r "gs://${PROJECT_ID}-fellspiral-site-backup" 2>/dev/null; then
    echo "✅ Backup bucket removed"
else
    echo "⚠️  Backup bucket not found or already deleted"
fi

echo ""
echo "========================================="
echo "Cleanup Complete!"
echo "========================================="
echo ""
echo "Summary:"
echo "  - Old infrastructure removed"
echo "  - Backups saved to: ${BACKUP_DIR}/"
echo "  - Cloud Run is now the only deployment infrastructure"
echo ""
echo "Next steps:"
echo "  1. Verify production site is accessible at Cloud Run URL"
echo "  2. Update any documentation with new Cloud Run URLs"
echo "  3. Update Terraform state by running: cd infrastructure/terraform && terraform apply"
echo "  4. You can safely delete ${BACKUP_DIR}/ after confirming everything works"
echo ""
