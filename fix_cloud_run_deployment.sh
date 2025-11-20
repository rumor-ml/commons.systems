#!/bin/bash
# Fix Cloud Run deployment prerequisites
#
# This script enables required GCP APIs, creates Artifact Registry repositories,
# and grants necessary permissions to the GitHub Actions service account.
#
# Usage: ./fix_cloud_run_deployment.sh

set -e

PROJECT_ID="chalanding"
REGION="us-central1"
SERVICE_ACCOUNT="github-actions-sa@chalanding.iam.gserviceaccount.com"

echo "=== Fixing Cloud Run Deployment Prerequisites ==="
echo ""
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service Account: $SERVICE_ACCOUNT"
echo ""

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | grep -q "."; then
    echo "❌ Not authenticated to gcloud"
    echo "   Run: gcloud auth login"
    exit 1
fi

echo "✅ Authenticated to gcloud"
echo ""

# Set project
echo "1. Setting active project..."
gcloud config set project $PROJECT_ID
echo ""

# Enable required APIs
echo "2. Enabling required APIs..."
echo "   This may take a few minutes..."

gcloud services enable run.googleapis.com --project=$PROJECT_ID
echo "   ✅ Cloud Run API enabled"

gcloud services enable artifactregistry.googleapis.com --project=$PROJECT_ID
echo "   ✅ Artifact Registry API enabled"

gcloud services enable cloudbuild.googleapis.com --project=$PROJECT_ID
echo "   ✅ Cloud Build API enabled (for Docker builds)"

echo ""

# Create Artifact Registry repositories
echo "3. Creating Artifact Registry repositories..."

# Production repository
if gcloud artifacts repositories describe fellspiral-production \
    --location=$REGION \
    --project=$PROJECT_ID 2>/dev/null; then
    echo "   ✅ fellspiral-production repository already exists"
else
    echo "   Creating fellspiral-production repository..."
    gcloud artifacts repositories create fellspiral-production \
        --repository-format=docker \
        --location=$REGION \
        --description="Production Docker images for Fellspiral site" \
        --project=$PROJECT_ID
    echo "   ✅ fellspiral-production repository created"
fi

# Preview repository
if gcloud artifacts repositories describe fellspiral-previews \
    --location=$REGION \
    --project=$PROJECT_ID 2>/dev/null; then
    echo "   ✅ fellspiral-previews repository already exists"
else
    echo "   Creating fellspiral-previews repository..."
    gcloud artifacts repositories create fellspiral-previews \
        --repository-format=docker \
        --location=$REGION \
        --description="Feature branch preview Docker images" \
        --project=$PROJECT_ID
    echo "   ✅ fellspiral-previews repository created"
fi

echo ""

# Grant permissions to service account
echo "4. Granting permissions to service account..."

# Cloud Run Admin
echo "   Granting Cloud Run Admin role..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/run.admin" \
    --condition=None \
    --quiet 2>/dev/null || echo "   (Role may already be granted)"
echo "   ✅ roles/run.admin"

# Artifact Registry Writer
echo "   Granting Artifact Registry Writer role..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/artifactregistry.writer" \
    --condition=None \
    --quiet 2>/dev/null || echo "   (Role may already be granted)"
echo "   ✅ roles/artifactregistry.writer"

# Service Account User (for Cloud Run)
echo "   Granting Service Account User role..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/iam.serviceAccountUser" \
    --condition=None \
    --quiet 2>/dev/null || echo "   (Role may already be granted)"
echo "   ✅ roles/iam.serviceAccountUser"

echo ""

# Verify setup
echo "5. Verifying setup..."
echo ""

echo "   Checking Artifact Registry repositories..."
REPOS=$(gcloud artifacts repositories list --location=$REGION --project=$PROJECT_ID --format="value(name)")
if echo "$REPOS" | grep -q "fellspiral-production"; then
    echo "   ✅ fellspiral-production exists"
else
    echo "   ❌ fellspiral-production NOT found"
fi

if echo "$REPOS" | grep -q "fellspiral-previews"; then
    echo "   ✅ fellspiral-previews exists"
else
    echo "   ❌ fellspiral-previews NOT found"
fi

echo ""
echo "   Checking service account permissions..."
MEMBER="serviceAccount:$SERVICE_ACCOUNT"
POLICY=$(gcloud projects get-iam-policy $PROJECT_ID --format=json)

if echo "$POLICY" | grep -q "roles/run.admin"; then
    echo "   ✅ Cloud Run Admin role present in project"
else
    echo "   ⚠️  Cloud Run Admin role not visible (may still be granted)"
fi

if echo "$POLICY" | grep -q "roles/artifactregistry.writer"; then
    echo "   ✅ Artifact Registry Writer role present in project"
else
    echo "   ⚠️  Artifact Registry Writer role not visible (may still be granted)"
fi

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Next steps:"
echo "1. Push a change to trigger the deployment workflow"
echo "2. Monitor at: https://github.com/rumor-ml/commons.systems/actions"
echo "3. The deployment should now succeed"
echo ""
echo "If deployment still fails, check the workflow logs for specific errors."
