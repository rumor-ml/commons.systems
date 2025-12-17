/**
 * Global Auth Error Handling
 *
 * Centralized error handling for authentication system.
 * Listens to auth-error events and displays appropriate user notifications.
 */

/**
 * Setup global auth error handling
 * Call this once during app initialization
 */
export function setupAuthErrorHandling() {
  if (typeof window === 'undefined') {
    return;
  }

  window.addEventListener('auth-error', (event) => {
    const { code, message, action, recoverable } = event.detail;

    // Don't show toast if it's already been shown by the auth-state module
    // (we check if showToast exists and if a recent toast was shown)
    if (!window.showToast) {
      console.warn('Toast system not available for auth error:', event.detail);
      return;
    }

    // Get appropriate title based on error code
    const title = getErrorTitle(code);

    // Show toast notification
    try {
      window.showToast({
        title,
        message,
        type: recoverable ? 'warning' : 'error',
        duration: recoverable ? 8000 : 0,
        actionLabel: action || null,
        onAction: action ? () => handleErrorAction(code) : null,
      });
    } catch (toastError) {
      console.error('Failed to show toast for auth error:', toastError, { code, message });
    }
  });
}

/**
 * Get user-friendly title for error code
 * @param {string} code - Error code
 * @returns {string} Error title
 */
function getErrorTitle(code) {
  const titles = {
    'auth/storage-quota-exceeded': 'Storage Full',
    'auth/storage-parse-failed': 'Data Corrupted',
    'auth/storage-access-denied': 'Storage Access Denied',
    'auth/storage-failed': 'Storage Error',
    'auth/listener-systemic-failure': 'Authentication Error',
    'auth/init-failed': 'Initialization Failed',
    'auth/sign-in-failed': 'Sign-in Failed',
  };

  return titles[code] || 'Authentication Error';
}

/**
 * Handle recovery actions for errors
 * @param {string} code - Error code
 */
function handleErrorAction(code) {
  switch (code) {
    case 'auth/storage-quota-exceeded':
    case 'auth/storage-parse-failed':
      // Clear storage and reload
      try {
        localStorage.removeItem('commons_auth_state');
        window.location.reload();
      } catch (error) {
        console.error('Failed to clear storage:', error);
        window.location.reload();
      }
      break;

    case 'auth/listener-systemic-failure':
    case 'auth/init-failed':
    case 'auth/sign-in-failed':
      // Reload page
      window.location.reload();
      break;

    case 'auth/storage-access-denied':
      // Open browser settings (best effort)
      alert('Please check your browser privacy settings and allow local storage for this site.');
      break;

    default:
      console.warn('No recovery action defined for error code:', code);
  }
}
