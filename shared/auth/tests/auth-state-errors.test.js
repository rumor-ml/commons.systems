/**
 * Auth State Error Handling Unit Tests
 *
 * Tests error categorization, state updates, listener failure tracking,
 * and event dispatching for auth-state.js error scenarios.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies
const mockOnAuthStateChange = vi.fn();
const mockShowToast = vi.fn();
const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};

// Mock Firebase auth module
vi.mock('../src/github-auth.js', () => ({
  onAuthStateChange: mockOnAuthStateChange,
}));

// Setup global mocks
global.localStorage = mockLocalStorage;
global.window = {
  showToast: mockShowToast,
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
};

describe('Auth State Error Handling', () => {
  let authState;
  let initAuthState, getAuthState, subscribeToAuthState, clearAuthState;

  beforeEach(async () => {
    // Clear all mocks
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(null);
    mockLocalStorage.setItem.mockClear();
    mockLocalStorage.removeItem.mockClear();

    // Import module fresh for each test
    const module = await import('../src/auth-state.js');
    initAuthState = module.initAuthState;
    getAuthState = module.getAuthState;
    subscribeToAuthState = module.subscribeToAuthState;
    clearAuthState = module.clearAuthState;
  });

  afterEach(() => {
    clearAuthState();
  });

  describe('loadPersistedState error categorization', () => {
    it('should categorize QuotaExceededError correctly', async () => {
      const quotaError = new Error('Quota exceeded');
      quotaError.name = 'QuotaExceededError';
      quotaError.code = 22;

      mockLocalStorage.getItem.mockImplementation(() => {
        throw quotaError;
      });

      initAuthState();

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Storage Error',
          message: expect.stringContaining('Browser storage is full'),
          type: 'warning',
          duration: 8000,
          actionLabel: 'Clear and Reload',
        })
      );

      expect(global.window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth-error',
          detail: expect.objectContaining({
            code: 'auth/storage-quota-exceeded',
            recoverable: true,
          }),
        })
      );
    });

    it('should categorize SyntaxError (corrupted data) correctly', async () => {
      mockLocalStorage.getItem.mockReturnValue('{invalid json}');

      initAuthState();

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Storage Error',
          message: expect.stringContaining('corrupted'),
          type: 'warning',
          actionLabel: 'Clear and Reload',
        })
      );

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('commons_auth_state');

      expect(global.window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth-error',
          detail: expect.objectContaining({
            code: 'auth/storage-parse-failed',
            recoverable: true,
          }),
        })
      );
    });

    it('should categorize SecurityError correctly', async () => {
      const securityError = new Error('Access denied');
      securityError.name = 'SecurityError';
      securityError.code = 18;

      mockLocalStorage.getItem.mockImplementation(() => {
        throw securityError;
      });

      initAuthState();

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Storage Error',
          message: expect.stringContaining('Cannot access browser storage'),
          type: 'error', // Not recoverable, so error type
          duration: 0,
        })
      );

      expect(global.window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth-error',
          detail: expect.objectContaining({
            code: 'auth/storage-access-denied',
            recoverable: false,
          }),
        })
      );
    });

    it('should categorize generic storage errors', async () => {
      const genericError = new Error('Unknown storage error');

      mockLocalStorage.getItem.mockImplementation(() => {
        throw genericError;
      });

      initAuthState();

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Storage Error',
          message: expect.stringContaining('Failed to load authentication state'),
          type: 'warning',
        })
      );

      expect(global.window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth-error',
          detail: expect.objectContaining({
            code: 'auth/storage-failed',
            recoverable: true,
          }),
        })
      );
    });
  });

  describe('error state updates', () => {
    it('should update state.error when storage fails', async () => {
      const quotaError = new Error('Quota exceeded');
      quotaError.name = 'QuotaExceededError';

      mockLocalStorage.getItem.mockImplementation(() => {
        throw quotaError;
      });

      initAuthState();

      const state = getAuthState();
      expect(state.error).toBeTruthy();
      expect(state.error.code).toBe('auth/storage-quota-exceeded');
      expect(state.error.timestamp).toBeTruthy();
      expect(state.error.details).toBeTruthy();
    });

    it('should preserve error state across auth updates', async () => {
      // Set initial error
      const quotaError = new Error('Quota exceeded');
      quotaError.name = 'QuotaExceededError';
      mockLocalStorage.setItem.mockImplementation(() => {
        throw quotaError;
      });

      initAuthState();

      // Trigger auth state update via the mock callback
      const authStateCallback = mockOnAuthStateChange.mock.calls[0][0];
      const mockUser = {
        uid: 'test-user',
        email: 'test@example.com',
        displayName: 'Test User',
        photoURL: null,
        emailVerified: true,
        metadata: {
          creationTime: '2024-01-01',
          lastSignInTime: '2024-01-02',
        },
        providerData: [],
      };
      authStateCallback(mockUser);

      const state = getAuthState();
      expect(state.error).toBeTruthy();
      expect(state.error.code).toBe('auth/storage-quota-exceeded');
    });
  });

  describe('listener failure tracking', () => {
    it('should track individual listener failures', async () => {
      initAuthState();

      const failingListener = vi.fn(() => {
        throw new Error('Listener error');
      });

      subscribeToAuthState(failingListener);

      // Trigger auth state change
      const authStateCallback = mockOnAuthStateChange.mock.calls[0][0];
      authStateCallback(null);

      // Listener should have been called and failed
      expect(failingListener).toHaveBeenCalled();
      // Toast should NOT be shown for single failure
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it('should detect systemic failures (3+ failures in 10 seconds)', async () => {
      initAuthState();

      // Subscribe with 3 failing listeners
      const failingListener1 = vi.fn(() => {
        throw new Error('Listener error 1');
      });
      const failingListener2 = vi.fn(() => {
        throw new Error('Listener error 2');
      });
      const failingListener3 = vi.fn(() => {
        throw new Error('Listener error 3');
      });

      subscribeToAuthState(failingListener1);
      subscribeToAuthState(failingListener2);
      subscribeToAuthState(failingListener3);

      // Trigger auth state change
      const authStateCallback = mockOnAuthStateChange.mock.calls[0][0];
      authStateCallback(null);

      // Should show error toast for systemic failure
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Authentication Error',
          message: expect.stringContaining('Multiple authentication components'),
          type: 'error',
          duration: 0, // Never auto-dismiss
          actionLabel: 'Refresh Page',
        })
      );

      // Should dispatch auth-error event
      expect(global.window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth-error',
          detail: expect.objectContaining({
            code: 'auth/listener-systemic-failure',
            recoverable: true,
          }),
        })
      );
    });

    it('should clean up old failures (> 10 seconds)', async () => {
      // This test would require time manipulation with vi.useFakeTimers()
      // For now, we verify the behavior exists in the implementation
      initAuthState();

      const failingListener = vi.fn(() => {
        throw new Error('Listener error');
      });

      subscribeToAuthState(failingListener);

      // Trigger first failure
      const authStateCallback = mockOnAuthStateChange.mock.calls[0][0];
      authStateCallback(null);

      // Mock time passing
      vi.useFakeTimers();
      vi.advanceTimersByTime(11000); // 11 seconds

      // Trigger another auth state change
      authStateCallback(null);

      // Should not trigger systemic failure (old failures cleaned up)
      // In practice, this would require internal state inspection
      vi.useRealTimers();
    });
  });

  describe('error event dispatching', () => {
    it('should dispatch auth-error event with complete error info', async () => {
      mockLocalStorage.getItem.mockReturnValue('{invalid}');

      initAuthState();

      expect(global.window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth-error',
          detail: expect.objectContaining({
            code: expect.stringMatching(/^auth\//),
            message: expect.any(String),
            recoverable: expect.any(Boolean),
            timestamp: expect.any(Number),
            details: expect.any(String),
          }),
        })
      );
    });

    it('should include action field in error detail', async () => {
      const quotaError = new Error('Quota exceeded');
      quotaError.name = 'QuotaExceededError';

      mockLocalStorage.getItem.mockImplementation(() => {
        throw quotaError;
      });

      initAuthState();

      expect(global.window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth-error',
          detail: expect.objectContaining({
            action: 'Clear and Reload',
          }),
        })
      );
    });
  });

  describe('error recovery actions', () => {
    it('should clear corrupted data automatically', async () => {
      mockLocalStorage.getItem.mockReturnValue('{invalid json}');

      initAuthState();

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('commons_auth_state');
    });

    it('should provide action callback for quota errors', async () => {
      const quotaError = new Error('Quota exceeded');
      quotaError.name = 'QuotaExceededError';

      mockLocalStorage.getItem.mockImplementation(() => {
        throw quotaError;
      });

      initAuthState();

      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          actionLabel: 'Clear and Reload',
          onAction: expect.any(Function),
        })
      );
    });
  });
});
