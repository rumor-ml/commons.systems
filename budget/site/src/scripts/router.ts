/**
 * Simple hash-based router for single-page navigation
 */

export type Route = '/' | '/plan';

/**
 * Get the current route from the hash
 */
export function getCurrentRoute(): Route {
  const hash = window.location.hash;

  // Map hash to route
  if (hash === '#/plan' || hash === '#plan') {
    return '/plan';
  }

  // Default to main view
  return '/';
}

/**
 * Navigate to a route by updating the hash
 */
export function navigateTo(route: Route): void {
  if (route === '/') {
    window.location.hash = '#/';
  } else {
    window.location.hash = `#${route}`;
  }
}

/**
 * Set up hash change listener for routing
 * @param callback - Function to call when route changes
 * @returns Cleanup function to remove listener
 */
export function setupRouteListener(callback: (route: Route) => void): () => void {
  const handler = () => {
    callback(getCurrentRoute());
  };

  window.addEventListener('hashchange', handler);

  // Call immediately with current route
  handler();

  // Return cleanup function
  return () => {
    window.removeEventListener('hashchange', handler);
  };
}
