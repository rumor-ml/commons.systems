/**
 * Authentication State Management
 * Handles auth state persistence and notifications
 */

import { onAuthStateChange } from './github-auth.js';

const AUTH_STATE_KEY = 'commons_auth_state';
const listeners = new Set();
const listenerFailures = [];

let currentAuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: false, // Start as not loading - Firebase will trigger state update
  error: null, // { code, message, action, recoverable, timestamp, details }
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
    isLoading: false,
    error: currentAuthState.error, // Preserve error state
  };

  currentAuthState = newState;

  // Persist to localStorage
  try {
    if (user) {
      localStorage.setItem(AUTH_STATE_KEY, JSON.stringify(newState));
    } else {
      localStorage.removeItem(AUTH_STATE_KEY);
    }
  } catch (error) {
    console.error('Error persisting auth state:', error);

    // Categorize and handle storage error
    const errorInfo = categorizeStorageError(error);
    currentAuthState.error = errorInfo;

    // Display toast notification
    if (typeof window !== 'undefined' && window.showToast) {
      window.showToast({
        title: 'Storage Error',
        message: errorInfo.message,
        type: 'warning',
        duration: 8000,
      });
    }
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
      lastSignInTime: user.metadata.lastSignInTime,
    },
  };
}

/**
 * Extract GitHub username from user object
 * @param {Object} user - Firebase user object
 * @returns {string|null}
 */
function extractGitHubUsername(user) {
  const githubProvider = user.providerData?.find((p) => p.providerId === 'github.com');

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

    // Categorize storage errors
    const errorInfo = categorizeStorageError(error);
    currentAuthState.error = errorInfo;

    // Display toast notification for critical errors
    if (typeof window !== 'undefined' && window.showToast) {
      window.showToast({
        title: 'Storage Error',
        message: errorInfo.message,
        type: errorInfo.recoverable ? 'warning' : 'error',
        duration: errorInfo.recoverable ? 8000 : 0,
        actionLabel: errorInfo.action || null,
        onAction: errorInfo.action
          ? () => {
              if (errorInfo.code === 'auth/storage-quota-exceeded') {
                // Try to clear corrupted data
                try {
                  localStorage.removeItem(AUTH_STATE_KEY);
                  window.location.reload();
                } catch (e) {
                  console.error('Failed to clear storage:', e);
                }
              } else if (errorInfo.code === 'auth/storage-parse-failed') {
                // Clear corrupted data and reload
                localStorage.removeItem(AUTH_STATE_KEY);
                window.location.reload();
              }
            }
          : null,
      });
    }

    // Always try to clear corrupted data
    try {
      localStorage.removeItem(AUTH_STATE_KEY);
    } catch (clearError) {
      console.error('Failed to clear corrupted auth state:', clearError);
    }

    // Dispatch auth-error event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('auth-error', {
          detail: errorInfo,
        })
      );
    }
  }
}

/**
 * Categorize storage errors into user-friendly error objects
 * @param {Error} error - The caught error
 * @returns {Object} Structured error information
 */
function categorizeStorageError(error) {
  const timestamp = Date.now();

  // Quota exceeded error
  if (error.name === 'QuotaExceededError' || error.code === 22) {
    return {
      code: 'auth/storage-quota-exceeded',
      message: 'Browser storage is full. Please clear browser data or use incognito mode.',
      action: 'Clear and Reload',
      recoverable: true,
      timestamp,
      details: error.message,
    };
  }

  // JSON parse error (corrupted data)
  if (error instanceof SyntaxError || error.name === 'SyntaxError') {
    return {
      code: 'auth/storage-parse-failed',
      message: 'Authentication data is corrupted. Your session will be reset.',
      action: 'Clear and Reload',
      recoverable: true,
      timestamp,
      details: error.message,
    };
  }

  // Security/access error
  if (error.name === 'SecurityError' || error.code === 18) {
    return {
      code: 'auth/storage-access-denied',
      message: 'Cannot access browser storage. Please check your browser settings.',
      action: 'Check Settings',
      recoverable: false,
      timestamp,
      details: error.message,
    };
  }

  // Generic storage error
  return {
    code: 'auth/storage-failed',
    message: 'Failed to load authentication state. Your session may not persist.',
    action: null,
    recoverable: true,
    timestamp,
    details: error.message,
  };
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

      // Track listener failures
      const timestamp = Date.now();
      listenerFailures.push({ timestamp, error });

      // Clean up old failures (keep last 10 seconds)
      const cutoff = timestamp - 10000;
      while (listenerFailures.length > 0 && listenerFailures[0].timestamp < cutoff) {
        listenerFailures.shift();
      }

      // Detect systemic failures (3+ failures in 10 seconds)
      if (listenerFailures.length >= 3) {
        const errorInfo = {
          code: 'auth/listener-systemic-failure',
          message: 'Multiple authentication components are failing',
          action: 'Refresh Page',
          recoverable: true,
          timestamp,
          details: `${listenerFailures.length} listener failures in the last 10 seconds`,
        };

        currentAuthState.error = errorInfo;

        // Dispatch global error event
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('auth-error', {
              detail: errorInfo,
            })
          );

          // Show toast with refresh action
          if (window.showToast) {
            window.showToast({
              title: 'Authentication Error',
              message: errorInfo.message,
              type: 'error',
              duration: 0, // Never auto-dismiss
              actionLabel: 'Refresh Page',
              onAction: () => window.location.reload(),
            });
          }
        }

        // Clear failures to avoid repeated notifications
        listenerFailures.length = 0;
      }
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
    isLoading: false,
  };
  localStorage.removeItem(AUTH_STATE_KEY);
  listeners.clear();
}
