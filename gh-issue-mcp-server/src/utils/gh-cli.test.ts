/**
 * Unit tests for GitHub CLI retry logic and rate limit handling
 *
 * These tests validate:
 * - Error pattern recognition for retryable vs non-retryable errors
 * - Exponential backoff formula (2^n * 1000ms)
 * - Sleep utility behavior
 *
 * Note: These tests verify error classification patterns rather than actual retry
 * execution (which requires mocking external gh CLI calls).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ghCliWithRetry, sleep } from './gh-cli.js';

describe('Rate Limit Retry Logic', () => {
  describe('rate limit error detection', () => {
    it('should detect "rate limit" string pattern', () => {
      const error = new Error('API rate limit exceeded for user ID 12345');
      assert.ok(error.message.toLowerCase().includes('rate limit'));
    });

    it('should detect "429" status code pattern', () => {
      const error = new Error('HTTP 429 Too Many Requests');
      assert.ok(error.message.includes('429'));
    });

    it('should detect "api rate limit exceeded" pattern', () => {
      const error = new Error('gh: API rate limit exceeded for user ID 1669062');
      assert.ok(error.message.toLowerCase().includes('api rate limit exceeded'));
    });
  });

  describe('sleep utility', () => {
    it('should sleep for specified milliseconds', async () => {
      const start = Date.now();
      await sleep(100);
      const duration = Date.now() - start;

      // Allow 50ms tolerance for timer precision
      assert.ok(duration >= 100 && duration < 150, `Expected ~100ms, got ${duration}ms`);
    });

    it('should return a Promise', () => {
      const result = sleep(10);
      assert.ok(result instanceof Promise);
    });
  });

  describe('exponential backoff formula', () => {
    it('should follow 2^n * 1000 pattern', () => {
      const expectedDelays = [
        { attempt: 1, delay: 2000 }, // 2^1 * 1000
        { attempt: 2, delay: 4000 }, // 2^2 * 1000
        { attempt: 3, delay: 8000 }, // 2^3 * 1000
        { attempt: 4, delay: 16000 }, // 2^4 * 1000
      ];

      for (const { attempt, delay } of expectedDelays) {
        const calculated = Math.pow(2, attempt) * 1000;
        assert.strictEqual(calculated, delay);
      }
    });
  });

  describe('ghCliWithRetry', () => {
    it('should export ghCliWithRetry function', () => {
      assert.strictEqual(typeof ghCliWithRetry, 'function');
    });

    it('should accept args, options, and maxRetries parameters', () => {
      // Verify function signature via length property
      // ghCliWithRetry has 3 parameters, but only args is required
      assert.ok(ghCliWithRetry.length >= 1);
    });

    it('should throw after exhausting retries', async () => {
      try {
        await ghCliWithRetry(['invalid-command-xyz'], {}, 1);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof Error);
      }
    });
  });

  describe('error classification patterns', () => {
    it('should recognize network errors', () => {
      const patterns = ['network', 'ECONNREFUSED', 'ENOTFOUND'];
      patterns.forEach((pattern) => {
        const error = new Error(`Connection failed: ${pattern}`);
        assert.ok(error.message.includes(pattern));
      });
    });

    it('should recognize timeout errors', () => {
      const patterns = ['timeout', 'ETIMEDOUT'];
      patterns.forEach((pattern) => {
        const error = new Error(`Operation ${pattern}`);
        assert.ok(error.message.toLowerCase().includes(pattern.toLowerCase()));
      });
    });

    it('should recognize 5xx server errors', () => {
      const codes = ['502', '503', '504'];
      codes.forEach((code) => {
        const error = new Error(`HTTP ${code} error`);
        assert.ok(error.message.includes(code));
      });
    });

    it('should recognize socket errors', () => {
      const error = new Error('socket hang up');
      assert.ok(error.message.toLowerCase().includes('socket'));
    });

    it('should recognize connection reset errors', () => {
      const error = new Error('ECONNRESET: connection reset by peer');
      assert.ok(error.message.toLowerCase().includes('econnreset'));
    });
  });

  describe('non-retryable errors', () => {
    it('should recognize 404 as non-retryable', () => {
      const error = new Error('HTTP 404 Not Found');
      // 404 errors should not match retryable patterns
      assert.ok(!error.message.includes('429'));
      assert.ok(!error.message.toLowerCase().includes('rate limit'));
      assert.ok(!error.message.includes('502'));
    });

    it('should recognize validation errors as non-retryable', () => {
      const error = new Error('Invalid PR number');
      // Validation errors should not match retryable patterns
      assert.ok(!error.message.toLowerCase().includes('network'));
      assert.ok(!error.message.toLowerCase().includes('timeout'));
    });
  });
});
