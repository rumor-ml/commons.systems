# GitHub Authentication Setup Guide

Complete guide for setting up GitHub OAuth authentication for commons.systems sites.

## Prerequisites

- GitHub account
- Access to Firebase project: `chalanding`
- Firebase CLI installed (`npm install -g firebase-tools`)
- Repository cloned locally

## Automated Setup (Recommended)

Run the interactive setup script:

```bash
python3 scripts/setup-github-auth.py
```

This script will guide you through all steps below automatically.

## Manual Setup

### Step 1: Create GitHub OAuth Application

1. **Navigate to GitHub OAuth Apps**
   - Go to: https://github.com/settings/developers
   - Click "OAuth Apps" in the left sidebar
   - Click "New OAuth App"

2. **Fill in Application Details**
   ```
   Application name:       Commons Systems Auth
   Homepage URL:           https://fellspiral-1036266765056.us-central1.run.app
   Application description: Authentication for commons.systems sites
   Authorization callback URL: https://chalanding.firebaseapp.com/__/auth/handler
   ```

3. **Register and Generate Secrets**
   - Click "Register application"
   - On the next page, click "Generate a new client secret"
   - **Copy both Client ID and Client Secret** - you'll need these in the next step

4. **Add Development Callback URL (Optional)**
   - For local development, add:
   ```
   http://localhost:5173/__/auth/handler
   ```
   - Note: You can add multiple callback URLs separated by newlines

### Step 2: Configure Firebase Authentication

1. **Open Firebase Console**
   - Go to: https://console.firebase.google.com/project/chalanding/authentication/providers
   - Select the "Sign-in method" tab

2. **Enable GitHub Provider**
   - Scroll to "GitHub" in the list of providers
   - Click on "GitHub"
   - Toggle "Enable" to ON

3. **Enter OAuth Credentials**
   ```
   Client ID:     [Paste from GitHub OAuth App]
   Client Secret: [Paste from GitHub OAuth App]
   ```

4. **Verify Callback URL**
   - Firebase will display the callback URL
   - Verify it matches what you entered in GitHub:
   ```
   https://chalanding.firebaseapp.com/__/auth/handler
   ```

5. **Save Configuration**
   - Click "Save"

### Step 3: Deploy Firebase Security Rules

Security rules enforce authentication requirements for Firestore and Storage.

1. **Review Security Rules**

   **Firestore** (`firestore.rules`):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /cards/{cardId} {
         allow read: if request.auth != null;
         allow create: if request.auth != null
                       && request.resource.data.createdBy == request.auth.uid;
         allow update: if request.auth != null
                       && (resource.data.createdBy == request.auth.uid
                           || request.resource.data.lastModifiedBy == request.auth.uid);
         allow delete: if request.auth != null
                       && resource.data.createdBy == request.auth.uid;
       }
     }
   }
   ```

   **Storage** (`storage.rules`):
   ```
   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /video/{videoFile} {
         allow read: if request.auth != null;
         allow write: if request.auth != null;
       }
     }
   }
   ```

2. **Deploy Rules**

   Security rules are managed via Infrastructure as Code and deploy automatically:

   **Option A: Automatic (Recommended)**
   ```bash
   # Rules deploy automatically when you push changes
   git push origin your-branch

   # The IaC workflow (Terraform) will automatically deploy:
   # - firestore.rules → Firestore security rules
   # - storage.rules → Storage security rules
   ```

   **Option B: Manual (Optional)**

   If you need immediate deployment without waiting for CI/CD:

   ```bash
   # Install Firebase CLI (if not already installed)
   npm install -g firebase-tools

   # Login
   firebase login

   # Deploy rules manually
   firebase deploy --only firestore:rules,storage:rules --project chalanding
   ```

3. **Verify Deployment**
   - Check Firebase Console → Firestore → Rules
   - Check Firebase Console → Storage → Rules
   - Both should show "Published" with recent timestamp

**Note:** Security rules are defined in:
- `firestore.rules` - Firestore security rules
- `storage.rules` - Storage security rules
- `infrastructure/terraform/firebase.tf` - Terraform management

### Step 4: Install Dependencies

```bash
# Install all workspace dependencies
npm install
```

This will:
- Install the shared `@commons/auth` library
- Link workspace dependencies
- Install Firebase SDK and other dependencies

### Step 5: Test Authentication Locally

1. **Start Development Server**

   For Fellspiral:
   ```bash
   npm run dev
   ```

   For Videobrowser:
   ```bash
   npm run dev:videobrowser
   ```

2. **Open Browser**
   - Navigate to http://localhost:5173
   - You should see the "Sign in with GitHub" button

3. **Test Sign In**
   - Click "Sign in with GitHub"
   - OAuth popup should open
   - Authorize the application
   - You should be redirected back and signed in
   - You should see:
     - Your GitHub avatar
     - Your display name
     - "Sign out" button

4. **Test Protected Operations**

   **Fellspiral:**
   - Go to http://localhost:5173/cards.html
   - Try creating a new card
   - Should work while authenticated

   **Videobrowser:**
   - Videos should load and play
   - All operations should work

5. **Test Sign Out**
   - Click "Sign out"
   - UI should update to show "Sign in with GitHub"
   - Profile should disappear

6. **Test Persistence**
   - Sign in again
   - Refresh the page
   - You should remain signed in

### Step 6: Run Tests

Run the authentication tests:

```bash
# Test Fellspiral
npm test --workspace=fellspiral/tests

