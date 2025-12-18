/**
 * Toast Notification System
 *
 * Provides client-side toast notifications with auto-dismiss, actions, and HTMX compatibility.
 * Works with both client-side showToast() calls and server-side HTMX out-of-band swaps.
 */

let toastIdCounter = 0;

/**
 * Show a toast notification
 * @param {Object} options - Toast configuration
 * @param {string} options.title - Toast title
 * @param {string} options.message - Toast message
 * @param {'error'|'warning'|'success'|'info'} options.type - Toast type
 * @param {number} [options.duration=5000] - Auto-dismiss duration in ms (0 = no auto-dismiss)
 * @param {string} [options.actionLabel] - Optional action button label
 * @param {Function} [options.onAction] - Optional action button callback
 * @returns {string} Toast ID for programmatic dismissal
 */
export function showToast({
  title,
  message,
  type = 'info',
  duration = 5000,
  actionLabel,
  onAction,
}) {
  const container = getOrCreateContainer();
  const toastId = `toast-${++toastIdCounter}`;

  const toast = createToastElement(toastId, title, message, type, actionLabel, onAction);
  container.appendChild(toast);

  // Auto-dismiss if duration > 0
  if (duration > 0) {
    setTimeout(() => dismissToast(toastId), duration);
  }

  return toastId;
}

/**
 * Dismiss a toast notification
 * @param {string} toastId - Toast ID to dismiss
 */
export function dismissToast(toastId) {
  const toast = document.getElementById(toastId);
  if (!toast) return;

  // Add dismissing animation
  toast.classList.add('toast--dismissing');

  // Remove from DOM after animation completes
  setTimeout(() => {
    toast.remove();

    // Clean up container if empty
    const container = document.querySelector('.toast-container');
    if (container && container.children.length === 0) {
      container.remove();
    }
  }, 200); // Match animation duration
}

/**
 * Create toast element
 * @private
 */
function createToastElement(toastId, title, message, type, actionLabel, onAction) {
  const toast = document.createElement('div');
  toast.id = toastId;
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

  // Header with title and close button
  const header = document.createElement('div');
  header.className = 'toast__header';

  const titleEl = document.createElement('div');
  titleEl.className = `toast__title toast__title--${type}`;
  titleEl.textContent = title;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast__close';
  closeBtn.setAttribute('aria-label', 'Close notification');

  // Create SVG close icon using safe DOM methods
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('stroke', 'currentColor');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('d', 'M6 18L18 6M6 6l12 12');

  svg.appendChild(path);
  closeBtn.appendChild(svg);
  closeBtn.addEventListener('click', () => dismissToast(toastId));

  header.appendChild(titleEl);
  header.appendChild(closeBtn);

  // Body with message
  const body = document.createElement('div');
  body.className = 'toast__body';
  body.textContent = message;

  toast.appendChild(header);
  toast.appendChild(body);

  // Optional action button
  if (actionLabel && onAction) {
    const actionContainer = document.createElement('div');
    actionContainer.className = 'toast__action';

    const actionBtn = document.createElement('button');
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener('click', () => {
      onAction();
      dismissToast(toastId);
    });

    actionContainer.appendChild(actionBtn);
    toast.appendChild(actionContainer);
  }

  return toast;
}

/**
 * Get or create toast container
 * @private
 */
function getOrCreateContainer() {
  let container = document.querySelector('.toast-container');

  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(container);
  }

  return container;
}

/**
 * Handle HTMX out-of-band toast swaps
 * Server can send HTML with hx-swap-oob="true" to trigger toasts
 */
if (typeof window !== 'undefined') {
  // Make showToast globally available for inline scripts
  window.showToast = showToast;
  window.dismissToast = dismissToast;

  // Listen for HTMX-triggered toasts (optional integration)
  document.addEventListener('htmx:oobAfterSwap', (event) => {
    try {
      const element = event.detail.target;

      if (!element.classList?.contains('toast')) {
        return;
      }

      if (!element.id || typeof element.id !== 'string') {
        console.error('[Toast] HTMX toast element missing valid id attribute', element);
        return;
      }

      const durationAttr = element.dataset.duration;
      if (durationAttr) {
        const duration = parseInt(durationAttr, 10);

        if (isNaN(duration) || duration < 0) {
          console.warn(`[Toast] Invalid duration "${durationAttr}" for toast ${element.id}`);
          return;
        }

        if (duration > 0) {
          setTimeout(() => dismissToast(element.id), duration);
        }
      }
    } catch (error) {
      console.error('[Toast] Error handling HTMX out-of-band toast swap:', error);
    }
  });
}
