# Quick Start - Deploy in 2 Minutes

Deploy the Fellspiral site to GCP with **one local command** and **three GitHub secrets**.

## Overview

**Time:** 2 minutes
**Local commands:** 1 (30 seconds)
**Manual steps:** Add 3 GitHub secrets (90 seconds)
**Result:** Fully automated infrastructure + deployment

## Prerequisites

- Google Cloud Platform account
- GCP Project created
- `gcloud` CLI installed locally ([install guide](https://cloud.google.com/sdk/docs/install))

## Step 1: Run Setup Script (30 seconds)

```bash
cd infrastructure/scripts
./setup-workload-identity.sh
```

This script:
- ✅ Enables required GCP APIs
- ✅ Creates Workload Identity Pool & Provider (keyless auth)
- ✅ Creates service account with correct permissions
- ✅ Outputs the 3 values you need for GitHub secrets

**No keys, no tokens, completely secure!**

## Step 2: Add GitHub Secrets (90 seconds)

Go to: `https://github.com/rumor-ml/commons.systems/settings/secrets/actions`

Add these 3 secrets (values shown by the script):

| Secret Name | Value |
|-------------|-------|
| `GCP_PROJECT_ID` | Your GCP project ID |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/###/locations/global/workloadIdentityPools/...` |
| `GCP_SERVICE_ACCOUNT` | `github-actions-terraform@your-project.iam.gserviceaccount.com` |

## Step 3: Merge PR (30 seconds)

Merge your PR to `main`.

**What happens automatically:**

1. **Infrastructure workflow** runs:
   - ✅ Terraform creates Cloud Storage bucket
   - ✅ Terraform creates Cloud CDN + Load Balancer
   - ✅ Terraform creates Static IP
   - ✅ Terraform creates deployment service account
   - ⏱️ Takes ~2 minutes

2. **Deploy workflow** runs:
   - ✅ Builds the site
   - ✅ Runs full test suite
   - ✅ Deploys to GCP
   - ✅ Tests the deployed site
   - ⏱️ Takes ~5 minutes

3. **Done!** Your site is live at the IP shown in the workflow output.

## What You Get

### Automated Forever
- ✅ **Every PR** → Tests run automatically
- ✅ **Every merge to main** → Infrastructure updates (if changed) + site deploys
- ✅ **Every 6 hours** → Health checks
- ✅ **On failure** → GitHub issue created

### Infrastructure Updates
Edit any file in `infrastructure/terraform/` and commit:
- **On PR** → Terraform plan shown in PR comment
- **On merge** → Terraform apply runs automatically
- **Service account, CDN, storage** → All managed by Terraform

### Zero Maintenance
- No keys to rotate (Workload Identity is keyless)
- No manual deployments
- No infrastructure drift
- Infrastructure as Code in Git

## Cost

**~$0.13/month** for typical traffic (~1000 visitors/month)

| Service | Monthly Cost |
|---------|--------------|
| Storage (100MB) | $0.002 |
| Operations (10k) | $0.05 |
| CDN (1GB egress) | $0.08 |
| Static IP | $0.00 (free when attached) |

## What's Different?

### Old Way (Manual)
1. Create service account manually
2. Download key JSON (security risk)
3. Add key to GitHub secrets
4. Manually run infrastructure setup
5. Manually trigger deployments
6. Rotate keys periodically

### New Way (Automated)
1. Run one script (`setup-workload-identity.sh`)
2. Add 3 secrets (no keys!)
3. Merge PR → everything automatic forever

## Troubleshooting

### "Workload Identity Provider not found"
- Make sure you ran `setup-workload-identity.sh`
- Check the provider value in GitHub secrets matches script output

### "Permission denied"
- Script creates service account with all required permissions
- If errors persist, check GCP IAM console

### "Terraform plan fails"
- First merge will create infrastructure
- Subsequent merges update it
- Check workflow logs for details

## Next Steps

- **Custom domain**: See [SETUP.md](SETUP.md#custom-domain)
- **HTTPS**: See [infrastructure/README.md](infrastructure/README.md#https-setup)
- **Staging environment**: See [CONTRIBUTING.md](CONTRIBUTING.md#environments)

---

**That's it!** 30 seconds of local setup, then merge and you're done.
