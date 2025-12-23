/**
 * GitHub OAuth Authentication Module
 * Handles Firebase Authentication with GitHub provider
 */

// TODO(#305): Improve error message in getAuthInstance()
// TODO: See issue #285 - Replace fragile string matching for error detection with proper error types

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GithubAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  connectAuthEmulator,
} from 'firebase/auth';

let app = null;
let auth = null;
let provider = null;

/**
 * Initialize Firebase Auth with GitHub provider
 * @param {Object} firebaseConfig - Firebase configuration object
 * @param {Object} options - Optional configuration
 * @param {boolean} options.useEmulator - Connect to auth emulator
 * @param {string} options.emulatorHost - Auth emulator host (default: localhost:9099)
 */
export function initAuth(firebaseConfig, options = {}) {
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    provider = new GithubAuthProvider();

    // Request additional GitHub scopes if needed
    provider.addScope('user:email');
    provider.addScope('read:user');

    // Connect to auth emulator in dev/test mode
    // Check environment variables or explicit option
    const useEmulator =
      options.useEmulator ||
      (typeof import.meta !== 'undefined' &&
        (import.meta.env?.MODE === 'development' ||
          import.meta.env?.VITE_USE_FIREBASE_EMULATOR === 'true'));

    if (useEmulator) {
      try {
        const emulatorHost =
          options.emulatorHost ||
          (typeof import.meta !== 'undefined' &&
            import.meta.env?.VITE_FIREBASE_AUTH_EMULATOR_HOST) ||
          'localhost:9099';
        connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });
      } catch (error) {
        const msg = error.message || '';

        // Expected: already connected
        if (msg.includes('already')) {
          console.debug('[GitHub Auth] Emulator already connected');
        } else {
          // Unexpected: CRITICAL ERROR - emulator connection failed
          console.error('[GitHub Auth] CRITICAL: Emulator connection failed', {
            message: msg,
            emulatorHost: options.emulatorHost || 'localhost:9099',
          });

          // Show user warning banner
          if (typeof window !== 'undefined') {
            const warning = document.createElement('div');
            warning.className = 'warning-banner';
            warning.style.cssText =
              'background: var(--color-error); color: white; padding: 1rem; position: fixed; top: 0; left: 0; right: 0; z-index: 10000;';
            warning.textContent =
              '⚠️ Failed to connect to auth emulator. You may be using production authentication.';
            document.body.insertBefore(warning, document.body.firstChild);
          }

          throw error; // Never silently fail on unexpected errors
        }
      }
    }

    // Expose auth instance and test helpers on window for E2E testing
    if (typeof window !== 'undefined') {
      window.__testAuth = auth;
      // Expose signInWithEmailAndPassword for E2E tests
      window.__signInWithEmailAndPassword = (email, password) =>
        signInWithEmailAndPassword(auth, email, password);
      // Expose signInWithCustomToken for E2E tests
      window.__signInWithCustomToken = (token) => signInWithCustomToken(auth, token);
      // Expose signOut for E2E tests
      window.__signOut = () => signOut(auth);
    }
  }

  return auth;
}

/**
 * Get the current auth instance
 * @returns {Object} Firebase Auth instance
 */
export function getAuthInstance() {
  if (!auth) {
    throw new Error('Auth not initialized. Call initAuth() first.');
  }
  return auth;
}

/**
 * Sign in with GitHub OAuth popup
 * @returns {Promise<Object>} User credential object
 */
export async function signInWithGitHub() {
  try {
    const result = await signInWithPopup(auth, provider);

    // Get GitHub access token if needed for GitHub API calls
    const credential = GithubAuthProvider.credentialFromResult(result);
    const githubToken = credential?.accessToken;

    // Store GitHub token for potential API usage
    if (githubToken) {
      sessionStorage.setItem('github_access_token', githubToken);
    }

    return {
      user: result.user,
      githubToken,
      credential,
    };
  } catch (error) {
    console.error('GitHub sign-in error:', error);
    throw error;
  }
}

/**
 * Sign out the current user
 * @returns {Promise<void>}
 */
export async function signOutUser() {
  try {
    await signOut(auth);
    sessionStorage.removeItem('github_access_token');
  } catch (error) {
    console.error('Sign-out error:', error);
    throw error;
  }
}

/**
 * Subscribe to auth state changes
 * @param {Function} callback - Callback function(user) called on auth state change
 * @returns {Function} Unsubscribe function
 */
export function onAuthStateChange(callback) {
  if (!auth) {
    const error = new Error(
      'onAuthStateChange called before auth initialized. ' +
        'Call initAuth() first and wait for auth instance to be ready. ' +
        'This usually means auth initialization is happening asynchronously and has not completed yet.'
    );
    console.error('[Auth]', error.message);
    throw error;
  }
  return onAuthStateChanged(auth, (user) => {
    callback(user);
  });
}

/**
 * Get current user
 * @returns {Object|null} Current user or null
 */
export function getCurrentUser() {
  return auth?.currentUser || null;
}

/**
 * Check if user is authenticated
 * @returns {boolean}
 */
export function isAuthenticated() {
  return !!auth?.currentUser;
}

/**
 * Get GitHub access token from session
 * @returns {string|null} GitHub access token
 */
export function getGitHubToken() {
  return sessionStorage.getItem('github_access_token');
}
