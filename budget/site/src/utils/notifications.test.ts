/**
 * Tests for Budget notification system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  showNotification,
  showError,
  showWarning,
  showInfo,
  showSuccess,
  createAction,
} from './notifications';
import { logger } from './logger';

// Mock logger module
vi.mock('./logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

describe('notifications', () => {
  beforeEach(() => {
    // Clear any existing banners
    document.body.innerHTML = '';

    // Mock setTimeout for auto-dismiss tests
    vi.useFakeTimers();

    // Clear logger mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up timers
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('showNotification', () => {
    it('should create banner element in document body', () => {
      showNotification({ message: 'Test notification', type: 'info' });

      const banner = document.querySelector('.fixed');
      expect(banner).not.toBeNull();
      expect(banner?.textContent).toContain('Test notification');
    });

    it('should apply correct styling for error type', () => {
      showNotification({ message: 'Error', type: 'error' });

      const banner = document.querySelector('.bg-error');
      expect(banner).not.toBeNull();
    });

    it('should apply correct styling for warning type', () => {
      showNotification({ message: 'Warning', type: 'warning' });

      const banner = document.querySelector('.bg-warning');
      expect(banner).not.toBeNull();
    });

    it('should apply correct styling for info type', () => {
      showNotification({ message: 'Info', type: 'info' });

      const banner = document.querySelector('.bg-bg-surface');
      expect(banner).not.toBeNull();
    });

    it('should apply correct styling for success type', () => {
      showNotification({ message: 'Success', type: 'success' });

      const banner = document.querySelector('.bg-success');
      expect(banner).not.toBeNull();
    });

    it('should include correct icon for each type', () => {
      showNotification({ message: 'Error', type: 'error' });
      expect(document.body.textContent).toContain('❌');

      document.body.innerHTML = '';
      showNotification({ message: 'Warning', type: 'warning' });
      expect(document.body.textContent).toContain('⚠️');

      document.body.innerHTML = '';
      showNotification({ message: 'Info', type: 'info' });
      expect(document.body.textContent).toContain('ℹ️');

      document.body.innerHTML = '';
      showNotification({ message: 'Success', type: 'success' });
      expect(document.body.textContent).toContain('✅');
    });

    it('should include close button', () => {
      showNotification({ message: 'Test', type: 'info' });

      const closeBtn = document.querySelector('button');
      expect(closeBtn?.textContent).toBe('✕');
    });

    it('should dismiss banner when close button clicked', () => {
      showNotification({ message: 'Test', type: 'info' });

      const closeBtn = document.querySelector('button') as HTMLButtonElement;
      closeBtn.click();

      expect(document.querySelector('.fixed')).toBeNull();
    });

    it('should return dismiss function', () => {
      const dismiss = showNotification({ message: 'Test', type: 'info' });

      expect(typeof dismiss).toBe('function');

      dismiss();
      expect(document.querySelector('.fixed')).toBeNull();
    });

    it('should auto-dismiss by default for info notifications', () => {
      showNotification({ message: 'Test', type: 'info' });

      expect(document.querySelector('.fixed')).not.toBeNull();

      vi.advanceTimersByTime(10000);

      expect(document.querySelector('.fixed')).toBeNull();
    });

    it('should not auto-dismiss error notifications by default', () => {
      showNotification({ message: 'Error', type: 'error' });

      vi.advanceTimersByTime(10000);

      expect(document.querySelector('.fixed')).not.toBeNull();
    });

    it('should respect explicit autoDismiss override', () => {
      showNotification({ message: 'Error', type: 'error', autoDismiss: true });

      vi.advanceTimersByTime(10000);

      expect(document.querySelector('.fixed')).toBeNull();
    });

    it('should include action button when provided', () => {
      const onClick = vi.fn();
      showNotification({
        message: 'Test',
        type: 'info',
        action: { label: 'Retry', onClick },
      });

      const actionBtn = Array.from(document.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Retry'
      );

      expect(actionBtn).not.toBeNull();
    });

    it('should call action onClick and dismiss when action button clicked', () => {
      const onClick = vi.fn();
      showNotification({
        message: 'Test',
        type: 'info',
        action: { label: 'Retry', onClick },
      });

      const actionBtn = Array.from(document.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Retry'
      ) as HTMLButtonElement;

      actionBtn.click();

      expect(onClick).toHaveBeenCalled();
      expect(document.querySelector('.fixed')).toBeNull();
    });

    it('should handle errors in action callback and still dismiss', async () => {
      const onClick = vi.fn(() => {
        throw new Error('Action failed');
      });

      showNotification({
        message: 'Test',
        type: 'info',
        action: { label: 'Retry', onClick },
      });

      const actionBtn = Array.from(document.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Retry'
      ) as HTMLButtonElement;

      actionBtn.click();
      // Wait for async handler to complete
      await vi.waitFor(() => {
        expect(onClick).toHaveBeenCalled();
      });

      // Original notification should be dismissed, but error notification will be created
      // So we need to check that the original is gone
      const banners = document.querySelectorAll('.fixed');
      // Should have 1 banner (the error notification about the failed action)
      expect(banners.length).toBe(1);
      expect(banners[0]?.textContent).toContain('Failed to retry');
    });
  });

  describe('showError', () => {
    it('should create error notification', () => {
      showError('Error message');

      const banner = document.querySelector('.bg-error');
      expect(banner).not.toBeNull();
      expect(banner?.textContent).toContain('Error message');
    });

    it('should not auto-dismiss by default', () => {
      showError('Error message');

      vi.advanceTimersByTime(10000);

      expect(document.querySelector('.fixed')).not.toBeNull();
    });

    it('should include action button when provided', () => {
      const onClick = vi.fn();
      showError('Error message', { label: 'Retry', onClick });

      const actionBtn = Array.from(document.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Retry'
      );

      expect(actionBtn).not.toBeNull();
    });
  });

  describe('showWarning', () => {
    it('should create warning notification', () => {
      showWarning('Warning message');

      const banner = document.querySelector('.bg-warning');
      expect(banner).not.toBeNull();
      expect(banner?.textContent).toContain('Warning message');
    });

    it('should auto-dismiss after 10 seconds', () => {
      showWarning('Warning message');

      vi.advanceTimersByTime(10000);

      expect(document.querySelector('.fixed')).toBeNull();
    });
  });

  describe('showInfo', () => {
    it('should create info notification', () => {
      showInfo('Info message');

      const banner = document.querySelector('.bg-bg-surface');
      expect(banner).not.toBeNull();
      expect(banner?.textContent).toContain('Info message');
    });

    it('should auto-dismiss after 10 seconds', () => {
      showInfo('Info message');

      vi.advanceTimersByTime(10000);

      expect(document.querySelector('.fixed')).toBeNull();
    });
  });

  describe('showSuccess', () => {
    it('should create success notification', () => {
      showSuccess('Success message');

      const banner = document.querySelector('.bg-success');
      expect(banner).not.toBeNull();
      expect(banner?.textContent).toContain('Success message');
    });

    it('should auto-dismiss after 10 seconds', () => {
      showSuccess('Success message');

      vi.advanceTimersByTime(10000);

      expect(document.querySelector('.fixed')).toBeNull();
    });

    it('should clear auto-dismiss timer when manually dismissed', () => {
      const dismiss = showSuccess('Success message');

      expect(document.querySelector('.fixed')).not.toBeNull();

      dismiss();

      expect(document.querySelector('.fixed')).toBeNull();

      vi.advanceTimersByTime(10000);

      expect(document.querySelector('.fixed')).toBeNull();
    });

    it('should clear auto-dismiss timer when close button clicked', () => {
      showSuccess('Success message');

      const closeBtn = document.querySelector('button') as HTMLButtonElement;
      closeBtn.click();

      expect(document.querySelector('.fixed')).toBeNull();

      vi.advanceTimersByTime(10000);

      expect(document.querySelector('.fixed')).toBeNull();
    });
  });

  describe('multiple notifications', () => {
    it('should support multiple notifications simultaneously', () => {
      showError('Error 1');
      showWarning('Warning 1');
      showInfo('Info 1');

      const banners = document.querySelectorAll('.fixed');
      expect(banners.length).toBe(3);
    });

    it('should dismiss only the clicked notification', () => {
      showError('Error 1');
      showError('Error 2');

      const closeBtns = document.querySelectorAll('button');
      (closeBtns[0] as HTMLButtonElement).click();

      const banners = document.querySelectorAll('.fixed');
      expect(banners.length).toBe(1);
    });

    it('should handle many stacked notifications without breaking UI', () => {
      const dismissFns = Array.from({ length: 10 }, (_, i) => showError(`Error ${i + 1}`));

      const banners = document.querySelectorAll('.fixed');
      expect(banners.length).toBe(10);

      const closeBtns = document.querySelectorAll('button');
      const closeButtonsForNotifications = Array.from(closeBtns).filter(
        (btn) => btn.textContent === '✕'
      );
      expect(closeButtonsForNotifications.length).toBe(10);

      // Dismiss using close button
      (closeButtonsForNotifications[0] as HTMLButtonElement).click();
      expect(document.querySelectorAll('.fixed').length).toBe(9);

      // Dismiss another using close button
      (closeButtonsForNotifications[5] as HTMLButtonElement).click();
      expect(document.querySelectorAll('.fixed').length).toBe(8);

      // Dismiss all remaining using dismiss functions
      // We already dismissed index 0 and 5, so dismiss the rest
      dismissFns.forEach((dismiss, index) => {
        if (index !== 0 && index !== 5) {
          dismiss();
        }
      });
      expect(document.querySelectorAll('.fixed').length).toBe(0);
    });
  });

  describe('security', () => {
    it('should escape HTML in notification messages to prevent XSS', () => {
      const xssPayload = '<img src=x onerror=alert("XSS")><script>alert("XSS")</script>';
      showError(xssPayload);

      const banner = document.querySelector('.fixed');
      const messageElement = banner?.querySelector('p');

      // textContent should contain the raw payload (as text, not HTML)
      expect(messageElement?.textContent).toBe(xssPayload);

      // Verify no script elements were created
      expect(banner?.querySelectorAll('script').length).toBe(0);
      expect(banner?.querySelectorAll('img[onerror]').length).toBe(0);

      // The message should be in a p element, not rendered as HTML
      const pElements = banner?.querySelectorAll('p');
      expect(pElements?.length).toBe(1);
    });
  });

  describe('action button edge cases', () => {
    it('should not create action button when label is empty string', () => {
      const onClick = vi.fn();
      showNotification({
        message: 'Test',
        type: 'info',
        action: { label: '', onClick },
      });

      const buttons = document.querySelectorAll('button');
      // Should only have close button (✕), not action button
      expect(buttons.length).toBe(1);
      expect(buttons[0]?.textContent).toBe('✕');
    });

    it('should not create action button when label is whitespace only', () => {
      const onClick = vi.fn();
      showNotification({
        message: 'Test',
        type: 'info',
        action: { label: '   ', onClick },
      });

      const buttons = document.querySelectorAll('button');
      expect(buttons.length).toBe(1);
      expect(buttons[0]?.textContent).toBe('✕');
    });

    it('should create action button when label has content after trim', () => {
      const onClick = vi.fn();
      showNotification({
        message: 'Test',
        type: 'info',
        action: { label: '  Retry  ', onClick },
      });

      const buttons = Array.from(document.querySelectorAll('button'));
      const actionBtn = buttons.find((btn) => btn.textContent === '  Retry  ');
      expect(actionBtn).toBeDefined();
    });
  });

  describe('document.body availability', () => {
    let originalBody: HTMLElement;

    beforeEach(() => {
      // Save original body before each test in this suite
      originalBody = document.body;
    });

    afterEach(() => {
      // Always restore document.body after each test
      Object.defineProperty(document, 'body', {
        configurable: true,
        get: () => originalBody,
      });
    });

    it('should return no-op dismiss function when document.body is unavailable', () => {
      Object.defineProperty(document, 'body', {
        configurable: true,
        get: () => null,
      });

      const dismiss = showNotification({ message: 'Test', type: 'info' });

      // Should return a function, not throw
      expect(typeof dismiss).toBe('function');

      // Should log error
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Cannot show notification'),
        expect.objectContaining({ message: 'Test', type: 'info' })
      );

      // Calling dismiss should not throw
      expect(() => dismiss()).not.toThrow();
    });

    it('should fallback to console.error for error notifications when body unavailable', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      Object.defineProperty(document, 'body', {
        configurable: true,
        get: () => null,
      });

      const dismiss = showNotification({ message: 'Critical error', type: 'error' });

      // Should return no-op dismiss function instead of throwing
      expect(typeof dismiss).toBe('function');

      // Should fallback to console.error for critical errors
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Critical error'));

      consoleErrorSpy.mockRestore();
    });

    it('should not fallback to console for non-error types when body unavailable', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      Object.defineProperty(document, 'body', {
        configurable: true,
        get: () => null,
      });

      const dismiss = showNotification({ message: 'Info message', type: 'info' });

      // Should return no-op dismiss function instead of throwing
      expect(typeof dismiss).toBe('function');

      // console.error should only be called by logger, not as fallback
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Info message'));

      consoleErrorSpy.mockRestore();
    });
  });

  describe('createAction', () => {
    it('should create action with trimmed label', () => {
      const onClick = vi.fn();
      const action = createAction('  Retry  ', onClick);

      expect(action.label).toBe('Retry');
      expect(action.onClick).toBe(onClick);
    });

    it('should throw error when label is empty string', () => {
      const onClick = vi.fn();

      expect(() => {
        createAction('', onClick);
      }).toThrow('Action label cannot be empty');
    });

    it('should throw error when label is whitespace only', () => {
      const onClick = vi.fn();

      expect(() => {
        createAction('   ', onClick);
      }).toThrow('Action label cannot be empty');
    });

    it('should accept sync onClick handler', () => {
      const onClick = vi.fn();
      const action = createAction('Test', onClick);

      expect(typeof action.onClick).toBe('function');
      action.onClick();
      expect(onClick).toHaveBeenCalled();
    });

    it('should accept async onClick handler', async () => {
      const onClick = vi.fn(async () => {
        return Promise.resolve();
      });
      const action = createAction('Test', onClick);

      const result = action.onClick();
      expect(result instanceof Promise).toBe(true);
      await result;
      expect(onClick).toHaveBeenCalled();
    });
  });

  describe('dismiss function idempotency', () => {
    it('should handle dismiss called after auto-dismiss completes', () => {
      const dismiss = showSuccess('Test message');

      expect(document.querySelector('.fixed')).not.toBeNull();

      // Wait for auto-dismiss
      vi.advanceTimersByTime(10000);
      expect(document.querySelector('.fixed')).toBeNull();

      // Calling dismiss again should not throw
      expect(() => dismiss()).not.toThrow();
      expect(() => dismiss()).not.toThrow(); // Third call also safe
    });

    it('should handle multiple dismiss calls before auto-dismiss', () => {
      const dismiss = showSuccess('Test message');

      expect(document.querySelector('.fixed')).not.toBeNull();

      dismiss();
      expect(document.querySelector('.fixed')).toBeNull();

      // Second call should not throw
      expect(() => dismiss()).not.toThrow();

      // Ensure timer was cleared (advancing time shouldn't cause issues)
      vi.advanceTimersByTime(10000);
      expect(document.querySelector('.fixed')).toBeNull();
    });

    it('should not throw when banner already removed from DOM', () => {
      const dismiss = showInfo('Test');
      const banner = document.querySelector('.fixed') as HTMLElement;

      // Manually remove banner from DOM
      banner.remove();

      // dismiss() should not throw even if banner already removed
      // The check for banner.parentNode prevents unnecessary remove() calls
      expect(() => dismiss()).not.toThrow();

      // Verify banner was indeed removed
      expect(document.querySelector('.fixed')).toBeNull();
    });
  });

  describe('async action error handling edge cases', () => {
    let originalBody: HTMLElement;

    beforeEach(() => {
      originalBody = document.body;
    });

    afterEach(() => {
      Object.defineProperty(document, 'body', {
        configurable: true,
        get: () => originalBody,
      });
    });

    it('should fallback to console.error when showError fails in async action error handler', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const failingAction = vi.fn().mockRejectedValue(new Error('Action failed'));

      // Create notification with body available
      showNotification({
        message: 'Test',
        type: 'info',
        action: { label: 'Do Thing', onClick: failingAction },
      });

      const actionBtn = Array.from(document.querySelectorAll('button')).find(
        (btn) => btn.textContent === 'Do Thing'
      );

      expect(actionBtn).not.toBeNull();

      // Make body unavailable before clicking action to cause showError to fail
      Object.defineProperty(document, 'body', {
        configurable: true,
        get: () => null,
      });

      actionBtn?.click();

      // Wait for async handler to complete
      await vi.waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to do thing'));
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('banner removal fallback', () => {
    it('should use removeChild fallback when remove() fails', () => {
      const dismiss = showNotification({ message: 'Test', type: 'info' });
      const banner = document.querySelector('.fixed') as HTMLElement;

      // Mock remove() to fail
      banner.remove = vi.fn().mockImplementation(() => {
        throw new Error('remove() not supported');
      });

      dismiss();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to remove notification banner'),
        expect.any(Object)
      );
      expect(document.querySelector('.fixed')).toBeNull(); // Banner removed via fallback
    });
  });
});
