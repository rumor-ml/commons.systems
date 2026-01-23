import {
  getAuth,
  Auth,
  signInWithPopup,
  GithubAuthProvider,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { initFirebase } from './firestore';

// Auth singleton
let authInstance: Auth | null = null;

// Get Auth instance
export function getAuthInstance(): Auth {
  if (!authInstance) {
    const app = initFirebase();
    authInstance = getAuth(app);
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
    console.error('Error signing in with GitHub:', error);
    throw error;
  }
}

// Sign out
export async function signOutUser(): Promise<void> {
  const auth = getAuthInstance();
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Error signing out:', error);
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
