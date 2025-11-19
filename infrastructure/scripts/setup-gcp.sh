#!/bin/bash
set -euo pipefail

# GCP Infrastructure Setup Script
# Sets up Cloud Storage bucket and Cloud CDN for static site hosting

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Fellspiral GCP Infrastructure Setup${NC}"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
  echo -e "${RED}Error: gcloud CLI not found${NC}"
  echo "Please install it from: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

# Get project ID
echo "Enter your GCP Project ID:"
read -r PROJECT_ID

# Set project
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo -e "${YELLOW}Enabling required GCP APIs...${NC}"
gcloud services enable compute.googleapis.com
gcloud services enable storage.googleapis.com
gcloud services enable cloudresourcemanager.googleapis.com

BUCKET_NAME="${PROJECT_ID}-fellspiral-site"
REGION="us-central1"

# Create storage bucket
echo -e "${YELLOW}Creating Cloud Storage bucket...${NC}"
if gsutil ls -b "gs://${BUCKET_NAME}" 2>/dev/null; then
  echo "Bucket already exists"
else
  gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://${BUCKET_NAME}"
  echo -e "${GREEN}Bucket created${NC}"
fi

# Configure bucket for website hosting
echo -e "${YELLOW}Configuring bucket for website hosting...${NC}"
gsutil web set -m index.html -e index.html "gs://${BUCKET_NAME}"

# Make bucket public
echo -e "${YELLOW}Making bucket publicly readable...${NC}"
gsutil iam ch allUsers:objectViewer "gs://${BUCKET_NAME}"

# Configure CORS
echo -e "${YELLOW}Configuring CORS...${NC}"
cat > /tmp/cors.json <<EOF
[
  {
    "origin": ["*"],
    "method": ["GET", "HEAD"],
    "responseHeader": ["Content-Type"],
    "maxAgeSeconds": 3600
  }
]
EOF
gsutil cors set /tmp/cors.json "gs://${BUCKET_NAME}"
rm /tmp/cors.json

# Create static IP
echo -e "${YELLOW}Creating static IP address...${NC}"
if gcloud compute addresses describe fellspiral-site-ip --global 2>/dev/null; then
  echo "Static IP already exists"
  STATIC_IP=$(gcloud compute addresses describe fellspiral-site-ip --global --format="value(address)")
else
  gcloud compute addresses create fellspiral-site-ip --global
  STATIC_IP=$(gcloud compute addresses describe fellspiral-site-ip --global --format="value(address)")
  echo -e "${GREEN}Static IP created: $STATIC_IP${NC}"
fi

# Create backend bucket
echo -e "${YELLOW}Creating backend bucket for Cloud CDN...${NC}"
if gcloud compute backend-buckets describe fellspiral-backend 2>/dev/null; then
  echo "Backend bucket already exists"
else
  gcloud compute backend-buckets create fellspiral-backend \
    --gcs-bucket-name="$BUCKET_NAME" \
    --enable-cdn
  echo -e "${GREEN}Backend bucket created with CDN enabled${NC}"
fi

# Create URL map
echo -e "${YELLOW}Creating URL map...${NC}"
if gcloud compute url-maps describe fellspiral-url-map 2>/dev/null; then
  echo "URL map already exists"
else
  gcloud compute url-maps create fellspiral-url-map \
    --default-backend-bucket=fellspiral-backend
  echo -e "${GREEN}URL map created${NC}"
fi

# Create HTTP proxy
echo -e "${YELLOW}Creating HTTP proxy...${NC}"
if gcloud compute target-http-proxies describe fellspiral-http-proxy 2>/dev/null; then
  echo "HTTP proxy already exists"
else
  gcloud compute target-http-proxies create fellspiral-http-proxy \
    --url-map=fellspiral-url-map
  echo -e "${GREEN}HTTP proxy created${NC}"
fi

# Create forwarding rule
echo -e "${YELLOW}Creating forwarding rule...${NC}"
if gcloud compute forwarding-rules describe fellspiral-http-forwarding-rule --global 2>/dev/null; then
  echo "Forwarding rule already exists"
else
  gcloud compute forwarding-rules create fellspiral-http-forwarding-rule \
    --global \
    --target-http-proxy=fellspiral-http-proxy \
    --ports=80 \
    --address=fellspiral-site-ip
  echo -e "${GREEN}Forwarding rule created${NC}"
fi

echo ""
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "Bucket name: $BUCKET_NAME"
echo "Static IP: $STATIC_IP"
echo "Site URL: http://$STATIC_IP"
echo ""
echo "To deploy your site, run:"
echo "  cd infrastructure/scripts"
echo "  ./deploy.sh"
echo ""
echo "Don't forget to update DNS if you have a custom domain:"
echo "  A record: @ -> $STATIC_IP"
echo "  A record: www -> $STATIC_IP"
