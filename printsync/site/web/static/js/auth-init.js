/**
 * Authentication Initialization for Printsync
 * Sets up Firebase Auth with anonymous sign-in for development
 * Connects to Firebase Auth emulator for local dev and tests
 */

import { initAuth, initAuthState, onAuthStateChange, getAuthInstance } from '@commons/auth';
import { signInAnonymously, connectAuthEmulator } from 'firebase/auth';
import { firebaseConfig } from './firebase-config.js';

/**
 * Initialize authentication and set up token sync
 */
export function initializeAuth() {
  // Initialize Firebase Auth (GitHub provider for production, anonymous for dev)
  initAuth(firebaseConfig);

  // ALWAYS connect to emulator in development (localhost)
  // This works for both dev server and E2E tests
  const isDev =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  if (isDev) {
    try {
      const auth = getAuthInstance();

      // Default to localhost:9099, but respect custom port if set via meta tag
      // E2E tests inject custom ports via playwright.config.ts → server template
      const metaTag = document.querySelector('meta[name="firebase-auth-emulator-host"]');
      const authEmulatorHost = metaTag?.getAttribute('content') || 'localhost:9099';

      // Connect to emulator
      connectAuthEmulator(auth, `http://${authEmulatorHost}`, { disableWarnings: true });
      console.log(`[Auth] Connected to emulator at ${authEmulatorHost}`);
    } catch (error) {
      // Emulator already connected - this is fine
      console.log('[Auth] Emulator connection skipped:', error.message);
    }
  }

  // Initialize auth state management
  initAuthState();

  // Set up token → cookie sync for SSE compatibility
  onAuthStateChange(async (user) => {
    if (user) {
      const token = await user.getIdToken();
      document.cookie = `firebase_token=${token}; path=/; SameSite=Lax`;
      console.log('[Auth] Token synced to cookie for SSE');

      // Dispatch auth-ready event for HTMX triggers
      document.dispatchEvent(
        new CustomEvent('auth-ready', {
          detail: { authenticated: true, user },
        })
      );
    } else {
      // Clear cookie on sign-out
      document.cookie = `firebase_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;

      // In dev mode, auto sign-in anonymously
      if (isDev) {
        try {
          const auth = getAuthInstance();
          await signInAnonymously(auth);
          console.log('[Auth] Dev mode: signed in anonymously');
        } catch (error) {
          console.error('[Auth] Anonymous sign-in failed:', error);
          // Dispatch auth-ready anyway to prevent UI from hanging
          document.dispatchEvent(
            new CustomEvent('auth-ready', {
              detail: { authenticated: false, error: error.message },
            })
          );
        }
      }
    }
  });

  // Set up token refresh listener (tokens expire after 1 hour)
  const auth = getAuthInstance();
  auth.onIdTokenChanged(async (user) => {
    if (user) {
      const token = await user.getIdToken();
      document.cookie = `firebase_token=${token}; path=/; SameSite=Lax`;
    }
  });
}
