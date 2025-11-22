# Firebase Hosting Migration

## Overview

This repository has migrated from Cloud Run to Firebase Hosting for all site deployments. This migration solves the Firebase Authentication authorized domains issue and simplifies the deployment infrastructure.

## Why Firebase Hosting?

### Problems with Cloud Run

**Auth Authorization Issues:**
- Cloud Run preview deployments have dynamic URLs (`service-name-hash.run.app`)
- Each URL must be manually added to Firebase Auth authorized domains
- Preview deployments become unusable for testing auth flows

**Infrastructure Complexity:**
- Docker builds for static sites (unnecessary overhead)
- Artifact Registry management
- Cloud Run service configuration
- More expensive than necessary for static content

### Benefits of Firebase Hosting

**Auth Works Automatically:**
- ✅ All Firebase Hosting domains automatically authorized for Firebase Auth
- ✅ Production: `<site-name>.web.app`, `<site-name>.firebaseapp.com`
- ✅ Preview channels: `<channel>--<site-name>.web.app`
- ✅ Custom domains: Automatically authorized when configured
- ✅ No manual configuration needed!

**Simpler Infrastructure:**
- No Docker builds needed
- No Artifact Registry
- No Cloud Run configuration
- Built-in CDN and SSL
- Lower operational cost
- Native preview channels

**Better Developer Experience:**
- Single command deployments: `firebase deploy`
- Preview channels built-in: `firebase hosting:channel:deploy <branch-name>`
- Faster deployments (no Docker build step)
- Automatic cleanup (previews expire after 7 days)

## Architecture

### Production Deployments

```
main branch → Build → Firebase Hosting → Custom Domain
                                      ↓
                              <site-name>.web.app
                              <site-name>.commons.systems
```

**URLs:**
- `https://fellspiral.web.app` (Firebase subdomain)
- `https://fellspiral.commons.systems` (Custom domain)
- `https://videobrowser.web.app`
- `https://videobrowser.commons.systems`
- `https://audiobrowser.web.app`
- `https://audiobrowser.commons.systems`

### Preview Deployments

```
feature branch → Build → Firebase Hosting Preview Channel
                                    ↓
                         <branch>--<site-name>.web.app
```

**URLs:**
- `https://claude-auth--fellspiral.web.app`
- `https://feature-video--videobrowser.web.app`
- Preview channels expire after 7 days automatically

### Playwright Server

