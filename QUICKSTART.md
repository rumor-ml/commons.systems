# Quick Start - Zero Local Setup Required

Get the Fellspiral site deployed to GCP in **5 minutes** with **zero local commands**.

## Prerequisites

- GitHub account with access to this repository
- Google Cloud Platform account
- GCP Project created

## Step 1: Create GCP Service Account (2 minutes)

1. Go to [GCP Console > IAM & Admin > Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)

2. Click **"Create Service Account"**
   - Name: `github-actions-terraform`
   - Description: `GitHub Actions for Terraform and deployments`

3. Click **"Create and Continue"**

4. Grant these roles:
   - `Storage Admin`
   - `Compute Load Balancer Admin`
   - `Service Account Admin`
   - `Project IAM Admin`

5. Click **"Done"**

6. Click on the service account you just created

7. Go to **"Keys"** tab → **"Add Key"** → **"Create new key"** → **JSON**

8. Save the JSON file (you'll need it next)

## Step 2: Configure GitHub Secrets (1 minute)

1. Go to your repo: **Settings** → **Secrets and variables** → **Actions**

2. Click **"New repository secret"**, add:

   **Secret 1:**
   - Name: `GCP_PROJECT_ID`
   - Value: `your-gcp-project-id`

   **Secret 2:**
   - Name: `GCP_SA_KEY`
   - Value: (paste entire contents of the JSON file from Step 1)

## Step 3: Create Pull Request (30 seconds)

1. Visit: https://github.com/rumor-ml/commons.systems/pull/new/claude/fellspiral-monorepo-setup-01UJV6E51Gorw8c7jC1mECNM

2. Click **"Create Pull Request"**

## Step 4: Run Infrastructure Setup (1 minute)

1. In your PR or main branch, go to **Actions** tab

2. Click **"Setup Infrastructure"** workflow

3. Click **"Run workflow"** → Select `apply` → **"Run workflow"**

4. Wait ~2 minutes for Terraform to create all GCP resources

5. Check the workflow summary for your site URL!

## Step 5: Merge and Deploy (30 seconds)

1. Merge your PR to `main`

2. The **Deploy** workflow runs automatically:
   - ✅ Builds the site
   - ✅ Runs all tests
   - ✅ Deploys to GCP
   - ✅ Validates deployment

3. Done! Your site is live at the URL from Step 4

## What Gets Created

### GCP Infrastructure (via Terraform)
- ✅ Cloud Storage bucket (website hosting)
- ✅ Cloud CDN (global delivery)
- ✅ Load Balancer (HTTP/HTTPS)
- ✅ Static IP address
- ✅ Service account for deployments

### Automation
- ✅ Tests run on every PR
- ✅ Auto-deploy on merge to main
- ✅ Health checks every 6 hours
- ✅ Test reports and artifacts

## Cost

**~$0.13/month** for typical traffic (~1000 visitors/month)

| Service | Cost |
|---------|------|
| Storage | ~$0.002 |
| Operations | ~$0.05 |
| CDN | ~$0.08 |
| Static IP | $0.00 (free) |

## Optional: Manual Infrastructure Control

### View Infrastructure
```bash
# In Actions tab → Setup Infrastructure → Run workflow → Select "plan"
```

### Destroy Infrastructure
```bash
# In Actions tab → Setup Infrastructure → Run workflow → Select "destroy"
```

### Update Infrastructure
Edit `infrastructure/terraform/*.tf` files, commit, and run the workflow again.

## Troubleshooting

### "Terraform init failed"
- Check that `GCP_SA_KEY` secret has the correct JSON (including braces)
- Verify the service account has all required roles

### "Permission denied"
- Ensure service account has these roles:
  - Storage Admin
  - Compute Load Balancer Admin
  - Service Account Admin
  - Project IAM Admin

### "Deploy workflow fails"
- Run the **Setup Infrastructure** workflow first
- Verify both GitHub secrets are set correctly

## Next Steps

- View your site at the URL from the workflow output
- Make changes to `fellspiral/site/src/` and push → auto-deploys!
- Add a custom domain (see [SETUP.md](SETUP.md))
- Enable HTTPS (see [infrastructure/README.md](infrastructure/README.md))

---

**That's it!** No local setup, no terminal commands, all automated via GitHub Actions.
