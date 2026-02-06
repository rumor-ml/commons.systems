import {
  getAuth,
  Auth,
  signInWithPopup,
  GithubAuthProvider,
  signOut,
  onAuthStateChanged,
  User,
  connectAuthEmulator,
} from 'firebase/auth';
import { initFirebase } from './firestore';
import { logError } from '../utils/logger';
import { errorIds } from '../constants/errorIds';

// Auth singleton
let authInstance: Auth | null = null;
let emulatorConnected = false;

// Get Auth instance
export function getAuthInstance(): Auth {
  if (!authInstance) {
    const app = initFirebase();
    authInstance = getAuth(app);

    // Connect to Auth emulator if configured
    if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true' && !emulatorConnected) {
      const port = import.meta.env.VITE_FIREBASE_EMULATOR_AUTH_PORT || '9099';
      try {
        connectAuthEmulator(authInstance, `http://localhost:${port}`, {
          disableWarnings: true,
        });
        emulatorConnected = true;
        console.log(`✓ Connected to Auth emulator on localhost:${port}`);
      } catch (error) {
        // Ignore "already initialized" errors from hot reload
        if (
          error instanceof Error &&
          error.message.includes('Auth instance has already been used')
        ) {
          console.log('Auth emulator connection already established');
        } else {
          console.error('Failed to connect to Auth emulator:', error);
          throw error;
        }
      }
    }
  }
  return authInstance;
}

// Sign in with GitHub
export async function signInWithGitHub(): Promise<User> {
  const auth = getAuthInstance();
  const provider = new GithubAuthProvider();

  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    logError('Failed to sign in with GitHub', {
      errorId: errorIds.AUTH_SIGNIN_FAILED,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
}

// Sign out
export async function signOutUser(): Promise<void> {
  const auth = getAuthInstance();
  try {
    await signOut(auth);
  } catch (error) {
    logError('Failed to sign out', {
      errorId: errorIds.AUTH_SIGNOUT_FAILED,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
}

// Listen to auth state changes
export function onAuthChange(callback: (user: User | null) => void): () => void {
  const auth = getAuthInstance();
  return onAuthStateChanged(auth, callback);
}

// Get current user
export function getCurrentUser(): User | null {
  const auth = getAuthInstance();
  return auth.currentUser;
}

// Check if user is signed in
export function isSignedIn(): boolean {
  return getCurrentUser() !== null;
}
