# Commons Auth Library

Shared GitHub authentication library for commons.systems sites. Provides reusable authentication components and utilities using Firebase Authentication with GitHub OAuth.

## Features

- ✅ GitHub OAuth 2.0 authentication via Firebase
- ✅ Reusable UI components (login button, user profile)
- ✅ Persistent auth state management
- ✅ Automatic token refresh
- ✅ Theme-aware components (light/dark mode)
- ✅ Auth guards for protected content
- ✅ TypeScript-friendly (JSDoc annotations)

## Installation

The library is installed as a workspace dependency in the monorepo:

```json
{
  "dependencies": {
    "@commons/auth": "*"
  }
}
```

Run `npm install` at the repository root to link the workspace.

## Quick Start

### 1. Initialize Authentication

```javascript
import { initAuth, initAuthState, createAuthButton, createUserProfile } from '@commons/auth';
import '@commons/auth/styles/auth-button.css';
import '@commons/auth/styles/user-profile.css';

// Initialize Firebase Auth
initAuth(firebaseConfig);

// Initialize state management
initAuthState();
```

### 2. Add UI Components

```javascript
// Create login/logout button
const authButton = createAuthButton({
  loginText: 'Sign in with GitHub',
  logoutText: 'Sign out',
  onSignIn: (result) => {
    console.log('Signed in:', result.user.email);
  },
  onSignOut: () => {
    console.log('Signed out');
  },
});

// Create user profile display
const userProfile = createUserProfile({
  showAvatar: true,
  showName: true,
  showUsername: true,
});

// Add to DOM
document.getElementById('auth-container').appendChild(authButton);
document.getElementById('profile-container').appendChild(userProfile);
```

### 3. Protect Content

```javascript
import { createAuthGuard, requireAuth } from '@commons/auth';

// Hide/show elements based on auth state
const unsubscribe = createAuthGuard({
  element: document.getElementById('admin-panel'),
  requireAuth: true,
  fallback: document.getElementById('login-prompt'),
});

// Or prevent interactions without auth
const cleanup = requireAuth(addButton, {
  message: 'Please sign in to add items',
});
```

## API Reference

### Core Auth Functions

#### `initAuth(firebaseConfig)`

Initialize Firebase Authentication with GitHub provider.

```javascript
initAuth({
  apiKey: '...',
  authDomain: '...',
  projectId: '...',
  // ... other Firebase config
});
```

#### `initAuthState()`

Initialize auth state management and persistence.

#### `signInWithGitHub()`

Trigger GitHub OAuth sign-in popup.

```javascript
const result = await signInWithGitHub();
console.log(result.user);
console.log(result.githubToken); // GitHub API access token
```

#### `signOutUser()`

Sign out the current user.

```javascript
await signOutUser();
```

#### `getCurrentUser()`

Get the currently signed-in user.

```javascript
const user = getCurrentUser();
if (user) {
  console.log(user.email);
}
```

#### `isAuthenticated()`

Check if user is currently authenticated.

```javascript
if (isAuthenticated()) {
  // Show authenticated content
}
```

#### `getGitHubToken()`

Get GitHub access token for API calls.

```javascript
const token = getGitHubToken();
if (token) {
  // Make GitHub API calls
}
```

### State Management

#### `subscribeToAuthState(callback)`

Subscribe to auth state changes.

```javascript
const unsubscribe = subscribeToAuthState((state) => {
  console.log('Authenticated:', state.isAuthenticated);
  console.log('User:', state.user);
  console.log('Loading:', state.isLoading);
});

// Later: cleanup
unsubscribe();
```

#### `getAuthState()`

Get current auth state snapshot.

```javascript
const { user, isAuthenticated, isLoading } = getAuthState();
```

### UI Components

#### `createAuthButton(options)`

Create a login/logout button component.

**Options:**

- `loginText` (string): Text for login state (default: "Sign in with GitHub")
- `logoutText` (string): Text for logout state (default: "Sign out")
- `className` (string): Additional CSS classes
- `onSignIn` (function): Callback after successful sign-in
- `onSignOut` (function): Callback after sign-out
- `onError` (function): Callback for auth errors

**Returns:** `HTMLButtonElement`

```javascript
const button = createAuthButton({
  className: 'auth-button--compact',
  onSignIn: (result) => {
    console.log('Welcome', result.user.displayName);
  },
  onError: (error) => {
    alert(error.message);
  },
});
```

#### `createUserProfile(options)`

Create a user profile display component.

**Options:**

- `showAvatar` (boolean): Show avatar image (default: true)
- `showName` (boolean): Show display name (default: true)
- `showUsername` (boolean): Show GitHub username (default: true)
- `showEmail` (boolean): Show email (default: false)
- `avatarSize` (number): Avatar size in pixels (default: 32)
- `className` (string): Additional CSS classes

**Returns:** `HTMLDivElement`

```javascript
const profile = createUserProfile({
  showAvatar: true,
  showName: true,
  showEmail: false,
  avatarSize: 48,
  className: 'user-profile--large',
});
```

#### `createAuthGuard(options)`

Create an auth guard that controls content visibility.

**Options:**

- `element` (HTMLElement): Element to guard (required)
- `requireAuth` (boolean): If true, show when authenticated; if false, show when not (default: true)
- `fallback` (HTMLElement): Element to show when condition not met
- `onAuthRequired` (function): Callback when auth required but user not authenticated

**Returns:** `Function` (unsubscribe function)

