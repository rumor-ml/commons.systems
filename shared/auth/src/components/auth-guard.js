/**
 * Auth Guard Component
 * Shows/hides content based on authentication state
 */

import { subscribeToAuthState } from '../auth-state.js';

/**
 * Create auth guard that controls content visibility
 * @param {Object} options - Configuration options
 * @param {HTMLElement} options.element - Element to guard
 * @param {boolean} options.requireAuth - If true, show when authenticated; if false, show when not authenticated
 * @param {HTMLElement} options.fallback - Element to show when condition not met (optional)
 * @param {Function} options.onAuthRequired - Callback when auth is required but user is not authenticated
 * @returns {Function} Unsubscribe function
 */
export function createAuthGuard(options = {}) {
  const {
    element,
    requireAuth = true,
    fallback = null,
    onAuthRequired = null
  } = options;

  if (!element) {
    throw new Error('AuthGuard requires an element');
  }

  // Store original display style
  const originalDisplay = element.style.display || '';
  const fallbackOriginalDisplay = fallback?.style.display || '';

  // Subscribe to auth state
  const unsubscribe = subscribeToAuthState((state) => {
    const { isAuthenticated, isLoading } = state;

    // Don't show anything while loading
    if (isLoading) {
      element.style.display = 'none';
      if (fallback) fallback.style.display = 'none';
      return;
    }

    const shouldShow = requireAuth ? isAuthenticated : !isAuthenticated;

    if (shouldShow) {
      element.style.display = originalDisplay;
      if (fallback) fallback.style.display = 'none';
    } else {
      element.style.display = 'none';
      if (fallback) {
        fallback.style.display = fallbackOriginalDisplay;
      } else if (requireAuth && !isAuthenticated && onAuthRequired) {
        onAuthRequired();
      }
    }
  });

  return unsubscribe;
}

/**
 * Guard multiple elements with same condition
 * @param {HTMLElement[]} elements - Array of elements to guard
 * @param {Object} options - Guard options (same as createAuthGuard)
 * @returns {Function} Unsubscribe function for all guards
 */
export function createAuthGuards(elements, options = {}) {
  const unsubscribers = elements.map((element) =>
    createAuthGuard({ ...options, element })
  );

  // Return function that unsubscribes all
  return () => {
    unsubscribers.forEach((unsub) => unsub());
  };
}

/**
 * Make an element require authentication
 * Adds click handler that prevents action if not authenticated
 * @param {HTMLElement} element - Element to protect
 * @param {Object} options - Configuration options
 * @param {Function} options.onAuthRequired - Callback when user tries to interact without auth
 * @param {string} options.message - Message to show when auth required
 * @returns {Function} Remove handler function
 */
export function requireAuth(element, options = {}) {
  const {
    onAuthRequired = null,
    message = 'You must be signed in to perform this action'
  } = options;

  let isAuthenticated = false;

  // Subscribe to auth state
  const unsubscribe = subscribeToAuthState((state) => {
    isAuthenticated = state.isAuthenticated;

    // Add visual indicator
    if (isAuthenticated) {
      element.classList.remove('auth-required');
    } else {
      element.classList.add('auth-required');
    }
  });

  // Add click handler
  const clickHandler = (e) => {
    if (!isAuthenticated) {
      e.preventDefault();
      e.stopPropagation();

      if (onAuthRequired) {
        onAuthRequired();
      } else {
        alert(message);
      }
    }
  };

  element.addEventListener('click', clickHandler, true);

  // Return cleanup function
  return () => {
    unsubscribe();
    element.removeEventListener('click', clickHandler, true);
    element.classList.remove('auth-required');
  };
}
