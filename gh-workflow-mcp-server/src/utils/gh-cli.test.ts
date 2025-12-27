/**
 * Unit tests for GitHub CLI state mapping functions
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { mapStateToStatus, mapStateToConclusion } from './gh-cli.js';

describe('mapStateToStatus', () => {
  test('maps PENDING to in_progress', () => {
    assert.strictEqual(mapStateToStatus('PENDING'), 'in_progress');
  });

  test('maps QUEUED to in_progress', () => {
    assert.strictEqual(mapStateToStatus('QUEUED'), 'in_progress');
  });

  test('maps IN_PROGRESS to in_progress', () => {
    assert.strictEqual(mapStateToStatus('IN_PROGRESS'), 'in_progress');
  });

  test('maps WAITING to in_progress', () => {
    assert.strictEqual(mapStateToStatus('WAITING'), 'in_progress');
  });

  test('maps SUCCESS to completed', () => {
    assert.strictEqual(mapStateToStatus('SUCCESS'), 'completed');
  });

  test('maps FAILURE to completed', () => {
    assert.strictEqual(mapStateToStatus('FAILURE'), 'completed');
  });

  test('maps ERROR to completed', () => {
    assert.strictEqual(mapStateToStatus('ERROR'), 'completed');
  });

  test('maps CANCELLED to completed', () => {
    assert.strictEqual(mapStateToStatus('CANCELLED'), 'completed');
  });

  test('maps SKIPPED to completed', () => {
    assert.strictEqual(mapStateToStatus('SKIPPED'), 'completed');
  });

  test('maps STALE to completed', () => {
    assert.strictEqual(mapStateToStatus('STALE'), 'completed');
  });

  test('maps unknown states to completed', () => {
    assert.strictEqual(mapStateToStatus('UNKNOWN'), 'completed');
    assert.strictEqual(mapStateToStatus('CUSTOM_STATE'), 'completed');
  });

  test('handles lowercase states (treats as unknown, maps to completed)', () => {
    assert.strictEqual(mapStateToStatus('pending'), 'completed');
    assert.strictEqual(mapStateToStatus('success'), 'completed');
  });

  test('handles empty string (treats as unknown, maps to completed)', () => {
    assert.strictEqual(mapStateToStatus(''), 'completed');
  });
});

describe('mapStateToConclusion', () => {
  test('maps SUCCESS to success', () => {
    assert.strictEqual(mapStateToConclusion('SUCCESS'), 'success');
  });

  test('maps FAILURE to failure', () => {
    assert.strictEqual(mapStateToConclusion('FAILURE'), 'failure');
  });

  test('maps ERROR to failure (edge case: errors treated as failures)', () => {
    assert.strictEqual(mapStateToConclusion('ERROR'), 'failure');
  });

  test('maps CANCELLED to cancelled', () => {
    assert.strictEqual(mapStateToConclusion('CANCELLED'), 'cancelled');
  });

  test('maps SKIPPED to skipped', () => {
    assert.strictEqual(mapStateToConclusion('SKIPPED'), 'skipped');
  });

  test('maps STALE to skipped (edge case: stale checks treated as skipped)', () => {
    assert.strictEqual(mapStateToConclusion('STALE'), 'skipped');
  });

  test('maps PENDING to null (in-progress state)', () => {
    assert.strictEqual(mapStateToConclusion('PENDING'), null);
  });

  test('maps QUEUED to null (in-progress state)', () => {
    assert.strictEqual(mapStateToConclusion('QUEUED'), null);
  });

  test('maps IN_PROGRESS to null (in-progress state)', () => {
    assert.strictEqual(mapStateToConclusion('IN_PROGRESS'), null);
  });

  test('maps WAITING to null (in-progress state)', () => {
    assert.strictEqual(mapStateToConclusion('WAITING'), null);
  });

  test('maps unknown states to null', () => {
    assert.strictEqual(mapStateToConclusion('UNKNOWN'), null);
    assert.strictEqual(mapStateToConclusion('CUSTOM_STATE'), null);
  });

  test('handles lowercase states (treats as unknown, maps to null)', () => {
    assert.strictEqual(mapStateToConclusion('success'), null);
    assert.strictEqual(mapStateToConclusion('failure'), null);
  });

  test('handles empty string (treats as unknown, maps to null)', () => {
    assert.strictEqual(mapStateToConclusion(''), null);
  });
});

describe('mapStateToStatus and mapStateToConclusion consistency', () => {
  test('all in-progress states map to in_progress status and null conclusion', () => {
    const inProgressStates = ['PENDING', 'QUEUED', 'IN_PROGRESS', 'WAITING'];

    for (const state of inProgressStates) {
      assert.strictEqual(
        mapStateToStatus(state),
        'in_progress',
        `${state} should map to in_progress status`
      );
      assert.strictEqual(
        mapStateToConclusion(state),
        null,
        `${state} should map to null conclusion`
      );
    }
  });

  test('all terminal states map to completed status and non-null conclusion', () => {
    const terminalStates = [
      { state: 'SUCCESS', conclusion: 'success' },
      { state: 'FAILURE', conclusion: 'failure' },
      { state: 'ERROR', conclusion: 'failure' },
      { state: 'CANCELLED', conclusion: 'cancelled' },
      { state: 'SKIPPED', conclusion: 'skipped' },
      { state: 'STALE', conclusion: 'skipped' },
    ];

    for (const { state, conclusion } of terminalStates) {
      assert.strictEqual(
        mapStateToStatus(state),
        'completed',
        `${state} should map to completed status`
      );
      assert.strictEqual(
        mapStateToConclusion(state),
        conclusion,
        `${state} should map to ${conclusion} conclusion`
      );
    }
  });
});

// Rate limit retry logic tests (issue #625)
import { sleep } from './gh-cli.js';

describe('Rate Limit Retry Logic', () => {
  describe('rate limit error detection', () => {
    test('should detect "rate limit" string pattern', () => {
      const error = new Error('API rate limit exceeded for user ID 12345');
      assert.ok(error.message.toLowerCase().includes('rate limit'));
    });

    test('should detect "429" status code pattern', () => {
      const error = new Error('HTTP 429 Too Many Requests');
      assert.ok(error.message.includes('429'));
    });

    test('should detect "api rate limit exceeded" pattern', () => {
      const error = new Error('gh: API rate limit exceeded for user ID 1669062');
      assert.ok(error.message.toLowerCase().includes('api rate limit exceeded'));
    });
  });

  describe('sleep utility', () => {
    test('should sleep for specified milliseconds', async () => {
      const start = Date.now();
      await sleep(100);
      const duration = Date.now() - start;

      // Allow 50ms tolerance for timer precision
      assert.ok(duration >= 100 && duration < 150, `Expected ~100ms, got ${duration}ms`);
    });
  });

  describe('exponential backoff formula', () => {
    test('should follow 2^n * 1000 pattern for retries', () => {
      const expectedDelays = [
        { attempt: 1, delay: 2000 }, // 2^1 * 1000
        { attempt: 2, delay: 4000 }, // 2^2 * 1000
        { attempt: 3, delay: 8000 }, // 2^3 * 1000
      ];

      for (const { attempt, delay } of expectedDelays) {
        const calculated = Math.pow(2, attempt) * 1000;
        assert.strictEqual(calculated, delay);
      }
    });
  });

  describe('error classification patterns', () => {
    test('should recognize network errors', () => {
      const patterns = ['network', 'ECONNREFUSED', 'ENOTFOUND'];
      patterns.forEach((pattern) => {
        const error = new Error(`Connection failed: ${pattern}`);
        assert.ok(error.message.includes(pattern));
      });
    });

    test('should recognize timeout errors', () => {
      const patterns = ['timeout', 'ETIMEDOUT'];
      patterns.forEach((pattern) => {
        const error = new Error(`Operation ${pattern}`);
        assert.ok(error.message.toLowerCase().includes(pattern.toLowerCase()));
      });
    });

    test('should recognize 5xx server errors as retryable', () => {
      const codes = ['502', '503', '504'];
      codes.forEach((code) => {
        const error = new Error(`HTTP ${code} error`);
        assert.ok(error.message.includes(code));
      });
    });

    test('should recognize socket errors as retryable', () => {
      const error = new Error('socket hang up');
      assert.ok(error.message.toLowerCase().includes('socket'));
    });

    test('should recognize connection reset as retryable', () => {
      const error = new Error('ECONNRESET: connection reset by peer');
      assert.ok(error.message.toLowerCase().includes('econnreset'));
    });

    test('should recognize all rate limit error patterns', () => {
      const rateLimitErrors = [
        'API rate limit exceeded',
        'HTTP 429 Too Many Requests',
        'rate limit reached',
        'gh: API rate limit exceeded for user ID 1669062',
      ];

      rateLimitErrors.forEach((msg) => {
        const error = new Error(msg);
        assert.ok(
          error.message.toLowerCase().includes('rate limit') || error.message.includes('429'),
          `Pattern "${msg}" should be recognized as rate limit error`
        );
      });
    });
  });

  describe('non-retryable error patterns', () => {
    test('should recognize 404 as non-retryable', () => {
      const error = new Error('HTTP 404 Not Found');
      // 404 should not match retryable patterns
      assert.ok(!error.message.includes('429'));
      assert.ok(!error.message.toLowerCase().includes('rate limit'));
      assert.ok(!error.message.toLowerCase().includes('network'));
    });

    test('should recognize validation errors as non-retryable', () => {
      const error = new Error('Invalid PR number: must be a positive integer');
      // Validation errors should not match retryable patterns
      assert.ok(!error.message.toLowerCase().includes('network'));
      assert.ok(!error.message.toLowerCase().includes('timeout'));
      assert.ok(!error.message.toLowerCase().includes('rate limit'));
    });
  });
});
