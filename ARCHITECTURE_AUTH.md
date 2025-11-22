# Authentication Architecture

## Overview

This monorepo uses a **unified authentication architecture** with a single GitHub OAuth App and shared Firebase Authentication across all sites.

## Architecture Diagram

```
User Browser
    │
    │ 1. Click "Sign in with GitHub"
    ▼
┌─────────────────────┐
│   Any Site          │  fellspiral.run.app
│   (fellspiral,      │  videobrowser.run.app
│   videobrowser,     │  future-site.run.app
│   future sites)     │
└──────────┬──────────┘
           │
           │ 2. initAuth(firebaseConfig)
           │    Firebase SDK redirects to GitHub
           ▼
┌─────────────────────────────────────────────────┐
│          GitHub OAuth App                       │
│                                                 │
│  Name: Commons Systems Auth                    │
│  Client ID: xxxxx                              │
│  Client Secret: xxxxx                          │
│  Callback: chalanding.firebaseapp.com/__/...   │
└──────────┬──────────────────────────────────────┘
           │
           │ 3. User authorizes
           │ 4. GitHub redirects with code
           ▼
┌─────────────────────────────────────────────────┐
│       Firebase Authentication Service           │
│       Project: chalanding                       │
│                                                 │
│  - Receives OAuth code from GitHub             │
│  - Exchanges code for GitHub access token      │
│  - Creates Firebase auth token                 │
│  - Returns user object + token                 │
│  - Stores session globally                     │
└──────────┬──────────────────────────────────────┘
           │
           │ 5. Auth token + user object
           │    Shared across all sites
           ▼
┌─────────────────────┐
│   All Sites         │  User is now authenticated
│   @commons/auth     │  across ALL sites in the
│   library           │  commons.systems monorepo
└─────────────────────┘
```

## Key Components

### 1. Single GitHub OAuth App

**Configuration:**
- **Application Name:** Commons Systems Auth
- **Homepage URL:** Any of the site URLs (e.g., fellspiral URL)
- **Callback URL:** `https://chalanding.firebaseapp.com/__/auth/handler`

**Why One App:**
- ✅ Single set of credentials to manage
- ✅ One place to configure scopes
- ✅ Unified OAuth settings for all sites
- ✅ Easier to monitor and debug
- ✅ Simpler compliance and security audits

**No Need for Multiple Callback URLs:**
- Sites don't need individual callbacks
- Firebase handles all OAuth redirects
- All sites point to the same Firebase callback

### 2. Firebase Authentication (chalanding)

**Role:** OAuth Proxy & Auth Manager

Firebase acts as an intermediary:
1. Receives sign-in requests from any site
2. Redirects to GitHub OAuth
3. Handles OAuth callback from GitHub
4. Issues Firebase auth tokens
5. Manages sessions globally

**Shared Configuration:**
```javascript
// Same config used by ALL sites
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "chalanding.firebaseapp.com",
  projectId: "chalanding",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

**Global Auth State:**
- Auth tokens stored in Firebase
- Sessions valid across all sites
- No cross-domain issues
- Single sign-on (SSO) behavior

### 3. Shared Auth Library (@commons/auth)

**Purpose:** DRY authentication logic

All sites import the same library:
```javascript
import { initAuth, createAuthButton } from '@commons/auth';

// Initialize with shared Firebase config
initAuth(firebaseConfig);
```

**Benefits:**
- ✅ No code duplication
- ✅ Consistent auth UX across sites
- ✅ Single point of maintenance
- ✅ Automatic updates for all sites
- ✅ Shared bug fixes and improvements

## Authentication Flow

### Sign-In Flow

```
1. User visits fellspiral.run.app
2. Clicks "Sign in with GitHub"
3. @commons/auth calls Firebase Auth SDK
4. Firebase redirects to GitHub OAuth
5. User authorizes on GitHub
6. GitHub redirects to: chalanding.firebaseapp.com/__/auth/handler
7. Firebase exchanges OAuth code for tokens
8. Firebase creates auth session
9. User redirected back to fellspiral.run.app
10. User is authenticated

