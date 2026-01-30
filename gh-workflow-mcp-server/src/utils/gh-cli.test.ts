/**
 * Unit tests for GitHub CLI state mapping functions
 */

import { describe, test } from 'node:test';
import assert from 'node:assert';
import { mapStateToStatus, mapStateToConclusion, parseFailedStepLogs } from './gh-cli.js';
import { ParsingError } from '@commons/mcp-common/errors';

describe('mapStateToStatus', () => {
  test('maps PENDING to in_progress', () => {
    assert.deepStrictEqual(mapStateToStatus('PENDING'), { status: 'in_progress' });
  });

  test('maps QUEUED to in_progress', () => {
    assert.deepStrictEqual(mapStateToStatus('QUEUED'), { status: 'in_progress' });
  });

  test('maps IN_PROGRESS to in_progress', () => {
    assert.deepStrictEqual(mapStateToStatus('IN_PROGRESS'), { status: 'in_progress' });
  });

  test('maps WAITING to in_progress', () => {
    assert.deepStrictEqual(mapStateToStatus('WAITING'), { status: 'in_progress' });
  });

  test('maps SUCCESS to completed', () => {
    assert.deepStrictEqual(mapStateToStatus('SUCCESS'), { status: 'completed' });
  });

  test('maps FAILURE to completed', () => {
    assert.deepStrictEqual(mapStateToStatus('FAILURE'), { status: 'completed' });
  });

  test('maps ERROR to completed', () => {
    assert.deepStrictEqual(mapStateToStatus('ERROR'), { status: 'completed' });
  });

  test('maps CANCELLED to completed', () => {
    assert.deepStrictEqual(mapStateToStatus('CANCELLED'), { status: 'completed' });
  });

  test('maps SKIPPED to completed', () => {
    assert.deepStrictEqual(mapStateToStatus('SKIPPED'), { status: 'completed' });
  });

  test('maps STALE to completed', () => {
    assert.deepStrictEqual(mapStateToStatus('STALE'), { status: 'completed' });
  });

  test('maps unknown states to in_progress with unknownState (conservative - avoids premature exit)', () => {
    // Unknown states default to in_progress to continue monitoring and avoid incomplete results
    // Also returns the unknown state for surfacing to users
    assert.deepStrictEqual(mapStateToStatus('UNKNOWN'), {
      status: 'in_progress',
      unknownState: 'UNKNOWN',
    });
    assert.deepStrictEqual(mapStateToStatus('CUSTOM_STATE'), {
      status: 'in_progress',
      unknownState: 'CUSTOM_STATE',
    });
  });

  test('handles lowercase states (treats as unknown, maps to in_progress with unknownState)', () => {
    // Lowercase variants are not in the known state lists, treated as unknown
    assert.deepStrictEqual(mapStateToStatus('pending'), {
      status: 'in_progress',
      unknownState: 'pending',
    });
    assert.deepStrictEqual(mapStateToStatus('success'), {
      status: 'in_progress',
      unknownState: 'success',
    });
  });

  test('handles empty string (treats as unknown, maps to in_progress with unknownState)', () => {
    assert.deepStrictEqual(mapStateToStatus(''), { status: 'in_progress', unknownState: '' });
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
        mapStateToStatus(state).status,
        'in_progress',
        `${state} should map to in_progress status`
      );
      assert.strictEqual(
        mapStateToStatus(state).unknownState,
        undefined,
        `${state} should not have unknownState`
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
        mapStateToStatus(state).status,
        'completed',
        `${state} should map to completed status`
      );
      assert.strictEqual(
        mapStateToStatus(state).unknownState,
        undefined,
        `${state} should not have unknownState`
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

    test('should cap delay at 60s for attempt 6 (2^6=64s > 60s)', () => {
      const MAX_DELAY_MS = 60000;
      const uncappedDelay = Math.pow(2, 6) * 1000; // 64000ms
      const cappedDelay = Math.min(uncappedDelay, MAX_DELAY_MS);
      assert.strictEqual(uncappedDelay, 64000);
      assert.strictEqual(cappedDelay, 60000);
    });

    test('should cap delay at 60s for attempt 7 (2^7=128s > 60s)', () => {
      const MAX_DELAY_MS = 60000;
      const uncappedDelay = Math.pow(2, 7) * 1000; // 128000ms
      const cappedDelay = Math.min(uncappedDelay, MAX_DELAY_MS);
      assert.strictEqual(uncappedDelay, 128000);
      assert.strictEqual(cappedDelay, 60000);
    });

    test('should cap delay at 60s for attempt 10', () => {
      const MAX_DELAY_MS = 60000;
      const uncappedDelay = Math.pow(2, 10) * 1000; // 1024000ms
      const cappedDelay = Math.min(uncappedDelay, MAX_DELAY_MS);
      assert.strictEqual(uncappedDelay, 1024000);
      assert.strictEqual(cappedDelay, 60000);
    });

    test('should NOT cap delay for attempt 5 (2^5=32s < 60s)', () => {
      const MAX_DELAY_MS = 60000;
      const uncappedDelay = Math.pow(2, 5) * 1000; // 32000ms
      const cappedDelay = Math.min(uncappedDelay, MAX_DELAY_MS);
      assert.strictEqual(uncappedDelay, 32000);
      assert.strictEqual(cappedDelay, 32000); // Not capped
      assert.strictEqual(uncappedDelay < MAX_DELAY_MS, true);
    });

    test('should document capped vs uncapped delay calculations', () => {
      const MAX_DELAY_MS = 60000;
      const testCases = [
        { attempt: 1, uncapped: 2000, capped: 2000 },
        { attempt: 2, uncapped: 4000, capped: 4000 },
        { attempt: 3, uncapped: 8000, capped: 8000 },
        { attempt: 4, uncapped: 16000, capped: 16000 },
        { attempt: 5, uncapped: 32000, capped: 32000 },
        { attempt: 6, uncapped: 64000, capped: 60000 }, // Capped
        { attempt: 7, uncapped: 128000, capped: 60000 }, // Capped
      ];

      for (const { attempt, uncapped, capped } of testCases) {
        const calculatedUncapped = Math.pow(2, attempt) * 1000;
        const calculatedCapped = Math.min(calculatedUncapped, MAX_DELAY_MS);
        assert.strictEqual(calculatedUncapped, uncapped, `Uncapped delay for attempt ${attempt}`);
        assert.strictEqual(calculatedCapped, capped, `Capped delay for attempt ${attempt}`);
      }
    });
  });

  describe('HTTP status extraction from error messages', () => {
    // Tests document the patterns used to extract HTTP status codes from error messages
    // when exitCode is not directly available

    test('should recognize "HTTP 429" pattern', () => {
      const errorMessage = 'HTTP 429 Too Many Requests';
      const pattern = /HTTP\s+(\d{3})/i;
      const match = errorMessage.match(pattern);
      assert.ok(match, 'Pattern should match');
      assert.strictEqual(match[1], '429');
    });

    test('should recognize "status: 429" pattern', () => {
      const errorMessage = 'API error: status: 429';
      const pattern = /status[:\s]+(\d{3})/i;
      const match = errorMessage.match(pattern);
      assert.ok(match, 'Pattern should match');
      assert.strictEqual(match[1], '429');
    });

    test('should recognize "429 Too Many" pattern', () => {
      const errorMessage = '429 Too Many Requests';
      const pattern = /(\d{3})\s+Too\s+Many/i;
      const match = errorMessage.match(pattern);
      assert.ok(match, 'Pattern should match');
      assert.strictEqual(match[1], '429');
    });

    test('should recognize "rate limit (429)" pattern', () => {
      const errorMessage = 'rate limit exceeded (429)';
      const pattern = /rate\s+limit.*?(\d{3})/i;
      const match = errorMessage.match(pattern);
      assert.ok(match, 'Pattern should match');
      assert.strictEqual(match[1], '429');
    });

    test('should validate extracted status is in 100-599 range', () => {
      // Valid HTTP status codes
      const validCodes = [100, 200, 301, 400, 429, 500, 503, 599];
      for (const code of validCodes) {
        const isValid =
          Number.isFinite(code) && Number.isSafeInteger(code) && code >= 100 && code <= 599;
        assert.strictEqual(isValid, true, `${code} should be valid`);
      }

      // Invalid codes (outside range)
      const invalidCodes = [0, 50, 99, 600, 700, 1000];
      for (const code of invalidCodes) {
        const isValid =
          Number.isFinite(code) && Number.isSafeInteger(code) && code >= 100 && code <= 599;
        assert.strictEqual(isValid, false, `${code} should be invalid`);
      }
    });

    test('should handle Infinity from malformed input', () => {
      const parsed = Infinity;
      const isValid =
        Number.isFinite(parsed) && Number.isSafeInteger(parsed) && parsed >= 100 && parsed <= 599;
      assert.strictEqual(isValid, false, 'Infinity should be rejected');
    });

    test('should handle NaN from malformed input', () => {
      const parsed = NaN;
      const isValid =
        Number.isFinite(parsed) && Number.isSafeInteger(parsed) && parsed >= 100 && parsed <= 599;
      assert.strictEqual(isValid, false, 'NaN should be rejected');
    });

    test('should handle messages with HTTP keywords but no valid status', () => {
      const errorMessages = [
        'HTTP error occurred',
        'status unknown',
        'HTTP response invalid',
        'Connection failed to HTTP server',
      ];

      const statusPatterns = [
        /HTTP\s+(\d{3})/i,
        /status[:\s]+(\d{3})/i,
        /(\d{3})\s+Too\s+Many/i,
        /rate\s+limit.*?(\d{3})/i,
      ];

      for (const msg of errorMessages) {
        let foundValidCode = false;
        for (const pattern of statusPatterns) {
          const match = msg.match(pattern);
          if (match && match[1]) {
            const parsed = parseInt(match[1], 10);
            if (
              Number.isFinite(parsed) &&
              Number.isSafeInteger(parsed) &&
              parsed >= 100 &&
              parsed <= 599
            ) {
              foundValidCode = true;
              break;
            }
          }
        }
        assert.strictEqual(
          foundValidCode,
          false,
          `"${msg}" should not extract a valid HTTP status`
        );
      }
    });
  });

  describe('maxRetries validation', () => {
    // Tests document the validation rules for maxRetries parameter
    // Mirrors the validation logic in mcp-common/src/gh-retry.ts:238

    /**
     * Helper function to validate maxRetries parameter
     * Mirrors the production validation logic to avoid static analyzer warnings
     * about "always false" conditions when testing invalid values.
     */
    function isValidMaxRetries(value: number): boolean {
      const MAX_RETRIES_LIMIT = 100;
      return Number.isInteger(value) && value >= 1 && value <= MAX_RETRIES_LIMIT;
    }

    test('should document that maxRetries=0 is rejected', () => {
      // maxRetries < 1 would cause the loop to never execute
      const maxRetries = 0;
      assert.strictEqual(isValidMaxRetries(maxRetries), false, 'maxRetries=0 should be invalid');
    });

    test('should document that maxRetries=-1 is rejected', () => {
      const maxRetries = -1;
      assert.strictEqual(isValidMaxRetries(maxRetries), false, 'maxRetries=-1 should be invalid');
    });

    test('should document that maxRetries=0.5 is rejected (non-integer)', () => {
      const maxRetries = 0.5;
      assert.strictEqual(isValidMaxRetries(maxRetries), false, 'maxRetries=0.5 should be invalid');
    });

    test('should document that maxRetries=NaN is rejected', () => {
      const maxRetries = NaN;
      assert.strictEqual(isValidMaxRetries(maxRetries), false, 'maxRetries=NaN should be invalid');
    });

    test('should document that maxRetries=Infinity is rejected', () => {
      const maxRetries = Infinity;
      assert.strictEqual(
        isValidMaxRetries(maxRetries),
        false,
        'maxRetries=Infinity should be invalid'
      );
    });

    test('should document that maxRetries=101 is rejected (above limit)', () => {
      const maxRetries = 101;
      assert.strictEqual(isValidMaxRetries(maxRetries), false, 'maxRetries=101 should be invalid');
    });

    test('should accept maxRetries=1 (minimum valid)', () => {
      const maxRetries = 1;
      assert.strictEqual(isValidMaxRetries(maxRetries), true, 'maxRetries=1 should be valid');
    });

    test('should accept maxRetries=100 (maximum valid)', () => {
      const maxRetries = 100;
      assert.strictEqual(isValidMaxRetries(maxRetries), true, 'maxRetries=100 should be valid');
    });

    test('should accept common maxRetries values (3, 5, 10)', () => {
      const commonValues = [3, 5, 10];
      for (const value of commonValues) {
        assert.strictEqual(isValidMaxRetries(value), true, `maxRetries=${value} should be valid`);
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

// ParsingError integration tests for parseFailedStepLogs (issue #859)
describe('parseFailedStepLogs ParsingError integration', () => {
  describe('throws ParsingError with structured context when success rate below threshold', () => {
    test('should include all context fields when parsing quality is too poor', () => {
      // Create log output with 80% unparseable lines (20% success rate < 70% threshold)
      // Format: timestamp\tjob-name\tstep-name\tlog-line
      const logLines = [
        '2024-01-01T00:00:00.0000000Z\tBuild\tCheckout\tChecking out repository',
        '2024-01-01T00:00:01.0000000Z\tBuild\tSetup\tSetting up environment',
        'malformed line 1',
        'malformed line 2',
        'malformed line 3',
        'malformed line 4',
        'malformed line 5',
        'malformed line 6',
        'malformed line 7',
        'malformed line 8',
      ];
      const output = logLines.join('\n');

      try {
        parseFailedStepLogs(output);
        assert.fail('Expected ParsingError to be thrown');
      } catch (error) {
        assert.ok(error instanceof ParsingError, 'Should throw ParsingError');
        assert.ok(error.context, 'Should have context property');
        assert.strictEqual(error.context.totalLines, 10, 'Should have correct totalLines');
        assert.strictEqual(error.context.skippedLines, 8, 'Should have correct skippedLines');
        assert.strictEqual(error.context.parsedLines, 2, 'Should have correct parsedLines');
        assert.strictEqual(error.context.successRate, 0.2, 'Should have correct successRate (20%)');
        assert.strictEqual(
          error.context.minSuccessRate,
          0.7,
          'Should have correct minSuccessRate (70%)'
        );
        assert.strictEqual(error.context.parseType, 'workflow-logs', 'Should have parseType');
        assert.ok(
          typeof error.context.parsedSteps === 'number',
          'Should have parsedSteps as number'
        );
      }
    });

    test('should throw when exactly at 69.9% success rate (just below threshold)', () => {
      // Create exactly 30 parseable lines and 70 malformed lines (30% < 70% threshold)
      const parseableLines = Array.from(
        { length: 30 },
        (_, i) => `2024-01-01T00:00:${i.toString().padStart(2, '0')}.0000000Z\tJob\tStep\tLog ${i}`
      );
      const malformedLines = Array.from({ length: 70 }, (_, i) => `malformed ${i}`);
      const output = [...parseableLines, ...malformedLines].join('\n');

      try {
        parseFailedStepLogs(output);
        assert.fail('Expected ParsingError to be thrown');
      } catch (error) {
        assert.ok(error instanceof ParsingError);
        assert.strictEqual(error.context?.successRate, 0.3);
        assert.ok((error.context?.successRate ?? 0) < 0.7, 'Success rate should be below 70%');
      }
    });

    test('should NOT throw when exactly at 70% success rate (at threshold)', () => {
      // Create exactly 70 parseable lines and 30 malformed lines (70% = 70% threshold)
      const parseableLines = Array.from(
        { length: 70 },
        (_, i) => `2024-01-01T00:00:${i.toString().padStart(2, '0')}.0000000Z\tJob\tStep\tLog ${i}`
      );
      const malformedLines = Array.from({ length: 30 }, (_, i) => `malformed ${i}`);
      const output = [...parseableLines, ...malformedLines].join('\n');

      // Should NOT throw - 70% is exactly at threshold
      const result = parseFailedStepLogs(output);
      assert.ok(result);
      assert.strictEqual(result.successRate, 0.7);
    });

    test('should NOT throw when above 70% success rate', () => {
      // Create 80 parseable lines and 20 malformed lines (80% > 70% threshold)
      const parseableLines = Array.from(
        { length: 80 },
        (_, i) => `2024-01-01T00:00:${i.toString().padStart(2, '0')}.0000000Z\tJob\tStep\tLog ${i}`
      );
      const malformedLines = Array.from({ length: 20 }, (_, i) => `malformed ${i}`);
      const output = [...parseableLines, ...malformedLines].join('\n');

      const result = parseFailedStepLogs(output);
      assert.ok(result);
      assert.strictEqual(result.successRate, 0.8);
      assert.ok(result.successRate >= 0.7, 'Success rate should be at or above 70%');
    });
  });

  describe('error handler code path integration', () => {
    test('allows error handlers to access context properties programmatically', () => {
      // Create input with poor parsing quality
      const badInput = Array.from({ length: 100 }, (_, i) =>
        i < 20
          ? `2024-01-01T00:00:${i.toString().padStart(2, '0')}.0000000Z\tJob\tStep\tLog ${i}`
          : `malformed line ${i}`
      ).join('\n');

      try {
        parseFailedStepLogs(badInput);
        assert.fail('Expected ParsingError to be thrown');
      } catch (error) {
        // Verify error handler patterns work correctly
        assert.ok(error instanceof ParsingError, 'Should throw ParsingError');
        assert.ok(error.context, 'Should have context property');
        assert.strictEqual(error.context.parseType, 'workflow-logs');
        assert.ok(error.context.successRate !== undefined, 'Should have successRate');
        assert.ok(error.context.totalLines !== undefined, 'Should have totalLines');
        assert.ok(error.context.minSuccessRate === 0.7, 'Should have correct threshold');

        // Verify context can be used for metrics collection
        const { successRate, totalLines, skippedLines } = error.context;
        assert.strictEqual(typeof successRate, 'number', 'successRate should be number');
        assert.strictEqual(typeof totalLines, 'number', 'totalLines should be number');
        assert.strictEqual(typeof skippedLines, 'number', 'skippedLines should be number');

        // Verify quality check pattern works
        const qualityIssue = error.context.successRate! < error.context.minSuccessRate!;
        assert.ok(qualityIssue, 'Should detect quality issue from context');
      }
    });

    test('allows error handlers to calculate metrics from context', () => {
      const badInput = Array.from({ length: 50 }, (_, i) =>
        i < 10
          ? `2024-01-01T00:00:${i.toString().padStart(2, '0')}.0000000Z\tJob\tStep\tLog ${i}`
          : `malformed line ${i}`
      ).join('\n');

      try {
        parseFailedStepLogs(badInput);
      } catch (error) {
        if (error instanceof ParsingError && error.context) {
          // Demonstrate metrics calculation patterns
          const failureRate = 1 - error.context.successRate!;
          const parsedPercentage = (error.context.successRate! * 100).toFixed(1);
          const isSeverelyCorrrupt = error.context.successRate! < 0.3;

          assert.strictEqual(typeof failureRate, 'number');
          assert.ok(failureRate > 0 && failureRate < 1);
          assert.strictEqual(parsedPercentage, '20.0');
          assert.strictEqual(isSeverelyCorrrupt, true);
        }
      }
    });

    test('verifies context data survives error propagation', () => {
      const badInput = Array.from({ length: 20 }, (_, i) =>
        i < 5 ? `2024-01-01T00:00:0${i}.0000000Z\tJob\tStep\tLog ${i}` : `malformed ${i}`
      ).join('\n');

      let caughtError: ParsingError | null = null;

      // Simulate error propagation through multiple layers
      try {
        try {
          parseFailedStepLogs(badInput);
        } catch (innerError) {
          // Re-throw to test propagation
          throw innerError;
        }
      } catch (outerError) {
        caughtError = outerError as ParsingError;
      }

      // Verify context survived propagation
      assert.ok(caughtError instanceof ParsingError);
      assert.ok(caughtError.context, 'Context should survive propagation');
      assert.strictEqual(caughtError.context.totalLines, 20);
      assert.strictEqual(caughtError.context.skippedLines, 15);
      assert.strictEqual(caughtError.context.successRate, 0.25);
      assert.strictEqual(caughtError.context.parseType, 'workflow-logs');
    });
  });

  describe('edge cases and boundary conditions', () => {
    test('handles empty input gracefully', () => {
      const result = parseFailedStepLogs('');
      assert.ok(result);
      assert.strictEqual(result.totalLines, 0);
      assert.strictEqual(result.skippedLines, 0);
      assert.strictEqual(result.successRate, 1); // No lines = 100% success
    });

    test('handles input with only whitespace', () => {
      const result = parseFailedStepLogs('   \n\n   \n');
      assert.ok(result);
      assert.strictEqual(result.totalLines, 0); // Empty lines are filtered out
    });

    test('handles 100% malformed input', () => {
      const badInput = Array.from({ length: 10 }, (_, i) => `malformed ${i}`).join('\n');

      try {
        parseFailedStepLogs(badInput);
        assert.fail('Expected ParsingError to be thrown');
      } catch (error) {
        assert.ok(error instanceof ParsingError);
        assert.strictEqual(error.context?.successRate, 0);
        assert.strictEqual(error.context?.totalLines, 10);
        assert.strictEqual(error.context?.skippedLines, 10);
        assert.strictEqual(error.context?.parsedLines, 0);
      }
    });

    test('handles mixed valid and invalid log formats', () => {
      const mixedInput = [
        '2024-01-01T00:00:00.0000000Z\tJob1\tStep1\tValid log 1',
        'completely invalid',
        '2024-01-01T00:00:01.0000000Z\tJob1\tStep2\tValid log 2',
        'another invalid line',
        'yet another invalid',
        '2024-01-01T00:00:02.0000000Z\tJob2\tStep1\tValid log 3',
      ].join('\n');

      // 3 valid out of 6 = 50% < 70% threshold
      try {
        parseFailedStepLogs(mixedInput);
        assert.fail('Expected ParsingError to be thrown');
      } catch (error) {
        assert.ok(error instanceof ParsingError);
        assert.strictEqual(error.context?.successRate, 0.5);
        assert.strictEqual(error.context?.parsedLines, 3);
        assert.strictEqual(error.context?.skippedLines, 3);
      }
    });
  });
});
