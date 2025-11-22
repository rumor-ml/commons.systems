/**
 * Authentication Button Component
 * Displays login/logout button based on auth state
 */

import { signInWithGitHub, signOutUser } from '../github-auth.js';
import { subscribeToAuthState } from '../auth-state.js';

/**
 * Create auth button element
 * @param {Object} options - Configuration options
 * @param {string} options.loginText - Text for login button (default: "Sign in with GitHub")
 * @param {string} options.logoutText - Text for logout button (default: "Sign out")
 * @param {string} options.className - Additional CSS class names
 * @param {Function} options.onSignIn - Callback after successful sign in
 * @param {Function} options.onSignOut - Callback after sign out
 * @param {Function} options.onError - Callback for auth errors
 * @returns {HTMLElement} Button element
 */
export function createAuthButton(options = {}) {
  const {
    loginText = 'Sign in with GitHub',
    logoutText = 'Sign out',
    className = '',
    onSignIn = null,
    onSignOut = null,
    onError = null
  } = options;

  // Create button element
  const button = document.createElement('button');
  button.className = `auth-button ${className}`.trim();
  button.type = 'button';

  // Create icon element
  const icon = document.createElement('span');
  icon.className = 'auth-button__icon';
  icon.innerHTML = getGitHubIcon();

  // Create text element
  const text = document.createElement('span');
  text.className = 'auth-button__text';

  // Create loading spinner
  const spinner = document.createElement('span');
  spinner.className = 'auth-button__spinner';
  spinner.style.display = 'none';
  spinner.innerHTML = '⟳';

  button.appendChild(icon);
  button.appendChild(text);
  button.appendChild(spinner);

  let isLoading = false;
  let unsubscribe = null;

  // Handle button click
  button.addEventListener('click', async () => {
    if (isLoading) return;

    const { isAuthenticated } = getButtonState();

    try {
      setLoading(true);

      if (isAuthenticated) {
        await signOutUser();
        if (onSignOut) onSignOut();
      } else {
        const result = await signInWithGitHub();
        if (onSignIn) onSignIn(result);
      }
    } catch (error) {
      console.error('Auth button error:', error);
      if (onError) {
        onError(error);
      } else {
        alert(`Authentication error: ${error.message}`);
      }
    } finally {
      setLoading(false);
    }
  });

  // Subscribe to auth state changes
  unsubscribe = subscribeToAuthState((state) => {
    updateButton(state);
  });

  // Store unsubscribe function on button for cleanup
  button._unsubscribe = unsubscribe;

  function getButtonState() {
    return {
      isAuthenticated: button.dataset.authenticated === 'true',
      isLoading
    };
  }

  function setLoading(loading) {
    isLoading = loading;
    button.disabled = loading;

    if (loading) {
      spinner.style.display = 'inline-block';
      icon.style.display = 'none';
    } else {
      spinner.style.display = 'none';
      icon.style.display = 'inline-block';
    }
  }

  function updateButton(state) {
    const { isAuthenticated: authed, isLoading: loading } = state;

    button.dataset.authenticated = authed;

    if (loading) {
      text.textContent = 'Loading...';
      button.disabled = true;
    } else if (authed) {
      text.textContent = logoutText;
      button.classList.add('auth-button--authenticated');
      button.classList.remove('auth-button--unauthenticated');
    } else {
      text.textContent = loginText;
      button.classList.add('auth-button--unauthenticated');
      button.classList.remove('auth-button--authenticated');
    }
  }

  return button;
}

/**
 * Destroy auth button and cleanup listeners
 * @param {HTMLElement} button - Button element to destroy
 */
export function destroyAuthButton(button) {
  if (button._unsubscribe) {
    button._unsubscribe();
    delete button._unsubscribe;
  }
  button.remove();
}

/**
 * Get GitHub icon SVG
 * @returns {string} SVG markup
 */
function getGitHubIcon() {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
  </svg>`;
}