11. User navigates to videobrowser.run.app
12. @commons/auth detects existing Firebase session
13. User is ALREADY authenticated (no new sign-in)
```

### Cross-Site Authentication

**Automatic SSO:**
- Sign in on any site → authenticated everywhere
- Firebase session is global
- No additional sign-in required
- Works across all current and future sites

**Session Management:**
```javascript
// On any site
const user = getCurrentUser();
// Returns same user object across all sites
// because Firebase session is shared
```

## Adding New Sites

### Zero OAuth Configuration Required

When adding a new site:

1. **Use the same Firebase config** (already done)
2. **Import @commons/auth** library
3. **Initialize auth** with shared config
4. **That's it** - no GitHub OAuth changes needed

**Example:**
```javascript
// new-site/src/scripts/auth-init.js
import { initAuth, createAuthButton } from '@commons/auth';
import { firebaseConfig } from '../firebase-config.js';

export function initializeAuth() {
  // Uses same Firebase project, same OAuth app
  initAuth(firebaseConfig);

  // Add UI
  const button = createAuthButton();
  document.body.appendChild(button);
}
```

**No GitHub Changes:**
- ✅ Same OAuth app
- ✅ Same callback URL
- ✅ No credential updates
- ✅ No Firebase configuration changes

## Security Considerations

### Single OAuth App Benefits

**Reduced Attack Surface:**
- One set of credentials to secure
- Fewer OAuth apps to monitor
- Centralized security configuration
- Single point for credential rotation

**Audit Trail:**
- All auth events in one Firebase project
- Unified logging and monitoring
- Single dashboard for user management
- Easier compliance reporting

**Credential Management:**
- One Client Secret to rotate
- One place to update scopes
- Centralized access control
- Simpler secret management in CI/CD

### Firebase Security

**Built-in Protection:**
- Firebase handles token refresh
- Automatic token expiration
- Secure token storage
- HTTPS-only connections

**Security Rules:**
```javascript
// Firestore: validate auth at database level
match /cards/{cardId} {
  allow read: if request.auth != null;
  allow write: if request.auth != null
                && request.auth.uid == request.resource.data.createdBy;
}

// Storage: validate auth for file access
match /video/{file} {
  allow read: if request.auth != null;
}
```

## Comparison: Single vs Multiple OAuth Apps

### ❌ Multiple OAuth Apps (NOT recommended)

```
GitHub OAuth App (Fellspiral)
  ↓
Fellspiral Site

GitHub OAuth App (Videobrowser)
  ↓
Videobrowser Site

GitHub OAuth App (Future Site)
  ↓
Future Site
```

**Drawbacks:**
- ❌ Multiple credentials to manage
- ❌ Separate user bases per site
- ❌ No cross-site authentication
- ❌ User must sign in separately on each site
- ❌ More complex security management
- ❌ Higher maintenance burden

### ✅ Single OAuth App (Current Architecture)

```
    GitHub OAuth App
           ↓
  Firebase Authentication
       ↙   ↓   ↘
Fellspiral  Videobrowser  Future Sites
```

**Benefits:**
- ✅ One credential set
- ✅ Unified user base
- ✅ Automatic SSO across sites
- ✅ Sign in once, authenticated everywhere
- ✅ Centralized security
- ✅ Easy to extend to new sites

## Environment-Specific Configuration

### Development vs Production

**Same OAuth App, Different Callback URLs:**

GitHub OAuth App settings:
```
Callback URLs:
  https://chalanding.firebaseapp.com/__/auth/handler   (Production)
  http://localhost:5173/__/auth/handler                 (Development)
```

**Why This Works:**
- GitHub OAuth allows multiple callback URLs
- Firebase handles environment detection
- Same credentials work in all environments
- No code changes needed

### Local Development

```bash
# Start any site locally
npm run dev              # Fellspiral on localhost:5173
npm run dev:videobrowser # Videobrowser on localhost:5173

