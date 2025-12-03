/**
 * Authentication State Management
 * Handles auth state persistence and notifications
 */

import { onAuthStateChange } from './github-auth.js';

const AUTH_STATE_KEY = 'commons_auth_state';
const listeners = new Set();

let currentAuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false  // Start as not loading - Firebase will trigger state update
};

/**
 * Initialize auth state management
 */
export function initAuthState() {
  // Listen to Firebase auth changes
  onAuthStateChange((user) => {
    updateAuthState(user);
  });

  // Load persisted state
  loadPersistedState();
}

/**
 * Update auth state and notify listeners
 * @param {Object|null} user - Firebase user object
 */
function updateAuthState(user) {
  const newState = {
    user: user ? serializeUser(user) : null,
    isAuthenticated: !!user,
    isLoading: false
  };

  currentAuthState = newState;

  // Persist to localStorage
  if (user) {
    localStorage.setItem(AUTH_STATE_KEY, JSON.stringify(newState));
  } else {
    localStorage.removeItem(AUTH_STATE_KEY);
  }

  // Notify all listeners
  notifyListeners(newState);
}

/**
 * Serialize user object for storage
 * @param {Object} user - Firebase user object
 * @returns {Object} Serializable user data
 */
function serializeUser(user) {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    emailVerified: user.emailVerified,
    // Extract GitHub username from providerData
    githubUsername: user.reloadUserInfo?.screenName || extractGitHubUsername(user),
    metadata: {
      creationTime: user.metadata.creationTime,
      lastSignInTime: user.metadata.lastSignInTime
    }
  };
}

/**
 * Extract GitHub username from user object
 * @param {Object} user - Firebase user object
 * @returns {string|null}
 */
function extractGitHubUsername(user) {
  const githubProvider = user.providerData?.find(
    (p) => p.providerId === 'github.com'
  );

  if (githubProvider?.displayName) {
    return githubProvider.displayName;
  }

  // Try to extract from email
  if (user.email?.includes('@')) {
    return user.email.split('@')[0];
  }

  return null;
}

/**
 * Load persisted auth state from localStorage
 */
function loadPersistedState() {
  try {
    const stored = localStorage.getItem(AUTH_STATE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Don't override isLoading or isAuthenticated until Firebase confirms
      currentAuthState.user = parsed.user;
    }
  } catch (error) {
    console.error('Error loading persisted auth state:', error);
    localStorage.removeItem(AUTH_STATE_KEY);
  }
}

/**
 * Get current auth state
 * @returns {Object} Current auth state
 */
export function getAuthState() {
  return { ...currentAuthState };
}

/**
 * Subscribe to auth state changes
 * @param {Function} listener - Callback function(state)
 * @returns {Function} Unsubscribe function
 */
export function subscribeToAuthState(listener) {
  listeners.add(listener);

  // Immediately call with current state
  listener(getAuthState());

  // Return unsubscribe function
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Notify all listeners of state change
 * @param {Object} state - New auth state
 */
function notifyListeners(state) {
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.error('Error in auth state listener:', error);
    }
  });
}

/**
 * Clear all auth state and listeners
 */
export function clearAuthState() {
  currentAuthState = {
    user: null,
    isAuthenticated: false,
    isLoading: false
  };
  localStorage.removeItem(AUTH_STATE_KEY);
  listeners.clear();
}
