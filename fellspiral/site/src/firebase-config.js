/**
 * Firebase Configuration for Fellspiral
 *
 * This configuration is safe to expose publicly as it only identifies
 * the Firebase project. Access control is managed via Firestore security
 * rules (firestore.rules).
 */

// Local development config (used with emulators)
const localConfig = {
  apiKey: 'AIzaSyBbugulRE4hhlFmSlYSDo22pwkPnZqWfrw',
  authDomain: 'chalanding.firebaseapp.com',
  projectId: 'chalanding',
  storageBucket: 'chalanding.firebasestorage.app',
  messagingSenderId: '190604485916',
  appId: '1:190604485916:web:abc123def456',
};

/**
 * Get Firebase configuration
 * - In production (Firebase Hosting): fetch from /__/firebase/init.json
 * - In development: use local config for emulator support
 */
export async function getFirebaseConfig() {
  // Check if we're on Firebase Hosting (deployed)
  const isFirebaseHosting =
    typeof window !== 'undefined' &&
    (window.location.hostname.endsWith('.web.app') ||
      window.location.hostname.endsWith('.firebaseapp.com'));

  if (isFirebaseHosting) {
    try {
      const response = await fetch('/__/firebase/init.json');
      if (response.ok) {
        const config = await response.json();
        console.log('Using Firebase Hosting auto-config');
        return config;
      }
    } catch (error) {
      console.warn('Failed to fetch Firebase Hosting config, using local config:', error);
    }
  }

  console.log('Using local Firebase config');
  return localConfig;
}

// For backwards compatibility, export a synchronous config for local development
export const firebaseConfig = localConfig;
