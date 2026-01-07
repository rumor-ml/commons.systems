/**
 * GitHub OAuth Authentication Module
 * Handles Firebase Authentication with GitHub provider
 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GithubAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';

let app = null;
let auth = null;
let provider = null;

// Auth ready state tracking for explicit initialization dependency management
let authReady = false;
let authReadyCallbacks = [];

/**
 * Initialize Firebase Auth with GitHub provider
 * @param {Object} firebaseConfig - Firebase configuration object
 */
export function initAuth(firebaseConfig) {
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    provider = new GithubAuthProvider();

    // Request additional GitHub scopes if needed
    provider.addScope('user:email');
    provider.addScope('read:user');

    // Mark auth as ready and trigger any queued callbacks
    authReady = true;
    authReadyCallbacks.forEach((cb) => cb());
    authReadyCallbacks = [];
  }

  return auth;
}

/**
 * Register a callback to be invoked when auth is ready
 * Allows code to defer operations until auth initialization completes
 * @param {Function} callback - Function to call when auth is ready
 * @example
 * onAuthReady(() => {
 *   setupAuthStateListener(); // Only runs when safe
 * });
 */
export function onAuthReady(callback) {
  if (authReady) {
    // Auth already initialized, invoke immediately
    callback();
  } else {
    // Queue callback for when initAuth() completes
    authReadyCallbacks.push(callback);
  }
}

/**
 * Get the current auth instance
 * @returns {Object} Firebase Auth instance
 */
export function getAuthInstance() {
  if (!auth) {
    throw new Error('Auth not initialized. Call initAuth() first.');
  }
  return auth;
}

/**
 * Sign in with GitHub OAuth popup
 * @returns {Promise<Object>} User credential object
 */
export async function signInWithGitHub() {
  try {
    const result = await signInWithPopup(auth, provider);

    // Get GitHub access token if needed for GitHub API calls
    const credential = GithubAuthProvider.credentialFromResult(result);
    const githubToken = credential?.accessToken;

    // Store GitHub token for potential API usage
    if (githubToken) {
      sessionStorage.setItem('github_access_token', githubToken);
    }

    return {
      user: result.user,
      githubToken,
      credential,
    };
  } catch (error) {
    console.error('GitHub sign-in error:', error);
    throw error;
  }
}

/**
 * Sign out the current user
 * @returns {Promise<void>}
 */
export async function signOutUser() {
  try {
    await signOut(auth);
    sessionStorage.removeItem('github_access_token');
  } catch (error) {
    console.error('Sign-out error:', error);
    throw error;
  }
}

/**
 * Subscribe to auth state changes
 * @param {Function} callback - Callback function(user) called on auth state change
 * @returns {Function} Unsubscribe function
 */
export function onAuthStateChange(callback) {
  if (!auth) {
    // Throw explicit error that cards.js retry logic can catch
    const error = new Error('Auth not initialized - call initAuth() first');
    error.code = 'auth-not-initialized';
    throw error;
  }
  return onAuthStateChanged(auth, (user) => {
    callback(user);
  });
}

/**
 * Get current user
 * @returns {Object|null} Current user or null
 */
export function getCurrentUser() {
  return auth?.currentUser || null;
}

/**
 * Check if user is authenticated
 * @returns {boolean}
 */
export function isAuthenticated() {
  return !!auth?.currentUser;
}

/**
 * Get GitHub access token from session
 * @returns {string|null} GitHub access token
 */
export function getGitHubToken() {
  return sessionStorage.getItem('github_access_token');
}