# Test Videobrowser
npm test --workspace=videobrowser/tests
```

Tests should pass, verifying:
- Auth buttons render correctly
- Styling is applied
- Components are in the correct locations

### Step 7: Production Deployment

1. **Update GitHub OAuth App for Production**
   - Go to your GitHub OAuth App settings
   - Add production callback URLs:
   ```
   https://fellspiral-1036266765056.us-central1.run.app/__/auth/handler
   https://videobrowser-1036266765056.us-central1.run.app/__/auth/handler
   ```
   - Or your custom domain if you have one

2. **Commit and Push**
   ```bash
   git add .
   git commit -m "Add GitHub authentication"
   git push
   ```

3. **Monitor Deployment**
   - GitHub Actions will run tests and deploy
   - Check workflow status in GitHub Actions tab

4. **Verify Production**
   - Visit production URLs
   - Test sign in/out flow
   - Verify protected operations work

## Verification Checklist

- [ ] GitHub OAuth App created
- [ ] Firebase Authentication configured with GitHub provider
- [ ] Firestore security rules deployed
- [ ] Storage security rules deployed
- [ ] Dependencies installed (`npm install`)
- [ ] Local sign-in works
- [ ] User profile displays correctly
- [ ] Sign-out works
- [ ] Session persists on refresh
- [ ] Protected operations require auth
- [ ] Tests pass
- [ ] Production callback URLs added
- [ ] Deployed to production
- [ ] Production authentication works

## Architecture Overview

### Shared Auth Library

Location: `shared/auth/`

```
shared/auth/
├── src/
│   ├── index.js              # Main exports
│   ├── github-auth.js        # Firebase Auth + GitHub OAuth
│   ├── auth-state.js         # State management & persistence
│   ├── components/
│   │   ├── auth-button.js    # Login/logout button
│   │   ├── user-profile.js   # User info display
│   │   └── auth-guard.js     # Protected content wrapper
│   └── styles/
│       ├── auth-button.css   # Button styles
│       └── user-profile.css  # Profile styles
└── README.md                  # Full API documentation
```

### Integration Points

**Fellspiral:**
- Entry: `fellspiral/site/src/scripts/auth-init.js`
- Called from: `fellspiral/site/src/scripts/main.js`
- UI: Navbar (`nav-auth` class)
- Tests: `fellspiral/tests/e2e/auth.spec.js`

**Videobrowser:**
- Entry: `videobrowser/site/src/scripts/auth-init.js`
- Called from: `videobrowser/site/src/scripts/main.js`
- UI: Header (`header__auth` class)
- Tests: `videobrowser/tests/e2e/auth.spec.js`

### Authentication Flow

```
User clicks "Sign in" button
    ↓
GitHub OAuth popup opens
    ↓
User authorizes app on GitHub
    ↓
GitHub redirects to Firebase callback URL
    ↓
Firebase exchanges code for auth token
    ↓
User object stored in auth state
    ↓
Auth state persisted to localStorage
    ↓
UI components update (show profile, hide button)
    ↓
User is authenticated across all sites
```

## Troubleshooting

### Popup Blocked

**Symptom:** Sign-in popup doesn't open

**Solution:**
1. Check browser console for errors
2. Enable popups for your domain in browser settings
3. Try different browser

### Invalid Callback URL

**Symptom:** Error "redirect_uri_mismatch"

**Solution:**
1. Check GitHub OAuth App callback URL
2. Verify it exactly matches Firebase callback URL
3. Both should be: `https://chalanding.firebaseapp.com/__/auth/handler`

### Permission Denied (Firestore/Storage)

**Symptom:** "Missing or insufficient permissions" error

**Solution:**
1. Verify security rules are deployed:
   ```bash
   firebase deploy --only firestore:rules,storage:rules --project chalanding
   ```
2. Check Firebase Console → Rules to verify they're active
3. Ensure user is authenticated before operations
4. Check browser console for auth state

### Auth State Not Persisting

**Symptom:** User signed out after page refresh

**Solution:**
1. Check browser localStorage is enabled
2. Look for `commons_auth_state` in localStorage
3. Clear cache and cookies, sign in again
4. Check for JavaScript errors in console

### Tests Failing

**Symptom:** E2E tests fail for auth components

**Solution:**
1. Ensure dev server is running
2. Check that auth components are rendering
3. Verify CSS files are loaded
4. Run tests in headed mode to see UI:
   ```bash
   npm test --workspace=fellspiral/tests -- --headed
   ```

### Production Sign-in Fails

**Symptom:** Sign-in works locally but not in production

**Solution:**
1. Add production URL to GitHub OAuth App callback URLs
2. Ensure Firebase config in production matches local
3. Check Cloud Run logs for errors:
   ```bash
   gcloud run services logs read fellspiral --project=chalanding
   ```

## Additional Resources

- **Shared Auth Library Docs:** [shared/auth/README.md](shared/auth/README.md)
- **Firebase Auth Docs:** https://firebase.google.com/docs/auth/web/github-auth
- **GitHub OAuth Guide:** https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
- **Firebase Security Rules:** https://firebase.google.com/docs/rules

## Support

If you encounter issues:

1. Check this guide's troubleshooting section
2. Review browser console for errors
3. Check Firebase Console for authentication events
4. Review GitHub OAuth App settings
5. Check Cloud Run logs for production issues

For Firebase-specific issues:
- Firebase Console: https://console.firebase.google.com/project/chalanding
- Firebase Status: https://status.firebase.google.com/

For GitHub OAuth issues:
- GitHub OAuth Apps: https://github.com/settings/developers
- GitHub API Status: https://www.githubstatus.com/
