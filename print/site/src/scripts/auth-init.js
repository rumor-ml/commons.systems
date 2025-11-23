/**
 * Authentication Initialization for Print Site
 * Enables anonymous auth for Firebase Storage access
 */

import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

/**
 * Initialize anonymous authentication for Firebase Storage access
 * Required for accessing non-default storage buckets even with public rules
 * @param {FirebaseApp} app - Initialized Firebase app
 * @returns {Promise<void>}
 */
export async function initializeAuth(app) {
  const auth = getAuth(app);

  // Sign in anonymously to enable Firebase Storage access
  try {
    await signInAnonymously(auth);
  } catch (error) {
    // Auth initialization failed - this will prevent Firebase Storage access
    throw error;
  }

  // Monitor auth state
  onAuthStateChanged(auth, (user) => {
    // Auth state changed
    if (!user) {
      // No user signed in - re-authenticate
      signInAnonymously(auth).catch(() => {
        // Silent fail - page may not load properly but won't crash
      });
    }
  });
}
