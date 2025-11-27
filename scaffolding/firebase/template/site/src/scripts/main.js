import { initializeApp } from 'firebase/app';

// Firebase configuration using Vite environment variables
// Copy .env.example to .env.local and fill in your Firebase config
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

// Validate required configuration
const requiredKeys = ['apiKey', 'projectId'];
const missingKeys = requiredKeys.filter(key => !firebaseConfig[key]);

if (missingKeys.length > 0) {
  console.error(`Firebase config incomplete. Missing: ${missingKeys.join(', ')}. Check .env.local file.`);
  throw new Error('Firebase configuration missing required values');
}

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// App initialization
document.addEventListener('DOMContentLoaded', () => {
  console.log('{{APP_NAME_TITLE}} initialized with Firebase');
});
