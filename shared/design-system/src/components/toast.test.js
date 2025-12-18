import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showToast, dismissToast } from './toast.js';

describe('Toast System', () => {
  beforeEach(() => {
    // Clean up DOM before each test
    const container = document.querySelector('.toast-container');
    if (container) {
      container.remove();
    }
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Clean up after tests
    const container = document.querySelector('.toast-container');
    if (container) {
      container.remove();
    }
    vi.useRealTimers();
  });

  describe('showToast', () => {
    it('should display a toast with correct content', () => {
      const title = 'Test Title';
      const message = 'Test message';

      showToast({ title, message, type: 'info' });

      const toast = document.querySelector('.toast');
      expect(toast).toBeTruthy();
      expect(toast.querySelector('.toast__title')).toHaveTextContent(title);
      expect(toast.querySelector('.toast__body')).toHaveTextContent(message);
    });

    it('should display toast with correct type class', () => {
      const types = ['error', 'warning', 'success', 'info'];

      types.forEach((type, index) => {
        const toastId = showToast({
          title: `${type} toast`,
          message: `This is a ${type} message`,
          type,
        });

        const toast = document.getElementById(toastId);
        expect(toast).toHaveClass(`toast--${type}`);
      });
    });

    it('should create toast container if it does not exist', () => {
      let container = document.querySelector('.toast-container');
      expect(container).toBeFalsy();

      showToast({ title: 'Test', message: 'Message', type: 'info' });

      container = document.querySelector('.toast-container');
      expect(container).toBeTruthy();
      expect(container).toHaveClass('toast-container');
    });

    it('should reuse existing toast container', () => {
      showToast({ title: 'Toast 1', message: 'Message 1', type: 'info' });
      const firstContainer = document.querySelector('.toast-container');

      showToast({ title: 'Toast 2', message: 'Message 2', type: 'info' });
      const secondContainer = document.querySelector('.toast-container');

      expect(firstContainer).toBe(secondContainer);
      expect(firstContainer.children.length).toBe(2);
    });

    it('should set up accessibility attributes', () => {
      showToast({ title: 'Test', message: 'Message', type: 'error' });

      const toast = document.querySelector('.toast');
      expect(toast).toHaveAttribute('role', 'alert');
      expect(toast).toHaveAttribute('aria-live', 'assertive');
    });

    it('should set polite aria-live for non-error toasts', () => {
      showToast({ title: 'Test', message: 'Message', type: 'info' });

      const toast = document.querySelector('.toast');
      expect(toast).toHaveAttribute('aria-live', 'polite');
    });

    it('should return a unique toast ID', () => {
      const id1 = showToast({ title: 'Toast 1', message: 'Message 1', type: 'info' });
      const id2 = showToast({ title: 'Toast 2', message: 'Message 2', type: 'info' });

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^toast-\d+$/);
      expect(id2).toMatch(/^toast-\d+$/);
    });

    it('should auto-dismiss toast after specified duration', () => {
      const duration = 2000;
      const toastId = showToast({
        title: 'Test',
        message: 'Message',
        type: 'info',
        duration,
      });

      const toast = document.getElementById(toastId);
      expect(toast).toBeTruthy();

      vi.advanceTimersByTime(duration - 1);
      expect(document.getElementById(toastId)).toBeTruthy();

      vi.advanceTimersByTime(1);
      expect(document.getElementById(toastId)).toBeFalsy();
    });

    it('should not auto-dismiss when duration is 0', () => {
      const toastId = showToast({
        title: 'Test',
        message: 'Message',
        type: 'info',
        duration: 0,
      });

      vi.advanceTimersByTime(10000);
      const toast = document.getElementById(toastId);
      expect(toast).toBeTruthy();
    });

    it('should display action button when actionLabel and onAction are provided', () => {
      const onAction = vi.fn();
      showToast({
        title: 'Test',
        message: 'Message',
        type: 'info',
        actionLabel: 'Click Me',
        onAction,
      });

      const actionBtn = document.querySelector('.toast__action button');
      expect(actionBtn).toBeTruthy();
      expect(actionBtn).toHaveTextContent('Click Me');
    });

    it('should not display action section when only actionLabel is provided', () => {
      showToast({
        title: 'Test',
        message: 'Message',
        type: 'info',
        actionLabel: 'Click Me',
      });

      const actionSection = document.querySelector('.toast__action');
      expect(actionSection).toBeFalsy();
    });

    it('should not display action section when only onAction is provided', () => {
      const onAction = vi.fn();
      showToast({
        title: 'Test',
        message: 'Message',
        type: 'info',
        onAction,
      });

      const actionSection = document.querySelector('.toast__action');
      expect(actionSection).toBeFalsy();
    });

    it('should have a close button', () => {
      showToast({ title: 'Test', message: 'Message', type: 'info' });

      const closeBtn = document.querySelector('.toast__close');
      expect(closeBtn).toBeTruthy();
      expect(closeBtn).toHaveAttribute('aria-label', 'Close notification');
    });
  });

  describe('dismissToast', () => {
    it('should remove toast from DOM', () => {
      const toastId = showToast({ title: 'Test', message: 'Message', type: 'info' });

      let toast = document.getElementById(toastId);
      expect(toast).toBeTruthy();

      dismissToast(toastId);
      vi.advanceTimersByTime(200); // Wait for animation

      toast = document.getElementById(toastId);
      expect(toast).toBeFalsy();
    });

    it('should add dismissing class for animation', () => {
      const toastId = showToast({ title: 'Test', message: 'Message', type: 'info' });
      const toast = document.getElementById(toastId);

      dismissToast(toastId);
      expect(toast).toHaveClass('toast--dismissing');
    });

    it('should remove empty container after last toast is dismissed', () => {
      const toastId = showToast({ title: 'Test', message: 'Message', type: 'info' });

      let container = document.querySelector('.toast-container');
      expect(container).toBeTruthy();

      dismissToast(toastId);
      vi.advanceTimersByTime(200);

      container = document.querySelector('.toast-container');
      expect(container).toBeFalsy();
    });

    it('should keep container when other toasts exist', () => {
      const id1 = showToast({ title: 'Toast 1', message: 'Message 1', type: 'info' });
      showToast({ title: 'Toast 2', message: 'Message 2', type: 'info' });

      dismissToast(id1);
      vi.advanceTimersByTime(200);

      const container = document.querySelector('.toast-container');
      expect(container).toBeTruthy();
      expect(container.children.length).toBe(1);
    });

    it('should handle dismissing non-existent toast gracefully', () => {
      expect(() => {
        dismissToast('non-existent-id');
      }).not.toThrow();
    });
  });

  describe('Close Button', () => {
    it('should close toast when close button is clicked', () => {
      const toastId = showToast({ title: 'Test', message: 'Message', type: 'info' });
      const closeBtn = document.querySelector('.toast__close');

      expect(document.getElementById(toastId)).toBeTruthy();

      closeBtn.click();
      vi.advanceTimersByTime(200);

      expect(document.getElementById(toastId)).toBeFalsy();
    });
  });

  describe('Action Button', () => {
    it('should execute callback when action button is clicked', () => {
      const onAction = vi.fn();
      showToast({
        title: 'Test',
        message: 'Message',
        type: 'info',
        actionLabel: 'Do Something',
        onAction,
      });

      const actionBtn = document.querySelector('.toast__action button');
      actionBtn.click();

      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('should dismiss toast after action button click', () => {
      const onAction = vi.fn();
      const toastId = showToast({
        title: 'Test',
        message: 'Message',
        type: 'info',
        actionLabel: 'Do Something',
        onAction,
      });

      const actionBtn = document.querySelector('.toast__action button');
      actionBtn.click();
      vi.advanceTimersByTime(200);

      expect(document.getElementById(toastId)).toBeFalsy();
    });
  });

  describe('Multiple Toasts', () => {
    it('should stack multiple toasts correctly', () => {
      const ids = [];
      for (let i = 0; i < 5; i++) {
        ids.push(
          showToast({
            title: `Toast ${i + 1}`,
            message: `Message ${i + 1}`,
            type: 'info',
          })
        );
      }

      const container = document.querySelector('.toast-container');
      expect(container.children.length).toBe(5);

      ids.forEach((id) => {
        expect(document.getElementById(id)).toBeTruthy();
      });
    });

    it('should properly handle dismissing toasts in any order', () => {
      const ids = [
        showToast({ title: 'Toast 1', message: 'Message 1', type: 'info' }),
        showToast({ title: 'Toast 2', message: 'Message 2', type: 'info' }),
        showToast({ title: 'Toast 3', message: 'Message 3', type: 'info' }),
      ];

      // Dismiss middle toast
      dismissToast(ids[1]);
      vi.advanceTimersByTime(200);

      let container = document.querySelector('.toast-container');
      expect(container.children.length).toBe(2);
      expect(document.getElementById(ids[0])).toBeTruthy();
      expect(document.getElementById(ids[1])).toBeFalsy();
      expect(document.getElementById(ids[2])).toBeTruthy();

      // Dismiss first toast
      dismissToast(ids[0]);
      vi.advanceTimersByTime(200);

      container = document.querySelector('.toast-container');
      expect(container.children.length).toBe(1);
      expect(document.getElementById(ids[0])).toBeFalsy();
      expect(document.getElementById(ids[2])).toBeTruthy();

      // Dismiss last toast
      dismissToast(ids[2]);
      vi.advanceTimersByTime(200);

      container = document.querySelector('.toast-container');
      expect(container).toBeFalsy();
    });
  });

  describe('Severity Levels', () => {
    it('should render with correct CSS classes for each severity', () => {
      const severities = ['error', 'warning', 'success', 'info'];

      severities.forEach((severity) => {
        const toastId = showToast({
          title: `${severity} title`,
          message: 'Message',
          type: severity,
        });

        const toast = document.getElementById(toastId);
        expect(toast).toHaveClass(`toast--${severity}`);

        const titleEl = toast.querySelector('.toast__title');
        expect(titleEl).toHaveClass(`toast__title--${severity}`);

        dismissToast(toastId);
        vi.advanceTimersByTime(200);
      });
    });
  });

  describe('Global Functions', () => {
    it('should expose showToast globally', () => {
      expect(window.showToast).toBeDefined();
      expect(typeof window.showToast).toBe('function');
    });

    it('should expose dismissToast globally', () => {
      expect(window.dismissToast).toBeDefined();
      expect(typeof window.dismissToast).toBe('function');
    });
  });
});
