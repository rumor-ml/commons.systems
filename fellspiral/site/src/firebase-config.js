/**
 * Firebase Configuration for Fellspiral
 *
 * This configuration is safe to expose publicly as it only identifies
 * the Firebase project. Access control is managed via Firestore security
 * rules (firestore.rules).
 */

// Use demo-test project for emulator mode, production config otherwise
const isEmulatorMode =
  typeof import.meta !== 'undefined' &&
  (import.meta.env?.MODE === 'development' ||
    import.meta.env?.VITE_USE_FIREBASE_EMULATOR === 'true');

// Firebase configuration - will be replaced at runtime in production
export const firebaseConfig = isEmulatorMode
  ? {
      apiKey: 'fake-api-key',
      authDomain: 'demo-test.firebaseapp.com',
      projectId: 'demo-test',
      storageBucket: 'demo-test.firebasestorage.app',
      messagingSenderId: '000000000000',
      appId: '1:000000000000:web:demo',
    }
  : {
      apiKey: 'AIzaSyBbugulRE4hhlFmSlYSDo22pwkPnZqWfrw',
      authDomain: 'chalanding.firebaseapp.com',
      projectId: 'chalanding',
      storageBucket: 'chalanding.firebasestorage.app',
      messagingSenderId: '190604485916',
      appId: '1:190604485916:web:abc123def456',
    };
