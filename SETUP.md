# Setup Guide

This guide walks you through setting up the Fellspiral monorepo for local development and deployment to GCP.

## Prerequisites

- Node.js 20 or higher
- npm
- Git
- Google Cloud Platform account (for deployment)
- gcloud CLI (for deployment)

## Local Development Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd commons.systems
```

### 2. Install dependencies

```bash
npm install
```

This will install dependencies for all workspaces (site and tests).

### 3. Run the development server

```bash
npm run dev
```

The site will be available at `http://localhost:3000`.

### 4. Run tests locally

```bash
# Install Playwright browsers (first time only)
cd fellspiral/tests
npx playwright install

# Run all tests
npm test

# Run tests in UI mode
npm run test:ui

# Run tests in headed mode (see browser)
npm run test:headed
```

## GCP Deployment Setup

### Option 1: Automated Setup (Recommended)

Use the provided setup script:

```bash
cd infrastructure/scripts
./setup-gcp.sh
```

Follow the prompts to configure your GCP project.

### Option 2: Terraform Setup

If you prefer Infrastructure as Code:

```bash
cd infrastructure/terraform

# Copy example variables
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars with your project ID
vim terraform.tfvars

# Initialize Terraform
terraform init

# Review the plan
terraform plan

# Apply the configuration
terraform apply
```

### Option 3: Manual Setup

1. **Create a GCP project** at https://console.cloud.google.com

2. **Enable required APIs:**
   ```bash
   gcloud services enable compute.googleapis.com
   gcloud services enable storage.googleapis.com
   ```

3. **Create a storage bucket:**
   ```bash
   PROJECT_ID="your-project-id"
   BUCKET_NAME="${PROJECT_ID}-fellspiral-site"

   gsutil mb -p "$PROJECT_ID" -l us-central1 "gs://${BUCKET_NAME}"
   gsutil web set -m index.html -e index.html "gs://${BUCKET_NAME}"
   gsutil iam ch allUsers:objectViewer "gs://${BUCKET_NAME}"
   ```

4. **Set up Cloud CDN** (optional but recommended):
   ```bash
   # Create static IP
   gcloud compute addresses create fellspiral-site-ip --global

   # Create backend bucket
   gcloud compute backend-buckets create fellspiral-backend \
     --gcs-bucket-name="$BUCKET_NAME" \
     --enable-cdn

   # Create URL map
   gcloud compute url-maps create fellspiral-url-map \
     --default-backend-bucket=fellspiral-backend

   # Create HTTP proxy
   gcloud compute target-http-proxies create fellspiral-http-proxy \
     --url-map=fellspiral-url-map

   # Create forwarding rule
   gcloud compute forwarding-rules create fellspiral-http-forwarding-rule \
     --global \
     --target-http-proxy=fellspiral-http-proxy \
     --ports=80 \
     --address=fellspiral-site-ip
   ```

## GitHub Actions CI/CD Setup

### 1. Create a GCP Service Account

```bash
PROJECT_ID="your-project-id"
SA_NAME="github-actions-deployer"

# Create service account
gcloud iam service-accounts create $SA_NAME \
  --display-name="GitHub Actions Deployer"

# Grant necessary permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/compute.loadBalancerAdmin"

# Create and download key
gcloud iam service-accounts keys create key.json \
  --iam-account="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
```

### 2. Configure GitHub Secrets

Go to your GitHub repository settings > Secrets and variables > Actions, and add:

- `GCP_PROJECT_ID`: Your GCP project ID
- `GCP_SA_KEY`: Contents of the `key.json` file

### 3. Workflows

Three workflows are configured:

1. **CI** (`.github/workflows/ci.yml`): Runs on all pushes and PRs
   - Builds the site
   - Runs all tests
   - Uploads test reports

2. **Deploy** (`.github/workflows/deploy.yml`): Runs on push to main
   - Builds the site
   - Runs tests
   - Deploys to GCP
   - Runs tests against deployed site

3. **Health Check** (`.github/workflows/health-check.yml`): Runs every 6 hours
   - Tests the deployed site
   - Creates an issue if health check fails

## Manual Deployment

You can also deploy manually:

```bash
cd infrastructure/scripts

# Copy environment example
cp .env.example .env

# Edit .env with your project details
vim .env

# Deploy
./deploy.sh
```

## Cost Optimization

The infrastructure is designed to minimize costs:

1. **Storage**: Class A operations ($0.05/10k ops), Storage ($0.020/GB/month)
2. **CDN**: Cache hits are cheap ($0.04-0.08/GB), origin fetches minimized
3. **Lifecycle Policies**: Configured in Terraform to reduce storage costs
4. **Static IP**: $0 (free when attached to a forwarding rule)

**Estimated monthly cost for typical traffic:** < $1

### Additional Cost Saving Tips

- Use Cloud CDN cache effectively (already configured)
- Set appropriate cache headers (handled by deploy script)
- Monitor usage in GCP Console
- Consider using a custom domain with Cloud CDN for better caching

## Monitoring

### View Deployment Status

Check GitHub Actions tab in your repository.

### View Site Metrics

```bash
# View bucket storage
gsutil du -sh gs://your-bucket-name

# View request logs
gcloud logging read "resource.type=gcs_bucket"

# View CDN metrics
gcloud compute backend-buckets describe fellspiral-backend
```

## Troubleshooting

### Tests Failing Locally

```bash
# Update Playwright browsers
cd fellspiral/tests
npx playwright install --with-deps
```

### Deployment Failing

```bash
# Check authentication
gcloud auth list

# Check project
gcloud config get-value project

# Check bucket exists
gsutil ls -b gs://your-bucket-name
```

### Site Not Loading

1. Check bucket is public:
   ```bash
   gsutil iam get gs://your-bucket-name
   ```

2. Check files were uploaded:
   ```bash
   gsutil ls gs://your-bucket-name
   ```

3. Check CDN configuration:
   ```bash
   gcloud compute url-maps describe fellspiral-url-map
   ```

## Next Steps

- Set up a custom domain
- Configure HTTPS (requires SSL certificate)
- Add monitoring and alerts
- Set up staging environment
