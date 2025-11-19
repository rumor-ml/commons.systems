#!/bin/bash
set -euo pipefail

# One-Time Workload Identity Setup
# This enables keyless authentication from GitHub Actions to GCP

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Fellspiral Workload Identity Setup${NC}"
echo -e "${GREEN}  One-time setup for keyless GitHub Actions → GCP auth${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
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

# Get GitHub repo
REPO_OWNER="${GITHUB_REPO_OWNER:-rumor-ml}"
REPO_NAME="${GITHUB_REPO_NAME:-commons.systems}"

echo ""
echo -e "${BLUE}GitHub Repository:${NC} ${REPO_OWNER}/${REPO_NAME}"
echo -e "${YELLOW}If incorrect, press Ctrl+C and set GITHUB_REPO_OWNER and GITHUB_REPO_NAME${NC}"
echo ""
read -p "Press Enter to continue..."

# Set project
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo ""
echo -e "${YELLOW}[1/4] Enabling required APIs...${NC}"
gcloud services enable \
  iam.googleapis.com \
  cloudresourcemanager.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --quiet

echo -e "  ${GREEN}→ APIs enabled${NC}"

# Create Workload Identity Pool
echo -e "${YELLOW}[2/4] Creating Workload Identity Pool...${NC}"
POOL_NAME="github-actions-pool"

if gcloud iam workload-identity-pools describe "$POOL_NAME" \
  --location="global" 2>/dev/null; then
  echo "  → Pool already exists"
else
  gcloud iam workload-identity-pools create "$POOL_NAME" \
    --location="global" \
    --display-name="GitHub Actions Pool" \
    --quiet
  echo -e "  ${GREEN}→ Pool created${NC}"
fi

# Create Workload Identity Provider
echo -e "${YELLOW}[3/4] Creating Workload Identity Provider...${NC}"
PROVIDER_NAME="github-actions-provider"

if gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
  --workload-identity-pool="$POOL_NAME" \
  --location="global" 2>/dev/null; then
  echo "  → Provider already exists"
else
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
    --workload-identity-pool="$POOL_NAME" \
    --location="global" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository_owner == '${REPO_OWNER}'" \
    --quiet
  echo -e "  ${GREEN}→ Provider created${NC}"
fi

# Create Service Account
echo -e "${YELLOW}[4/4] Creating Service Account...${NC}"
SA_NAME="github-actions-terraform"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe "$SA_EMAIL" 2>/dev/null; then
  echo "  → Service account already exists"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="GitHub Actions Terraform" \
    --quiet
  echo -e "  ${GREEN}→ Service account created${NC}"
fi

# Grant permissions to service account
echo "  → Granting permissions..."
for role in \
  "roles/storage.admin" \
  "roles/compute.loadBalancerAdmin" \
  "roles/iam.serviceAccountAdmin" \
  "roles/iam.serviceAccountUser" \
  "roles/resourcemanager.projectIamAdmin"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$role" \
    --condition=None \
    --quiet 2>/dev/null || true
done

# Allow GitHub Actions to impersonate the service account
echo "  → Allowing GitHub Actions to impersonate service account..."
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/${REPO_OWNER}/${REPO_NAME}" \
  --role="roles/iam.workloadIdentityUser" \
  --quiet 2>/dev/null || {
    # Get project number if not set
    PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
    gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
      --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/${REPO_OWNER}/${REPO_NAME}" \
      --role="roles/iam.workloadIdentityUser" \
      --quiet
  }

echo -e "  ${GREEN}→ Permissions granted${NC}"

# Get project number
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")

# Get workload identity provider resource name
WI_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  GCP Setup Complete! ✅${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
echo ""

# Check if gh CLI is available
if command -v gh &> /dev/null; then
  echo -e "${BLUE}GitHub CLI detected!${NC}"
  echo ""
  echo -e "${YELLOW}Do you want to automatically create GitHub secrets?${NC}"
  echo "This will add the following secrets to ${REPO_OWNER}/${REPO_NAME}:"
  echo "  - GCP_PROJECT_ID"
  echo "  - GCP_WORKLOAD_IDENTITY_PROVIDER"
  echo "  - GCP_SERVICE_ACCOUNT"
  echo ""
  read -p "Create secrets automatically? (y/N): " -n 1 -r
  echo ""

  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${YELLOW}Creating GitHub secrets...${NC}"

    # Set secrets using gh CLI
    echo "$PROJECT_ID" | gh secret set GCP_PROJECT_ID -R "${REPO_OWNER}/${REPO_NAME}"
    echo "$WI_PROVIDER" | gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER -R "${REPO_OWNER}/${REPO_NAME}"
    echo "$SA_EMAIL" | gh secret set GCP_SERVICE_ACCOUNT -R "${REPO_OWNER}/${REPO_NAME}"

    echo -e "${GREEN}✅ GitHub secrets created successfully!${NC}"
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  All Done! 🚀${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "1. Merge your PR to main"
    echo "2. Infrastructure will be created automatically"
    echo "3. Site will deploy automatically"
    echo ""
    echo -e "${GREEN}That's it! Fully automated deployment ready! 🎉${NC}"
  else
    echo ""
    echo -e "${YELLOW}Skipping automatic secret creation.${NC}"
    echo ""
    echo -e "${BLUE}Manually add these secrets to GitHub:${NC}"
    echo "Go to: https://github.com/${REPO_OWNER}/${REPO_NAME}/settings/secrets/actions"
    echo ""
    echo -e "${YELLOW}Secret 1: GCP_PROJECT_ID${NC}"
    echo "${PROJECT_ID}"
    echo ""
    echo -e "${YELLOW}Secret 2: GCP_WORKLOAD_IDENTITY_PROVIDER${NC}"
    echo "${WI_PROVIDER}"
    echo ""
    echo -e "${YELLOW}Secret 3: GCP_SERVICE_ACCOUNT${NC}"
    echo "${SA_EMAIL}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "1. Add the 3 secrets above to GitHub"
    echo "2. Merge your PR to main"
    echo "3. Infrastructure will be created automatically"
    echo "4. Site will deploy automatically"
  fi
else
  echo -e "${YELLOW}GitHub CLI (gh) not found.${NC}"
  echo "Install it from: https://cli.github.com/"
  echo "Then run: gh auth login"
  echo ""
  echo -e "${BLUE}Manually add these secrets to GitHub:${NC}"
  echo "Go to: https://github.com/${REPO_OWNER}/${REPO_NAME}/settings/secrets/actions"
  echo ""
  echo -e "${YELLOW}Secret 1: GCP_PROJECT_ID${NC}"
  echo "${PROJECT_ID}"
  echo ""
  echo -e "${YELLOW}Secret 2: GCP_WORKLOAD_IDENTITY_PROVIDER${NC}"
  echo "${WI_PROVIDER}"
  echo ""
  echo -e "${YELLOW}Secret 3: GCP_SERVICE_ACCOUNT${NC}"
  echo "${SA_EMAIL}"
  echo ""
  echo -e "${BLUE}Next steps:${NC}"
  echo "1. Add the 3 secrets above to GitHub"
  echo "2. Merge your PR to main"
  echo "3. Infrastructure will be created automatically"
  echo "4. Site will deploy automatically"
fi

echo ""
echo -e "${GREEN}No keys, no tokens, fully automated! 🚀${NC}"
echo ""
