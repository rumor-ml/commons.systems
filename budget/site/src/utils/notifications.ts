/**
 * Notification system for Budget module
 *
 * Wraps existing banner pattern from StateManager for consistent user notifications.
 * Provides programmatic API for showing/dismissing notifications with optional actions.
 */

import { logger } from './logger';

export type NotificationType = 'error' | 'warning' | 'info' | 'success';

export interface ActionConfig {
  label: string;
  onClick: () => void;
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

  // Create banner element
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
  if (action) {
    const actionBtn = document.createElement('button');
    actionBtn.className =
      'ml-2 px-3 py-1 bg-white text-bg-base rounded hover:bg-gray-200 text-sm font-medium';
    actionBtn.textContent = action.label;
    actionBtn.onclick = () => {
      action.onClick();
      dismiss();
    };
    container.appendChild(actionBtn);
  }

  container.appendChild(closeBtn);
  banner.appendChild(container);
  document.body.appendChild(banner);

  // Auto-dismiss if enabled
  if (autoDismiss) {
    setTimeout(dismiss, 10000);
  }

  function dismiss() {
    banner.remove();
  }

  return dismiss;
}

/**
 * Show error notification with optional action button
 *
 * Error notifications do not auto-dismiss by default.
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
