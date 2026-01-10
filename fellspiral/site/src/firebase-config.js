/**
 * Firebase Configuration for Fellspiral
 *
 * This configuration is safe to expose publicly as it only identifies
 * the Firebase project. Access control is managed via Firestore security
 * rules (firestore.rules).
 */

// Firebase configuration - will be replaced at runtime in production
export const firebaseConfig = {
  apiKey: 'AIzaSyBbugulRE4hhlFmSlYSDo22pwkPnZqWfrw',
  authDomain: 'chalanding.firebaseapp.com',
  // Use test projectId from Vite env if available, otherwise production
  projectId: import.meta.env?.VITE_GCP_PROJECT_ID || 'chalanding',
  storageBucket: 'chalanding.firebasestorage.app',
  messagingSenderId: '190604485916',
  appId: '1:190604485916:web:abc123def456',
};
