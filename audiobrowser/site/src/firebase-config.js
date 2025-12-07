/**
 * Firebase Configuration
 *
 * This configuration is safe to expose publicly as it only identifies
 * the Firebase project. Access control is managed via Firebase Storage
 * security rules and Firestore security rules.
 */

export const firebaseConfig = {
  apiKey: 'AIzaSyDummyKeyWillBeReplacedByCI',
  authDomain: 'chalanding.firebaseapp.com',
  projectId: 'chalanding',
  storageBucket: 'rml-media',
  messagingSenderId: '123456789',
  appId: '1:123456789:web:abc123def456',
};

// Note: The actual API key will be injected during the build process
// via environment variables or replaced in the CI/CD pipeline.
// For local development, you'll need to get the real config from:
// Firebase Console > Project Settings > Your apps > Web app config
