/**
 * Authentication Initialization for Fellspiral
 * Sets up GitHub OAuth and injects auth UI components
 */

import {
  initAuth,
  initAuthState,
  createAuthButton,
  createUserProfile,
  onAuthStateChange,
  onAuthReady,
} from '@commons/auth';
import '@commons/auth/styles/auth-button.css';
import '@commons/auth/styles/user-profile.css';
import { firebaseConfig } from '../firebase-config.js';
import { initFirebase } from './firebase.js';

/**
 * Export onAuthStateChanged for use by other modules
 * @param {function} callback - Callback function that receives user object
 */
export function onAuthStateChanged(callback) {
  return onAuthStateChange(callback);
}

/**
 * Export onAuthReady for use by other modules
 * Allows code to defer operations until auth initialization completes
 * @param {function} callback - Callback function to invoke when auth is ready
 */
export { onAuthReady };

/**
 * Initialize authentication and inject UI components
 * Supports both new sidebar layout and old navbar layout
 */
export async function initializeAuth() {
  // Guard against duplicate initialization
  const existingAuth = document.querySelector('.nav-auth .auth-button');
  if (existingAuth) {
    return;
  }

  // Initialize Firebase Auth with GitHub provider
  initAuth(firebaseConfig);

  // Initialize auth state management
  initAuthState();

  // Try new sidebar layout first (.nav-auth in sidebar)
  // TODO(#1333): Consider simplifying isNewLayout pattern with CSS classes or extracted functions
  let authContainer = document.querySelector('.nav-auth');
  let isNewLayout = true;

  // Fall back to old navbar layout (.nav-menu)
  if (!authContainer) {
    const navMenu = document.querySelector('.nav-menu');
    if (navMenu) {
      authContainer = document.createElement('li');
      authContainer.className = 'nav-auth';
      navMenu.appendChild(authContainer);
      isNewLayout = false;
    }
  }

  if (!authContainer) {
    console.warn('Auth container not found, skipping auth UI injection');
    return;
  }

  // Style auth container based on layout
  if (isNewLayout) {
    // Sidebar layout styling
    authContainer.style.display = 'flex';
    authContainer.style.flexDirection = 'column';
    authContainer.style.gap = '12px';
    authContainer.style.padding = '16px';
    authContainer.style.borderTop = '1px solid var(--border-color, #e0e0e0)';
    authContainer.style.marginTop = 'auto';
  } else {
    // Navbar layout styling
    authContainer.style.marginLeft = 'auto';
    authContainer.style.display = 'flex';
    authContainer.style.alignItems = 'center';
    authContainer.style.gap = '12px';
  }

  // Create user profile component
  const userProfile = createUserProfile({
    showAvatar: true,
    showName: true,
    showUsername: false,
    showEmail: false,
    avatarSize: 32,
    className: 'user-profile--compact',
  });

  // Create auth button
  const authButton = createAuthButton({
    loginText: 'Sign in with GitHub',
    logoutText: 'Sign out',
    className: 'auth-button--compact',
    onSignIn: () => {
      // User successfully signed in
    },
    onSignOut: () => {
      // User signed out
    },
    onError: (error) => {
      // Structured logging with full error context for debugging
      console.error('[Auth] Sign-in error:', {
        code: error.code,
        message: error.message,
        stack: error.stack,
      });

      // Show inline error banner with retry option
      // TODO(#1377): Don't auto-dismiss error banners - require user acknowledgment
      const errorMessage = getErrorMessage(error.code);
      const authErrorBanner = createErrorBanner(errorMessage, error.code);

      // Remove existing error banner before adding new one
      const existingBanner = authContainer.querySelector('.auth-error-banner');
      if (existingBanner) {
        existingBanner.remove();
      }

      // Insert banner at the top of auth container
      authContainer.insertBefore(authErrorBanner, authContainer.firstChild);
    },
  });

  // Add components to container
  authContainer.appendChild(userProfile);
  authContainer.appendChild(authButton);

  // Initialize Firebase for test compatibility (idempotent, safe for lazy-loading)
  await initFirebase();
}

/**
 * Get user-friendly error message
 * @param {string} errorCode - Firebase error code
 * @returns {string} User-friendly message
 */
function getErrorMessage(errorCode) {
  switch (errorCode) {
    case 'auth/popup-closed-by-user':
      return 'Sign-in cancelled. Please try again.';
    case 'auth/popup-blocked':
      return 'Pop-up blocked by browser. Please allow pop-ups for this site.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your connection and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email. Please use the same sign-in method.';
    default:
      return `Authentication error: ${errorCode}`;
  }
}

/**
 * Create inline error banner with retry option
 * @param {string} message - User-friendly error message
 * @param {string} errorCode - Firebase error code
 * @returns {HTMLElement} Error banner element
 */
function createErrorBanner(message, errorCode) {
  const banner = document.createElement('div');
  banner.className = 'auth-error-banner';

  // Apply inline styles using design system tokens
  banner.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    background-color: var(--color-error-muted);
    border: 1px solid var(--color-error);
    border-radius: 6px;
    margin-bottom: 12px;
  `;

  // Error message
  const messageElement = document.createElement('p');
  messageElement.style.cssText = `
    margin: 0;
    font-size: 14px;
    color: var(--color-text-primary);
    line-height: 1.5;
  `;
  messageElement.textContent = message;

  // Retry button
  const retryButton = document.createElement('button');
  retryButton.className = 'btn btn--sm';
  retryButton.textContent = 'Try Again';
  retryButton.style.cssText = `
    align-self: flex-start;
  `;
  retryButton.onclick = () => {
    // Trigger sign-in by clicking the auth button
    const authButton = document.querySelector('.auth-button button');
    if (authButton) {
      authButton.click();
    }
  };

  banner.appendChild(messageElement);
  banner.appendChild(retryButton);

  // Auto-dismiss for non-critical errors after 10 seconds
  const criticalErrors = ['auth/network-request-failed', 'auth/popup-blocked'];
  if (!criticalErrors.includes(errorCode)) {
    setTimeout(() => {
      if (banner.parentNode) {
        banner.remove();
      }
    }, 10000);
  }

  return banner;
}