# Sign in works with same OAuth app
# Uses localhost callback URL
# Same Firebase project
```

## Monitoring & Analytics

### Unified User Analytics

**Single Dashboard:**
- Firebase Console → Authentication
- See all users across all sites
- Track sign-ins, sign-ups, deletions
- Monitor OAuth failures

**Cross-Site User Tracking:**
```javascript
// Track which sites a user has visited
import { getAnalytics, logEvent } from 'firebase/analytics';

logEvent(analytics, 'site_visit', {
  site: 'fellspiral',
  user_id: user.uid
});
```

### OAuth Monitoring

**GitHub OAuth App:**
- Single app to monitor in GitHub settings
- View OAuth authorizations
- Track API rate limits (shared across sites)

## Cost Optimization

### Single OAuth App

**GitHub Rate Limits:**
- Shared across all sites
- 5,000 requests/hour per OAuth app
- More efficient than multiple apps

**Firebase Pricing:**
- Authentication is free (50,000 DAU on Spark plan)
- Shared quota across all sites
- No per-site charges

## Migration Path

### From Multiple OAuth Apps (If Needed)

If you ever had multiple OAuth apps:

1. **Create unified OAuth app** (already done)
2. **Update Firebase** with new credentials
3. **Deploy to all sites** (one push)
4. **Deprecate old OAuth apps** gradually
5. **Users automatically migrated** (Firebase handles it)

### To Additional Auth Providers

Architecture supports adding more providers:

```javascript
// Add Google, Apple, etc.
initAuth(firebaseConfig);

// GitHub already configured
const githubProvider = new GithubAuthProvider();

// Add more providers
const googleProvider = new GoogleAuthProvider();
const appleProvider = new OAuthProvider('apple.com');

// Still single architecture, multiple options
```

## Best Practices

### DO ✅

- Use single Firebase project for all sites
- Share firebaseConfig across all sites
- Import @commons/auth library
- Trust Firebase session management
- Monitor Firebase Console for all auth events

### DON'T ❌

- Don't create separate OAuth apps per site
- Don't create separate Firebase projects per site
- Don't duplicate auth code across sites
- Don't store auth tokens locally
- Don't bypass Firebase Auth for OAuth

## Troubleshooting

### "Invalid Callback URL"

**Cause:** Site URL not in GitHub OAuth App callbacks

**Solution:**
- You don't need to add site URLs
- Only add Firebase callback: `https://chalanding.firebaseapp.com/__/auth/handler`
- Firebase handles redirects to your sites

### User Not Authenticated Across Sites

**Cause:** Different Firebase projects or configs

**Solution:**
- Verify all sites use same `firebaseConfig`
- Check `projectId: "chalanding"` in all configs
- Ensure same Firebase app initialization

### OAuth Scope Issues

**Cause:** Insufficient GitHub scopes

**Solution:**
- Update scopes in ONE place (shared auth library)
- Change `github-auth.js`:
  ```javascript
  provider.addScope('user:email');
  provider.addScope('read:user');
  provider.addScope('repo'); // Add more scopes
  ```
- Users re-authorize on next sign-in
- Scope changes apply to all sites

## Future Enhancements

### Potential Additions (Without Architecture Changes)

- **Additional OAuth Providers:** Google, Apple, Microsoft
- **Multi-Factor Authentication (MFA):** Firebase supports it
- **Custom Claims:** Role-based access control
- **Email/Password Auth:** Fallback option
- **Anonymous Auth:** Guest access
- **Phone Auth:** SMS verification

All additions work with existing single OAuth app architecture.

## Summary

**Current Architecture:**
- ✅ Single GitHub OAuth App
- ✅ One callback URL
- ✅ Shared Firebase Authentication
- ✅ Unified auth library (@commons/auth)
- ✅ Automatic SSO across all sites
- ✅ Zero config for new sites

**Key Principle:**
> One OAuth app, one Firebase project, infinite sites

This architecture is **already optimal** and ready to scale to any number of future sites without additional OAuth configuration.
