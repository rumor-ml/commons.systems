# Firebase Authentication - Authorized Domains Setup

## The Issue

The `auth/unauthorized-domain` error occurs because Firebase Authentication requires all domains where users initiate OAuth flows to be explicitly authorized in the Firebase project settings.

## Why This Happens

When you click "Sign in with GitHub" on a deployed site:
1. The site's domain (e.g., `https://fellspiral-github-auth-components-...run.app`) initiates the OAuth flow
2. Firebase redirects to GitHub for authentication
3. GitHub redirects back to Firebase's callback URL: `https://chalanding.firebaseapp.com/__/auth/handler`
4. Firebase validates that the **originating domain** is in the authorized domains list
5. **Error**: If the originating domain isn't authorized, you get `auth/unauthorized-domain`

## Current Situation

You currently have ONE callback URL configured in your GitHub OAuth App:
- ✅ `https://chalanding.firebaseapp.com/__/auth/handler`

This is correct and should not change. However, you also need to add **authorized domains** in Firebase Console.

## Solution: Add Authorized Domains in Firebase Console

### Step 1: Access Firebase Console

Go to: https://console.firebase.google.com/project/chalanding/authentication/settings

### Step 2: Scroll to "Authorized Domains"

You should see a section called "Authorized domains" with a list of currently authorized domains.

### Step 3: Add Required Domains

Click "Add domain" and add each of these domains:

#### Always Required:
- `localhost` (for local development)
- `chalanding.firebaseapp.com` (Firebase hosting)
- `chalanding.web.app` (Firebase hosting alternate)

#### For Production Sites:
- `fellspiral.commons.systems`
- `videobrowser.commons.systems`
- `audiobrowser.commons.systems`

#### For Cloud Run Deployments:

**Production Services:**
- `fellspiral-site.run.app`
- `videobrowser-site.run.app`
- `audiobrowser-site.run.app`

**Preview/Feature Branch Services:**

Feature branch deployments have dynamic URLs. To find the current preview URL:

```bash
# Get the URL from the latest deployment
./claudetool/get_workflow_logs.sh --latest 2>&1 | grep -E "Service URL:|https://.*run\.app"

# OR directly query Cloud Run (if gcloud is configured)
gcloud run services describe fellspiral-site --region=us-central1 --format='value(status.url)'
```

Add the preview domain (e.g., `fellspiral-github-auth-components-01rdd46strst2dvkulwxmsnn.run.app`) to authorized domains.

### Step 4: Save and Test

After adding domains:
1. Wait 1-2 minutes for changes to propagate
2. Refresh your deployed site
3. Click "Sign in with GitHub"
4. OAuth flow should now work without `auth/unauthorized-domain` error

## Alternative: Wildcard Domain Support

Firebase does NOT support arbitrary wildcards like `*.run.app`. You must add each domain individually.

For preview deployments, this means:
- Each new preview deployment gets a unique URL
- You need to manually add that URL to authorized domains for testing
- OR, test auth only on stable production domains

## Recommended Testing Strategy

### For Development:
- ✅ Test locally on `localhost` (already authorized)
- ✅ Automated UI tests run on `localhost` (no auth flow testing)

### For Production:
- ✅ Test on production domains: `fellspiral.commons.systems`, etc.
- ✅ These domains are stable and can be permanently authorized

### For Preview Deployments:
- ⚠️ Preview URLs are dynamic and require manual authorization each time
- **Recommendation**: Skip auth testing on preview deployments
- **Alternative**: Manually add the preview domain if testing is needed

## Future Automation (Terraform)

The Terraform configuration in `infrastructure/terraform/firebase-auth.tf` is set up to manage authorized domains automatically. However, it requires:
1. Terraform to be run in an environment with `gcloud` CLI
2. Service account permissions to manage Identity Platform config

To apply Terraform configuration:
```bash
# From the repository root
cd infrastructure/terraform
terraform init
terraform plan
terraform apply
```

This will automatically configure:
- Identity Platform API enablement
- Authorized domains list
- Firebase Auth settings

## Quick Reference

| Domain Type | Example | Status |
|------------|---------|--------|
| Localhost | `localhost` | ✅ Add once |
| Firebase Hosting | `chalanding.firebaseapp.com` | ✅ Add once |
| Firebase Hosting | `chalanding.web.app` | ✅ Add once |
| Production (Custom) | `fellspiral.commons.systems` | ✅ Add once |
| Cloud Run (Production) | `fellspiral-site.run.app` | ✅ Add once |
| Cloud Run (Preview) | `fellspiral-{branch}-{hash}.run.app` | ⚠️ Add per deployment |

## Summary

**Immediate Fix:**
1. Go to Firebase Console → Authentication → Settings
2. Add the Cloud Run preview domain causing the error
3. Wait 1-2 minutes and retry auth

**Long-term Fix:**
1. Test auth on production domains only
2. Use Terraform to manage authorized domains automatically
3. Preview deployments: test other features, not auth flow
