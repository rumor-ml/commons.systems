import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logError } from './logger';
import { errorIds } from '../constants/errorIds';

describe('logError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should log error with error ID', () => {
    const error = new Error('Test error');
    logError('Test message', {
      errorId: errorIds.AUTH_SIGNIN_FAILED,
      error,
    });

    expect(console.error).toHaveBeenCalledWith(
      '[AUTH_SIGNIN_FAILED] Test message',
      expect.objectContaining({
        errorId: 'AUTH_SIGNIN_FAILED',
        message: 'Test message',
        error: expect.objectContaining({
          name: 'Error',
          message: 'Test error',
        }),
      })
    );
  });

  it('should include optional context', () => {
    const error = new Error('Test error');
    const context = { userId: '123', action: 'signin' };

    logError('Test message', {
      errorId: errorIds.AUTH_SIGNIN_FAILED,
      error,
      context,
    });

    expect(console.error).toHaveBeenCalledWith(
      '[AUTH_SIGNIN_FAILED] Test message',
      expect.objectContaining({
        context,
      })
    );
  });

  it('should include timestamp', () => {
    const error = new Error('Test error');
    logError('Test message', {
      errorId: errorIds.AUTH_SIGNIN_FAILED,
      error,
    });

    expect(console.error).toHaveBeenCalledWith(
      '[AUTH_SIGNIN_FAILED] Test message',
      expect.objectContaining({
        timestamp: expect.any(String),
      })
    );
  });
});
