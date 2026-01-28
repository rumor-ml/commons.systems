/**
 * Notification system for Budget module
 *
 * Provides programmatic API for showing/dismissing notifications with optional actions.
 * Uses a banner pattern similar to StateManager for visual consistency.
 */

import { logger } from './logger';

export type NotificationType = 'error' | 'warning' | 'info' | 'success';

export interface ActionConfig {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface NotificationConfig {
  message: string;
  type: NotificationType;
  autoDismiss?: boolean; // If true, auto-dismiss after 10s. Default: true for info/success/warning, false for error
  action?: ActionConfig;
}

/**
 * Create and display a notification banner
 *
 * @param config - Notification configuration
 * @returns Dismiss function to manually close the notification
 */
export function showNotification(config: NotificationConfig): () => void {
  const { message, type, action } = config;
  const autoDismiss = config.autoDismiss ?? type !== 'error';

  logger.debug('Showing notification', { type, message, autoDismiss });

  // Check if DOM is ready
  if (!document.body) {
    logger.error('Cannot show notification: document.body not available', { message, type });
    if (type === 'error') {
      console.error(`[NOTIFICATION ERROR] ${message}`);
    }
    throw new Error('Cannot show notification: DOM not ready');
  }

  // Create banner element
  // TODO(#1538): Add ARIA attributes for accessibility (role="alert", aria-live="polite", aria-atomic="true")
  const banner = document.createElement('div');
  banner.className = `fixed top-4 left-1/2 -translate-x-1/2 z-50 ${getBackgroundClass(type)} text-white px-6 py-3 rounded-lg shadow-lg max-w-2xl`;

  const container = document.createElement('div');
  container.className = 'flex items-center gap-3';

  // Icon
  const icon = document.createElement('span');
  icon.className = 'text-xl';
  icon.textContent = getIcon(type);

  // Message text
  const text = document.createElement('p');
  text.className = type === 'error' ? 'text-sm font-semibold' : 'text-sm';
  text.textContent = message;

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'ml-4 text-white hover:text-gray-200';
  closeBtn.textContent = '✕';
  closeBtn.onclick = dismiss;

  // Assemble banner
  container.appendChild(icon);
  container.appendChild(text);

  // Add action button if provided
  if (action && action.label.trim().length > 0) {
    const actionBtn = document.createElement('button');
    actionBtn.className =
      'ml-2 px-3 py-1 bg-white text-bg-base rounded hover:bg-gray-200 text-sm font-medium';
    actionBtn.textContent = action.label;
    actionBtn.onclick = () => {
      try {
        const result = action.onClick();
        // Handle both sync and async callbacks
        if (result instanceof Promise) {
          result
            .then(() => {
              dismiss();
            })
            .catch((error) => {
              logger.error(`Notification action "${action.label}" failed`, error);
              dismiss();
              try {
                showError(`Failed to ${action.label.toLowerCase()}. Please try again.`);
              } catch (notificationError) {
                // Fallback if showError throws (e.g., DOM not ready)
                console.error(`Failed to ${action.label.toLowerCase()}:`, error);
              }
            });
        } else {
          dismiss();
        }
      } catch (error) {
        logger.error(`Notification action "${action.label}" failed`, error);
        dismiss();
        try {
          showError(`Failed to ${action.label.toLowerCase()}. Please try again.`);
        } catch (notificationError) {
          // Fallback if showError throws (e.g., DOM not ready)
          console.error(`Failed to ${action.label.toLowerCase()}:`, error);
        }
      }
    };
    container.appendChild(actionBtn);
  }

  container.appendChild(closeBtn);
  banner.appendChild(container);
  document.body.appendChild(banner);

  // Auto-dismiss if enabled
  let timerId: number | undefined;

  if (autoDismiss) {
    timerId = setTimeout(dismiss, 10000) as unknown as number;
  }

  function dismiss() {
    if (timerId !== undefined) {
      clearTimeout(timerId);
      timerId = undefined;
    }
    try {
      if (banner.parentNode) {
        banner.remove();
      }
    } catch (error) {
      logger.warn('Failed to remove notification banner', {
        error,
        bannerHasParent: !!banner.parentNode,
        bannerTagName: banner.tagName,
      });
      // Try alternative removal method
      try {
        banner.parentNode?.removeChild(banner);
      } catch (fallbackError) {
        logger.error('All banner removal methods failed', {
          removeError: error,
          removeChildError: fallbackError,
        });
      }
    }
  }

  return dismiss;
}

/**
 * Show error notification with optional action button
 *
 * Error notifications do not auto-dismiss by default.
 * To enable auto-dismiss for errors, use showNotification() directly with autoDismiss: true.
 *
 * @param message - Error message to display
 * @param action - Optional action button configuration
 * @returns Dismiss function
 */
export function showError(message: string, action?: ActionConfig): () => void {
  return showNotification({ message, type: 'error', action });
}

/**
 * Show warning notification
 *
 * Warning notifications auto-dismiss after 10 seconds.
 *
 * @param message - Warning message to display
 * @returns Dismiss function
 */
export function showWarning(message: string): () => void {
  return showNotification({ message, type: 'warning' });
}

/**
 * Show info notification
 *
 * Info notifications auto-dismiss after 10 seconds.
 *
 * @param message - Info message to display
 * @returns Dismiss function
 */
export function showInfo(message: string): () => void {
  return showNotification({ message, type: 'info' });
}

/**
 * Show success notification
 *
 * Success notifications auto-dismiss after 10 seconds.
 *
 * @param message - Success message to display
 * @returns Dismiss function
 */
export function showSuccess(message: string): () => void {
  return showNotification({ message, type: 'success' });
}

function getBackgroundClass(type: NotificationType): string {
  switch (type) {
    case 'error':
      return 'bg-error';
    case 'warning':
      return 'bg-warning';
    case 'info':
      return 'bg-bg-surface';
    case 'success':
      return 'bg-success';
  }
}

function getIcon(type: NotificationType): string {
  switch (type) {
    case 'error':
      return '❌';
    case 'warning':
      return '⚠️';
    case 'info':
      return 'ℹ️';
    case 'success':
      return '✅';
  }
}