```javascript
const unsubscribe = createAuthGuard({
  element: document.getElementById('protected-content'),
  requireAuth: true,
  fallback: document.getElementById('login-message'),
  onAuthRequired: () => {
    console.log('User needs to sign in');
  },
});
```

#### `requireAuth(element, options)`

Make an element require authentication for interaction.

**Options:**

- `onAuthRequired` (function): Callback when user tries to interact without auth
- `message` (string): Message to show (default: "You must be signed in...")

**Returns:** `Function` (cleanup function)

```javascript
const cleanup = requireAuth(deleteButton, {
  message: 'Please sign in to delete items',
  onAuthRequired: () => {
    // Show login modal
  },
});
```

## Styling

### CSS Variables

The components use CSS custom properties for theming:

```css
/* Auth Button */
--auth-button-bg
--auth-button-color
--auth-button-bg-hover
--auth-button-authenticated-bg
--auth-button-authenticated-bg-hover
--auth-button-border-radius
--auth-button-font-size
--auth-button-font-weight

/* User Profile */
--user-profile-padding
--user-profile-bg
--user-profile-border-radius
--user-profile-color
--user-profile-name-color
--user-profile-username-color
--user-profile-email-color
--user-profile-avatar-border-radius
--user-profile-avatar-border
```

### Example Theme

```css
/* Light theme */
.auth-button {
  --auth-button-bg: #24292e;
  --auth-button-color: #ffffff;
  --auth-button-bg-hover: #1a1e22;
}

/* Dark theme */
.auth-button--dark {
  --auth-button-bg: #4a9eff;
  --auth-button-color: #ffffff;
  --auth-button-bg-hover: #3a8de8;
}
```

### CSS Classes

**Auth Button:**

- `.auth-button` - Base button
- `.auth-button--compact` - Smaller padding
- `.auth-button--large` - Larger padding
- `.auth-button--light` - Light theme
- `.auth-button--dark` - Dark theme
- `.auth-button--authenticated` - Authenticated state
- `.auth-button--unauthenticated` - Unauthenticated state

**User Profile:**

- `.user-profile` - Base profile
- `.user-profile--compact` - Smaller size
- `.user-profile--large` - Larger size
- `.user-profile--dark` - Dark theme
- `.user-profile--card` - Card style
- `.user-profile--avatar-only` - Show only avatar

## Integration Examples

### Fellspiral Integration

See `fellspiral/site/src/scripts/auth-init.js` for full example.

```javascript
import { initAuth, initAuthState, createAuthButton, createUserProfile } from '@commons/auth';

export function initializeAuth() {
  initAuth(firebaseConfig);
  initAuthState();

  const navMenu = document.querySelector('.nav-menu');
  const authContainer = document.createElement('li');
  authContainer.className = 'nav-auth';

  authContainer.appendChild(createUserProfile({ className: 'user-profile--compact' }));
  authContainer.appendChild(createAuthButton({ className: 'auth-button--compact' }));

  navMenu.appendChild(authContainer);
}
```

### Videobrowser Integration

See `videobrowser/site/src/scripts/auth-init.js` for full example.

```javascript
export function initializeAuth() {
  initAuth(firebaseConfig);
  initAuthState();

  const header = document.querySelector('.header');
  const authContainer = document.createElement('div');
  authContainer.className = 'header__auth';

  authContainer.appendChild(
    createUserProfile({
      className: 'user-profile--compact user-profile--dark',
    })
  );
  authContainer.appendChild(
    createAuthButton({
      className: 'auth-button--compact auth-button--dark',
    })
  );

  header.appendChild(authContainer);
}
```

## Firebase Integration

### Firestore with Auth

```javascript
import { getAuth } from 'firebase/auth';
import { addDoc, serverTimestamp } from 'firebase/firestore';

const auth = getAuth();

async function createDocument(data) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User must be authenticated');
  }

  return await addDoc(collection, {
    ...data,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  });
}
```

### Security Rules

The repository includes security rules that require authentication:

**Firestore** (`firestore.rules`):

```
allow read: if isAuthenticated();
allow create: if isAuthenticated() && request.resource.data.createdBy == request.auth.uid;
```

**Storage** (`storage.rules`):

```
allow read: if isAuthenticated();
allow write: if isAuthenticated();
```

Deploy rules with:

```bash
firebase deploy --only firestore:rules,storage:rules
```

## Error Handling

Common error codes:

- `auth/popup-closed-by-user` - User closed OAuth popup
- `auth/popup-blocked` - Browser blocked popup
- `auth/network-request-failed` - Network error
- `auth/account-exists-with-different-credential` - Email already used

```javascript
createAuthButton({
  onError: (error) => {
    switch (error.code) {
      case 'auth/popup-closed-by-user':
        // User cancelled, no action needed
        break;
      case 'auth/popup-blocked':
        alert('Please allow popups for this site');
        break;
      default:
        alert(`Error: ${error.message}`);
    }
  },
});
```

## Development

### Project Structure

```
shared/auth/
├── package.json
├── README.md
├── src/
│   ├── index.js              # Main exports
│   ├── github-auth.js        # Firebase Auth integration
│   ├── auth-state.js         # State management
│   ├── components/
│   │   ├── auth-button.js    # Login/logout button
│   │   ├── user-profile.js   # User info display
│   │   └── auth-guard.js     # Content protection
│   └── styles/
│       ├── auth-button.css   # Button styles
│       └── user-profile.css  # Profile styles
```

### Testing

The library is tested through integration tests in each site:

```bash
npm test --workspace=fellspiral/tests   # Test fellspiral integration
npm test --workspace=videobrowser/tests # Test videobrowser integration
```

## License

MIT
