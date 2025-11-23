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
    console.log('Anonymous auth initialized for Firebase Storage access');
  } catch (error) {
    console.error('Failed to initialize anonymous auth:', error);
    throw error;
  }

  // Monitor auth state
  onAuthStateChanged(auth, (user) => {
    if (user) {
      console.log('Anonymous user signed in:', user.uid);
    } else {
      console.log('No user signed in');
    }
  });
}