Playwright server remains on Cloud Run (it's a service, not a static site):
- `https://playwright-server.run.app`

## Configuration Files

### `firebase.json`

Defines hosting configuration for all sites:

```json
{
  "hosting": [
    {
      "site": "fellspiral",
      "public": "fellspiral/site/dist",
      "rewrites": [{"source": "**", "destination": "/index.html"}],
      "headers": [...],
      "cleanUrls": true
    },
    {
      "site": "videobrowser",
      "public": "videobrowser/site/dist",
      ...
    },
    {
      "site": "audiobrowser",
      "public": "audiobrowser/site/dist",
      ...
    }
  ],
  "firestore": {
    "rules": "fellspiral/firestore.rules"
  },
  "storage": {
    "rules": "videobrowser/storage.rules"
  }
}
```

### `.firebaserc`

Maps sites to Firebase project:

```json
{
  "projects": {
    "default": "chalanding"
  },
  "targets": {
    "chalanding": {
      "hosting": {
        "fellspiral": ["fellspiral"],
        "videobrowser": ["videobrowser"],
        "audiobrowser": ["audiobrowser"]
      }
    }
  }
}
```

## Deployment

### Production (main branch)

```bash
# Deploy specific site to production
firebase deploy --only hosting:fellspiral

# Deploy all sites
firebase deploy --only hosting
```

### Preview (feature branches)

```bash
# Create/update preview channel
firebase hosting:channel:deploy BRANCH_NAME --only fellspiral --expires 7d

# URL: https://BRANCH_NAME--fellspiral.web.app
```

### Via Workflows

Workflows automatically determine deployment type based on branch:

- **main**: Production deployment
- **other**: Preview channel deployment

## Firebase Auth Authorized Domains

With Firebase Hosting, all domains are automatically authorized:

### Automatically Authorized

- ✅ `localhost` (local development)
- ✅ `chalanding.firebaseapp.com` (Firebase project domain)
- ✅ `chalanding.web.app` (Firebase project domain)
- ✅ `fellspiral.web.app` (site subdomain)
- ✅ `fellspiral.firebaseapp.com` (site subdomain)
- ✅ `videobrowser.web.app` (site subdomain)
- ✅ `videobrowser.firebaseapp.com` (site subdomain)
- ✅ `audiobrowser.web.app` (site subdomain)
- ✅ `audiobrowser.firebaseapp.com` (site subdomain)
- ✅ `<any-branch>--fellspiral.web.app` (preview channels)
- ✅ `<any-branch>--videobrowser.web.app` (preview channels)
- ✅ `<any-branch>--audiobrowser.web.app` (preview channels)

### Custom Domains

Custom domains are automatically authorized when configured in Firebase Console:

1. Go to Firebase Console → Hosting → Add custom domain
2. Follow DNS configuration instructions
3. Domain is automatically added to authorized domains list

Current custom domains:
- `fellspiral.commons.systems`
- `videobrowser.commons.systems`
- `audiobrowser.commons.systems`

## Migration Checklist

- [x] Create `firebase.json` with hosting configurations
- [x] Create `.firebaserc` with project and target mappings
- [x] Create `deploy-firebase-hosting.sh` deployment script
- [x] Update `firebase-auth.tf` to use Firebase Hosting domains
- [x] Create new workflow `push-feature-firebase.yml`
- [x] Update `claudetool/add-site.sh` scaffolding (remove Docker)
- [x] Add scaffolding sync instructions to `CLAUDE.md`
- [ ] Test preview deployment on feature branch
- [ ] Update main branch workflow (`push-main.yml`)
- [ ] Remove Cloud Run deployment scripts after transition
- [ ] Update manual deploy workflows
- [ ] Remove Dockerfiles after confirming Firebase Hosting works
- [ ] Update README.md with Firebase Hosting information

## Testing

### Test Preview Deployment

```bash
# Push to feature branch
git push origin feature-branch

# Workflow will:
1. Build the site
2. Deploy to Firebase Hosting preview channel
3. Run E2E tests against preview URL
4. Preview URL: https://feature-branch--fellspiral.web.app

# Test auth on preview
- Navigate to preview URL
- Click "Sign in with GitHub"
- Should work without any manual domain configuration!
```

### Test Production Deployment

```bash
# Merge to main
git push origin main

# Workflow will:
1. Build the site
2. Deploy to Firebase Hosting production
3. Run E2E tests against production URL
4. Production URLs:
   - https://fellspiral.web.app
   - https://fellspiral.commons.systems
```

## Cost Comparison

### Before (Cloud Run)

- Artifact Registry storage: ~$0.10/GB/month
- Cloud Run instances: ~$0.024/hour active
- Load Balancer (for custom domains): ~$18/month
- **Estimated**: ~$25/month for light traffic

### After (Firebase Hosting)

- Firebase Hosting: Free tier (10GB storage, 360MB/day bandwidth)
- Paid tier: $0.026/GB storage, $0.15/GB bandwidth
- **Estimated**: ~$0-5/month for light traffic

**Savings**: ~$20-25/month

## Rollback Plan

If Firebase Hosting doesn't work as expected:

1. Keep old Cloud Run workflows available
2. Switch DNS back to Cloud Run
3. Revert to Cloud Run deployment scripts
4. Re-enable Cloud Run workflows

**Note**: Firebase Hosting can coexist with Cloud Run, so we can run both in parallel during transition.

## Support

### Firebase Hosting Docs

- https://firebase.google.com/docs/hosting
- https://firebase.google.com/docs/hosting/test-preview-deploy

### Preview Channels

- https://firebase.google.com/docs/hosting/manage-hosting-resources

### Custom Domains

- https://firebase.google.com/docs/hosting/custom-domain
