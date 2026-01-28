/**
 * Tests for Budget logger utility
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger, LogLevel } from './logger';

describe('Logger', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let originalGetItem: typeof localStorage.getItem;

  beforeEach(() => {
    // Spy on console methods
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Store original localStorage.getItem
    originalGetItem = localStorage.getItem;
  });

  afterEach(() => {
    // Restore spies
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleLogSpy.mockRestore();

    // Restore localStorage
    localStorage.getItem = originalGetItem;
    localStorage.removeItem('BUDGET_LOG_LEVEL');
  });

  describe('log level filtering', () => {
    it('should default to WARN level', () => {
      localStorage.removeItem('BUDGET_LOG_LEVEL');
      const logger = new Logger();

      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should respect ERROR level from localStorage', () => {
      localStorage.setItem('BUDGET_LOG_LEVEL', 'ERROR');
      const logger = new Logger();

      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should respect INFO level from localStorage', () => {
      localStorage.setItem('BUDGET_LOG_LEVEL', 'INFO');
      const logger = new Logger();

      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should respect DEBUG level from localStorage', () => {
      localStorage.setItem('BUDGET_LOG_LEVEL', 'DEBUG');
      const logger = new Logger();

      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle case-insensitive log level', () => {
      localStorage.setItem('BUDGET_LOG_LEVEL', 'debug');
      const logger = new Logger();

      logger.debug('debug message');
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should default to WARN for invalid log level', () => {
      localStorage.setItem('BUDGET_LOG_LEVEL', 'INVALID');
      const logger = new Logger();

      logger.warn('warn message');
      logger.info('info message');

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleInfoSpy).not.toHaveBeenCalled();
    });

    it('should handle localStorage access errors gracefully', () => {
      const getItemSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError: localStorage is not available');
      });

      // Should not throw during construction
      expect(() => new Logger()).not.toThrow();

      const logger = new Logger();

      // Should default to WARN level when localStorage fails
      logger.error('error');
      logger.warn('warn');
      logger.info('info');

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      // Note: console.warn is called 2 times - once from the first Logger() construction
      // (line 124, deduplicated for line 126) and once by the logger.warn() call (line 130)
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
      expect(consoleInfoSpy).not.toHaveBeenCalled();

      getItemSpy.mockRestore();
    });
  });

  describe('log message formatting', () => {
    it('should include timestamp and level in log messages', () => {
      const logger = new Logger();
      logger.error('test error');

      const errorCall = consoleErrorSpy.mock.calls[0][0] as string;
      expect(errorCall).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
      expect(errorCall).toContain('[ERROR]');
      expect(errorCall).toContain('test error');
    });

    it('should log data object as second argument', () => {
      const logger = new Logger();
      const data = { userId: 123, action: 'test' };

      logger.error('error with data', data);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String), data);
    });

    it('should auto-capture stack trace for errors without data', () => {
      const logger = new Logger();
      logger.error('error without data');

      const errorCall = consoleErrorSpy.mock.calls[0];
      expect(errorCall[0]).toContain('[ERROR]');
      expect(errorCall[1]).toContain('Error');
    });

    it('should log Error instances with stack trace', () => {
      const logger = new Logger();
      const error = new Error('Test error');

      logger.error('error with Error', error);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String), error);
    });
  });

  describe('log methods', () => {
    it('should log error messages', () => {
      const logger = new Logger();
      logger.error('error message');

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls[0][0] as string;
      expect(errorCall).toContain('[ERROR]');
      expect(errorCall).toContain('error message');
    });

    it('should log warn messages', () => {
      const logger = new Logger();
      logger.warn('warn message');

      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnCall = consoleWarnSpy.mock.calls[0][0] as string;
      expect(warnCall).toContain('[WARN]');
      expect(warnCall).toContain('warn message');
    });

    it('should log info messages when level permits', () => {
      localStorage.setItem('BUDGET_LOG_LEVEL', 'INFO');
      const logger = new Logger();
      logger.info('info message');

      expect(consoleInfoSpy).toHaveBeenCalled();
      const infoCall = consoleInfoSpy.mock.calls[0][0] as string;
      expect(infoCall).toContain('[INFO]');
      expect(infoCall).toContain('info message');
    });

    it('should log debug messages when level permits', () => {
      localStorage.setItem('BUDGET_LOG_LEVEL', 'DEBUG');
      const logger = new Logger();
      logger.debug('debug message');

      expect(consoleLogSpy).toHaveBeenCalled();
      const debugCall = consoleLogSpy.mock.calls[0][0] as string;
      expect(debugCall).toContain('[DEBUG]');
      expect(debugCall).toContain('debug message');
    });
  });

  describe('edge cases', () => {
    it('should handle undefined data', () => {
      const logger = new Logger();
      logger.error('error with undefined', undefined);

      // When data is explicitly undefined, logger auto-captures stack trace as the data argument
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]'),
        expect.stringContaining('Error')
      );
    });

    it('should handle null data', () => {
      const logger = new Logger();
      logger.warn('warn with null', null);

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.any(String), null);
    });

    it('should handle empty string message', () => {
      const logger = new Logger();
      logger.error('');

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle very long messages', () => {
      const logger = new Logger();
      const longMessage = 'a'.repeat(10000);

      logger.error(longMessage);

      const errorCall = consoleErrorSpy.mock.calls[0][0] as string;
      expect(errorCall).toContain(longMessage);
    });

    // TODO(#1542): Consider testing Logger with very large data objects
  });

  describe('setLevel()', () => {
    it('should persist log level to localStorage', () => {
      const setItemSpy = vi.spyOn(localStorage, 'setItem');
      const logger = new Logger();

      logger.setLevel(LogLevel.DEBUG);

      expect(setItemSpy).toHaveBeenCalledWith('BUDGET_LOG_LEVEL', 'DEBUG');
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);

      setItemSpy.mockRestore();
    });

    it('should handle localStorage write errors gracefully', () => {
      const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const logger = new Logger();
      logger.setLevel(LogLevel.DEBUG);

      // Should not throw
      expect(logger.getLevel()).toBe(LogLevel.DEBUG); // Level set in memory
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist log level'),
        expect.stringContaining('QuotaExceededError')
      );

      setItemSpy.mockRestore();
    });

    it('should reject invalid log level values', () => {
      const logger = new Logger();
      const originalLevel = logger.getLevel();

      logger.setLevel(-1 as LogLevel);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Invalid log level -1, keeping current level WARN'
      );
      expect(logger.getLevel()).toBe(originalLevel); // Level unchanged
    });

    it('should reject non-numeric log level values', () => {
      const logger = new Logger();
      const originalLevel = logger.getLevel();

      logger.setLevel('DEBUG' as any);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Invalid log level DEBUG, keeping current level WARN'
      );
      expect(logger.getLevel()).toBe(originalLevel);
    });

    it('should reject out-of-range log level values', () => {
      const logger = new Logger();
      const originalLevel = logger.getLevel();

      logger.setLevel(999 as LogLevel);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Invalid log level 999, keeping current level WARN'
      );
      expect(logger.getLevel()).toBe(originalLevel);
    });

    it('should not call localStorage.setItem when localStorage is unavailable', () => {
      // Simulate localStorage unavailable during construction
      const getItemSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      const setItemSpy = vi.spyOn(localStorage, 'setItem');

      const logger = new Logger();
      logger.setLevel(LogLevel.DEBUG);

      // Should not attempt to persist when localStorage is unavailable
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(logger.getLevel()).toBe(LogLevel.DEBUG); // Level still set in memory

      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    });
  });

  describe('syncFromStorage()', () => {
    it('should sync level from localStorage when available', () => {
      const logger = new Logger();
      expect(logger.getLevel()).toBe(LogLevel.WARN); // Default

      // Simulate external change to localStorage
      localStorage.setItem('BUDGET_LOG_LEVEL', 'DEBUG');

      logger.syncFromStorage();

      expect(logger.getLevel()).toBe(LogLevel.DEBUG);
    });

    it('should mark localStorage as available after successful sync', () => {
      // Start with localStorage unavailable
      const getItemSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });

      const logger = new Logger();
      getItemSpy.mockRestore();

      // Now localStorage is available
      localStorage.setItem('BUDGET_LOG_LEVEL', 'INFO');

      logger.syncFromStorage();

      expect(logger.getLevel()).toBe(LogLevel.INFO);

      // Verify localStorage is marked as available by checking setLevel works
      const setItemSpy = vi.spyOn(localStorage, 'setItem');
      logger.setLevel(LogLevel.ERROR);
      expect(setItemSpy).toHaveBeenCalledWith('BUDGET_LOG_LEVEL', 'ERROR');
      setItemSpy.mockRestore();
    });

    it('should handle localStorage errors gracefully during sync', () => {
      const logger = new Logger();
      logger.setLevel(LogLevel.DEBUG);

      const getItemSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });

      // Should not throw
      expect(() => logger.syncFromStorage()).not.toThrow();

      // Level should remain unchanged
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);

      getItemSpy.mockRestore();
    });

    it('should ignore invalid stored values during sync', () => {
      const logger = new Logger();
      logger.setLevel(LogLevel.DEBUG);

      localStorage.setItem('BUDGET_LOG_LEVEL', 'INVALID');

      logger.syncFromStorage();

      // Level should remain unchanged
      expect(logger.getLevel()).toBe(LogLevel.DEBUG);
    });
  });

  describe('getLevel()', () => {
    it('should return current log level', () => {
      localStorage.setItem('BUDGET_LOG_LEVEL', 'DEBUG');
      const logger = new Logger();

      expect(logger.getLevel()).toBe(LogLevel.DEBUG);
    });

    it('should return updated level after setLevel', () => {
      const logger = new Logger();
      logger.setLevel(LogLevel.ERROR);

      expect(logger.getLevel()).toBe(LogLevel.ERROR);
    });

    it('should return default WARN level when no level is set', () => {
      localStorage.removeItem('BUDGET_LOG_LEVEL');
      const logger = new Logger();

      expect(logger.getLevel()).toBe(LogLevel.WARN);
    });
  });
});
