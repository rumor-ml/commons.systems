/**
 * Authentication Initialization for Fellspiral
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
 * Initialize authentication and inject UI components into navbar
 */
export function initializeAuth() {
  // Initialize Firebase Auth with GitHub provider
  initAuth(firebaseConfig);

  // Initialize auth state management
  initAuthState();

  // Find navbar menu
  const navMenu = document.querySelector('.nav-menu');
  if (!navMenu) {
    console.warn('Navbar not found, skipping auth UI injection');
    return;
  }

  // Create auth UI container in navbar
  const authContainer = document.createElement('li');
  authContainer.className = 'nav-auth';
  authContainer.style.marginLeft = 'auto';
  authContainer.style.display = 'flex';
  authContainer.style.alignItems = 'center';
  authContainer.style.gap = '12px';

  // Create user profile component
  const userProfile = createUserProfile({
    showAvatar: true,
    showName: true,
    showUsername: false,
    showEmail: false,
    avatarSize: 32,
    className: 'user-profile--compact'
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
      console.error('Auth error:', error);
      // Show user-friendly error message
      const errorMessage = getErrorMessage(error.code);
      alert(errorMessage);
    }
  });

  // Add components to container
  authContainer.appendChild(userProfile);
  authContainer.appendChild(authButton);

  // Add to navbar
  navMenu.appendChild(authContainer);
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
