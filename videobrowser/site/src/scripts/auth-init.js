/**
 * Authentication Initialization for Videobrowser
 * Sets up GitHub OAuth and injects auth UI components
 */

import {
  initAuth,
  initAuthState,
  createAuthButton,
  createUserProfile
} from '@commons/auth';
import '@commons/auth/styles/auth-button.css';
import '@commons/auth/styles/user-profile.css';
import { firebaseConfig } from '../firebase-config.js';

/**
 * Initialize authentication and inject UI components into header
 */
export function initializeAuth() {
  // Initialize Firebase Auth with GitHub provider
  initAuth(firebaseConfig);

  // Initialize auth state management
  initAuthState();

  // Find header
  const header = document.querySelector('.header');
  if (!header) {
    console.warn('Header not found, skipping auth UI injection');
    return;
  }

  // Create auth container in header
  const authContainer = document.createElement('div');
  authContainer.className = 'header__auth';
  authContainer.style.display = 'flex';
  authContainer.style.alignItems = 'center';
  authContainer.style.gap = '12px';
  authContainer.style.marginTop = '12px';

  // Create user profile component
  const userProfile = createUserProfile({
    showAvatar: true,
    showName: true,
    showUsername: true,
    showEmail: false,
    avatarSize: 32,
    className: 'user-profile--compact user-profile--dark'
  });

  // Create auth button
  const authButton = createAuthButton({
    loginText: 'Sign in with GitHub',
    logoutText: 'Sign out',
    className: 'auth-button--compact auth-button--dark',
    onSignIn: () => {
      // User successfully signed in
    },
    onSignOut: () => {
      // User signed out
    },
    onError: (error) => {
      console.error('Auth error:', error);
      // Show user-friendly error message
      const errorMessage = getErrorMessage(error.code);
      alert(errorMessage);
    }
  });

  // Add components to container
  authContainer.appendChild(userProfile);
  authContainer.appendChild(authButton);

  // Add to header
  header.appendChild(authContainer);
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
