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

      // When data is undefined, logger captures stack trace instead
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
  });
});
