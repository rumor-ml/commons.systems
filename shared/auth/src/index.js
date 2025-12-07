/**
 * Commons Auth Library
 * Shared GitHub authentication for commons.systems sites
 *
 * @example
 * import { initAuth, initAuthState, createAuthButton, createUserProfile } from '@commons/auth';
 * import '@commons/auth/styles/auth-button.css';
 * import '@commons/auth/styles/user-profile.css';
 *
 * // Initialize auth
 * initAuth(firebaseConfig);
 * initAuthState();
 *
 * // Create UI components
 * const authButton = createAuthButton({ loginText: 'Sign in' });
 * const userProfile = createUserProfile({ showEmail: true });
 *
 * document.getElementById('auth-container').appendChild(authButton);
 * document.getElementById('profile-container').appendChild(userProfile);
 */

// Core auth functions
export {
  initAuth,
  getAuthInstance,
  signInWithGitHub,
  signOutUser,
  onAuthStateChange,
  getCurrentUser,
  isAuthenticated,
  getGitHubToken,
} from './github-auth.js';

// State management
export { initAuthState, getAuthState, subscribeToAuthState, clearAuthState } from './auth-state.js';

// UI Components
export { createAuthButton, destroyAuthButton } from './components/auth-button.js';

export { createUserProfile, destroyUserProfile } from './components/user-profile.js';

export { createAuthGuard, createAuthGuards, requireAuth } from './components/auth-guard.js';
