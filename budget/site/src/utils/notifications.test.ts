/**
 * Tests for Budget notification system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showNotification, showError, showWarning, showInfo, showSuccess } from './notifications';

describe('notifications', () => {
  beforeEach(() => {
    // Clear any existing banners
    document.body.innerHTML = '';

    // Mock setTimeout for auto-dismiss tests
    vi.useFakeTimers();
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
});
