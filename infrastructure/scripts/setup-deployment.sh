#!/bin/bash
set -euo pipefail

# One-Command Deployment Setup
# This script automates GCP infrastructure setup and generates GitHub secrets

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Fellspiral Deployment Setup${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""

# Check prerequisites
if ! command -v gcloud &> /dev/null; then
  echo -e "${RED}Error: gcloud CLI not installed${NC}"
  echo "Install from: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

# Get project ID
echo -e "${BLUE}Enter your GCP Project ID:${NC}"
read -r PROJECT_ID

if [ -z "$PROJECT_ID" ]; then
  echo -e "${RED}Error: Project ID cannot be empty${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}Setting up infrastructure for project: ${PROJECT_ID}${NC}"
echo ""

# Set project
gcloud config set project "$PROJECT_ID"

# Enable APIs
echo -e "${YELLOW}[1/5] Enabling required GCP APIs...${NC}"
gcloud services enable compute.googleapis.com storage.googleapis.com cloudresourcemanager.googleapis.com --quiet

BUCKET_NAME="${PROJECT_ID}-fellspiral-site"
REGION="us-central1"

# Create bucket
echo -e "${YELLOW}[2/5] Creating Cloud Storage bucket...${NC}"
if gsutil ls -b "gs://${BUCKET_NAME}" 2>/dev/null; then
  echo "  → Bucket already exists"
else
  gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://${BUCKET_NAME}"
  gsutil web set -m index.html -e index.html "gs://${BUCKET_NAME}"
  gsutil iam ch allUsers:objectViewer "gs://${BUCKET_NAME}"

  # CORS
  cat > /tmp/cors.json <<EOF
[{"origin": ["*"], "method": ["GET", "HEAD"], "responseHeader": ["Content-Type"], "maxAgeSeconds": 3600}]
EOF
  gsutil cors set /tmp/cors.json "gs://${BUCKET_NAME}"
  rm /tmp/cors.json
  echo -e "  ${GREEN}→ Bucket created${NC}"
fi

# Create static IP
echo -e "${YELLOW}[3/5] Creating static IP address...${NC}"
if gcloud compute addresses describe fellspiral-site-ip --global 2>/dev/null; then
  echo "  → Static IP already exists"
  STATIC_IP=$(gcloud compute addresses describe fellspiral-site-ip --global --format="value(address)")
else
  gcloud compute addresses create fellspiral-site-ip --global --quiet
  STATIC_IP=$(gcloud compute addresses describe fellspiral-site-ip --global --format="value(address)")
  echo -e "  ${GREEN}→ Static IP created: $STATIC_IP${NC}"
fi

# Create backend bucket
echo -e "${YELLOW}[4/5] Setting up Cloud CDN...${NC}"
if gcloud compute backend-buckets describe fellspiral-backend 2>/dev/null; then
  echo "  → Backend bucket already exists"
else
  gcloud compute backend-buckets create fellspiral-backend \
    --gcs-bucket-name="$BUCKET_NAME" \
    --enable-cdn --quiet
fi

# URL map
if ! gcloud compute url-maps describe fellspiral-url-map 2>/dev/null; then
  gcloud compute url-maps create fellspiral-url-map \
    --default-backend-bucket=fellspiral-backend --quiet
fi

# HTTP proxy
if ! gcloud compute target-http-proxies describe fellspiral-http-proxy 2>/dev/null; then
  gcloud compute target-http-proxies create fellspiral-http-proxy \
    --url-map=fellspiral-url-map --quiet
fi

# Forwarding rule
if ! gcloud compute forwarding-rules describe fellspiral-http-forwarding-rule --global 2>/dev/null; then
  gcloud compute forwarding-rules create fellspiral-http-forwarding-rule \
    --global --target-http-proxy=fellspiral-http-proxy \
    --ports=80 --address=fellspiral-site-ip --quiet
fi

echo -e "  ${GREEN}→ CDN configured${NC}"

# Create service account for GitHub Actions
echo -e "${YELLOW}[5/5] Creating GitHub Actions service account...${NC}"
SA_NAME="github-actions-deployer"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe "$SA_EMAIL" 2>/dev/null; then
  echo "  → Service account already exists"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="GitHub Actions Deployer" --quiet
  echo -e "  ${GREEN}→ Service account created${NC}"
fi

# Grant permissions
echo "  → Granting permissions..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.admin" \
  --condition=None --quiet 2>/dev/null || true

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/compute.loadBalancerAdmin" \
  --condition=None --quiet 2>/dev/null || true

# Create key
KEY_FILE="github-actions-key.json"
if [ -f "$KEY_FILE" ]; then
  echo "  → Key file already exists, skipping..."
else
  gcloud iam service-accounts keys create "$KEY_FILE" \
    --iam-account="$SA_EMAIL" --quiet
  echo -e "  ${GREEN}→ Service account key created: $KEY_FILE${NC}"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup Complete! ✓${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Infrastructure Details:${NC}"
echo "  Bucket: gs://${BUCKET_NAME}"
echo "  Static IP: ${STATIC_IP}"
echo "  Site URL: http://${STATIC_IP}"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo ""
echo -e "${YELLOW}1. Add GitHub Secrets${NC}"
echo "   Go to: https://github.com/rumor-ml/commons.systems/settings/secrets/actions"
echo ""
echo "   Add these two secrets:"
echo ""
echo "   ${BLUE}Secret 1: GCP_PROJECT_ID${NC}"
echo "   Value: ${PROJECT_ID}"
echo ""
echo "   ${BLUE}Secret 2: GCP_SA_KEY${NC}"
echo "   Value: (paste the content below)"
echo ""
echo -e "${YELLOW}▼ Copy this entire JSON (including braces):"
cat "$KEY_FILE"
echo -e "${YELLOW}▲ Copy until here${NC}"
echo ""
echo -e "${YELLOW}2. Merge Your PR${NC}"
echo "   Once secrets are added, merge your PR to main"
echo "   → Site will automatically deploy to: http://${STATIC_IP}"
echo ""
echo -e "${YELLOW}3. Optional: Test Manual Deployment${NC}"
echo "   cd infrastructure/scripts"
echo "   GCP_PROJECT_ID=$PROJECT_ID BUCKET_NAME=$BUCKET_NAME ./deploy.sh"
echo ""
echo -e "${GREEN}Cost: ~\$0.13/month for typical traffic${NC}"
echo ""
