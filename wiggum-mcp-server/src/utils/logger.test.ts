/**
 * Tests for logger utility
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { Logger } from './logger.js';

describe('Logger', () => {
  let consoleErrorMock: ReturnType<typeof mock.method>;
  let originalEnv: string | undefined;

  beforeEach(() => {
    // Mock console.error (stderr)
    consoleErrorMock = mock.method(console, 'error', () => {});
    // Save original env var
    originalEnv = process.env.WIGGUM_LOG_LEVEL;
  });

  afterEach(() => {
    // Restore console.error
    consoleErrorMock.mock.restore();
    // Restore env var
    if (originalEnv === undefined) {
      delete process.env.WIGGUM_LOG_LEVEL;
    } else {
      process.env.WIGGUM_LOG_LEVEL = originalEnv;
    }
  });

  describe('log level filtering', () => {
    it('should log ERROR when level is ERROR', () => {
      process.env.WIGGUM_LOG_LEVEL = 'ERROR';
      const logger = new Logger();

      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');

      // Only error should be logged
      assert.strictEqual(consoleErrorMock.mock.callCount(), 1);
      const call = consoleErrorMock.mock.calls[0];
      const logOutput = String(call.arguments[0]);
      assert.ok(logOutput.includes('[ERROR] error message'));
    });

    it('should log ERROR and WARN when level is WARN', () => {
      process.env.WIGGUM_LOG_LEVEL = 'WARN';
      const logger = new Logger();

      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');

      // Error and warn should be logged
      assert.strictEqual(consoleErrorMock.mock.callCount(), 2);
      const calls = consoleErrorMock.mock.calls;
      assert.ok(String(calls[0].arguments[0]).includes('[ERROR] error message'));
      assert.ok(String(calls[1].arguments[0]).includes('[WARN] warn message'));
    });

    it('should log ERROR, WARN, and INFO when level is INFO', () => {
      process.env.WIGGUM_LOG_LEVEL = 'INFO';
      const logger = new Logger();

      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');

      // Error, warn, and info should be logged
      assert.strictEqual(consoleErrorMock.mock.callCount(), 3);
      const calls = consoleErrorMock.mock.calls;
      assert.ok(String(calls[0].arguments[0]).includes('[ERROR] error message'));
      assert.ok(String(calls[1].arguments[0]).includes('[WARN] warn message'));
      assert.ok(String(calls[2].arguments[0]).includes('[INFO] info message'));
    });

    it('should log all levels when level is DEBUG', () => {
      process.env.WIGGUM_LOG_LEVEL = 'DEBUG';
      const logger = new Logger();

      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');

      // All levels should be logged
      assert.strictEqual(consoleErrorMock.mock.callCount(), 4);
      const calls = consoleErrorMock.mock.calls;
      assert.ok(String(calls[0].arguments[0]).includes('[ERROR] error message'));
      assert.ok(String(calls[1].arguments[0]).includes('[WARN] warn message'));
      assert.ok(String(calls[2].arguments[0]).includes('[INFO] info message'));
      assert.ok(String(calls[3].arguments[0]).includes('[DEBUG] debug message'));
    });
  });

  describe('default log level', () => {
    it('should default to WARN when env var not set', () => {
      delete process.env.WIGGUM_LOG_LEVEL;
      const logger = new Logger();

      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');

      // Only error and warn should be logged (WARN level)
      assert.strictEqual(consoleErrorMock.mock.callCount(), 2);
      const calls = consoleErrorMock.mock.calls;
      assert.ok(String(calls[0].arguments[0]).includes('[ERROR] error message'));
      assert.ok(String(calls[1].arguments[0]).includes('[WARN] warn message'));
    });

    it('should default to WARN when env var is invalid', () => {
      process.env.WIGGUM_LOG_LEVEL = 'INVALID';
      const logger = new Logger();

      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');

      // Only error and warn should be logged (WARN level)
      assert.strictEqual(consoleErrorMock.mock.callCount(), 2);
      const calls = consoleErrorMock.mock.calls;
      assert.ok(String(calls[0].arguments[0]).includes('[ERROR] error message'));
      assert.ok(String(calls[1].arguments[0]).includes('[WARN] warn message'));
    });
  });

  describe('log format', () => {
    it('should include timestamp, level, and message', () => {
      process.env.WIGGUM_LOG_LEVEL = 'WARN';
      const logger = new Logger();

      logger.warn('test message');

      const call = consoleErrorMock.mock.calls[0];
      const logOutput = String(call.arguments[0]);
      assert.ok(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[WARN\] test message$/.test(logOutput)
      );
    });

    it('should serialize structured data as JSON', () => {
      process.env.WIGGUM_LOG_LEVEL = 'INFO';
      const logger = new Logger();

      const data = { foo: 'bar', count: 42 };
      logger.info('test message', data);

      const call = consoleErrorMock.mock.calls[0];
      const logOutput = String(call.arguments[0]);
      assert.ok(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] test message {"foo":"bar","count":42}$/.test(
          logOutput
        )
      );
    });

    it('should handle message without data', () => {
      process.env.WIGGUM_LOG_LEVEL = 'ERROR';
      const logger = new Logger();

      logger.error('simple error');

      const call = consoleErrorMock.mock.calls[0];
      const logOutput = String(call.arguments[0]);
      assert.ok(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[ERROR\] simple error$/.test(logOutput)
      );
    });
  });

  describe('stderr output', () => {
    it('should use console.error (stderr) not console.log (stdout)', () => {
      const consoleLogMock = mock.method(console, 'log', () => {});

      process.env.WIGGUM_LOG_LEVEL = 'INFO';
      const logger = new Logger();

      logger.info('test message');

      // Should use stderr (console.error), not stdout (console.log)
      assert.strictEqual(consoleErrorMock.mock.callCount(), 1);
      assert.strictEqual(consoleLogMock.mock.callCount(), 0);

      consoleLogMock.mock.restore();
    });
  });

  describe('case insensitivity', () => {
    it('should accept lowercase env var values', () => {
      process.env.WIGGUM_LOG_LEVEL = 'debug';
      const logger = new Logger();

      logger.debug('debug message');

      const call = consoleErrorMock.mock.calls[0];
      const logOutput = String(call.arguments[0]);
      assert.ok(logOutput.includes('[DEBUG] debug message'));
    });

    it('should accept mixed case env var values', () => {
      process.env.WIGGUM_LOG_LEVEL = 'DeBuG';
      const logger = new Logger();

      logger.debug('debug message');

      const call = consoleErrorMock.mock.calls[0];
      const logOutput = String(call.arguments[0]);
      assert.ok(logOutput.includes('[DEBUG] debug message'));
    });
  });
});
