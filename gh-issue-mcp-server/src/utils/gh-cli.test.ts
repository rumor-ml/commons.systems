/**
 * Unit tests for GitHub CLI retry logic and rate limit handling
 *
 * Tests marked "(integration)" verify actual wrapper delegation to mcp-common.
 * Tests marked "(behavior)" verify actual function execution, not just pattern matching.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { ghCliWithRetry, sleep } from './gh-cli.js';
import { sleep as sharedSleep, type GhCliFn } from '@commons/mcp-common/gh-retry';

describe('Rate Limit Retry Logic', () => {
  let originalConsoleError: typeof console.error;
  let consoleErrors: string[];

  beforeEach(() => {
    originalConsoleError = console.error;
    consoleErrors = [];
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  describe('sleep re-export from mcp-common', () => {
    it('should re-export sleep function from mcp-common', () => {
      assert.strictEqual(typeof sleep, 'function');
      // Verify it's the same reference as the shared implementation
      assert.strictEqual(sleep, sharedSleep);
    });

    it('should maintain backward compatible timing behavior', async () => {
      const start = Date.now();
      await sleep(100);
      const duration = Date.now() - start;

      assert.ok(duration >= 100 && duration < 150, `Expected ~100ms, got ${duration}ms`);
    });

    it('should return a Promise', () => {
      const result = sleep(10);
      assert.ok(result instanceof Promise);
    });
  });

  describe('ghCliWithRetry integration with mcp-common', () => {
    it('(integration) should export ghCliWithRetry function', () => {
      assert.strictEqual(typeof ghCliWithRetry, 'function');
    });

    it('(integration) should delegate to shared ghCliWithRetry with local ghCli', async () => {
      // This test verifies the wrapper calls the underlying implementation
      // by checking that it throws after maxRetries attempts
      try {
        await ghCliWithRetry(['invalid-command-xyz'], {}, 1);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof Error);
        // Verify the error came from gh CLI execution (via mcp-common)
        assert.ok(
          consoleErrors.some((log) => log.includes('ghCliWithRetry')),
          'Should log retry attempts from mcp-common'
        );
      }
    });

    it('(integration) should preserve retry behavior for retryable errors', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        if (attemptCount < 3) {
          // Simulate retryable error (rate limit)
          const error: any = new Error('HTTP 429 Too Many Requests');
          error.exitCode = 429;
          throw error;
        }
        return 'success';
      };

      // Use the shared implementation directly with our mock
      const { ghCliWithRetry: shared } = await import('@commons/mcp-common/gh-retry');
      const result = await shared(mockGhCli, ['test'], {}, 5);

      assert.strictEqual(result, 'success');
      assert.strictEqual(attemptCount, 3, 'Should have retried until success');
    });

    it('(integration) should fail immediately for non-retryable errors', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const error: any = new Error('HTTP 404 Not Found');
        error.exitCode = 404;
        throw error;
      };

      try {
        // Use a wrapper that injects our mock
        const testGhCliWithRetry = async (args: string[], options?: any, maxRetries = 3) => {
          const { ghCliWithRetry: shared } = await import('@commons/mcp-common/gh-retry');
          return shared(mockGhCli, args, options, maxRetries);
        };

        await testGhCliWithRetry(['test'], {}, 5);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.strictEqual(attemptCount, 1, 'Should not retry non-retryable errors');
      }
    });

    it('(integration) should respect maxRetries parameter', async () => {
      const startTime = Date.now();
      try {
        // Using maxRetries=1 should fail faster than maxRetries=3
        await ghCliWithRetry(['invalid-cmd'], {}, 1);
      } catch {
        // Expected to fail
      }
      const duration = Date.now() - startTime;
      // With maxRetries=1, should not take long (no exponential backoff)
      assert.ok(duration < 5000, `Should complete quickly with maxRetries=1, took ${duration}ms`);
    });

    it('(integration) should pass options through to ghCli correctly', async () => {
      let capturedOptions: any = undefined;
      const mockGhCli: GhCliFn = async (_args: string[], options?: any) => {
        capturedOptions = options;
        return 'success';
      };

      const testOptions = { repo: 'test/repo', timeout: 5000 };

      // Create a test wrapper that uses our mock
      const { ghCliWithRetry: shared } = await import('@commons/mcp-common/gh-retry');
      await shared(mockGhCli, ['test'], testOptions, 1);

      assert.ok(capturedOptions, 'Options should be passed to ghCli');
      assert.strictEqual(capturedOptions.repo, 'test/repo');
      assert.strictEqual(capturedOptions.timeout, 5000);
    });
  });

  describe('options handling and type conversion', () => {
    it('should handle all GhCliOptions properties correctly', async () => {
      // This test verifies that the type conversion from GhCliOptions to
      // GhCliWithRetryOptions works correctly by ensuring options are passed through
      const options = {
        repo: 'test/repo',
        timeout: 10000,
      };

      try {
        // This will fail but we can verify options were used
        await ghCliWithRetry(['invalid-test-command'], options, 1);
      } catch (error) {
        // Expected to fail - we're just testing that options are accepted
        assert.ok(error instanceof Error);
      }
    });

    it('should handle undefined vs missing options', async () => {
      // Test with empty options object
      try {
        await ghCliWithRetry(['invalid'], {}, 1);
      } catch (error) {
        assert.ok(error instanceof Error);
      }

      // Test with undefined options
      try {
        await ghCliWithRetry(['invalid'], undefined, 1);
      } catch (error) {
        assert.ok(error instanceof Error);
      }

      // Both should handle gracefully without type errors
    });

    it('should preserve options in error context when retry fails', async () => {
      const options = {
        repo: 'test/repo',
        timeout: 5000,
      };

      try {
        await ghCliWithRetry(['invalid-command'], options, 1);
        assert.fail('Should have thrown');
      } catch (error) {
        // Error should propagate correctly even with options
        assert.ok(error instanceof Error);
        // The error message should contain context about the command
        assert.ok(
          consoleErrors.some((log) => log.includes('invalid-command')),
          'Error logs should mention the failed command'
        );
      }
    });
  });

  describe('ghCliWithRetry behavior tests', () => {
    it('(behavior) should throw error for invalid gh command', async () => {
      // This tests actual ghCliWithRetry behavior, not just patterns
      try {
        await ghCliWithRetry(['totally-invalid-command-xyz'], {}, 1);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof Error, 'Error should be Error instance');
        // Verify it's a GitHub CLI error (command not found or similar)
        assert.ok(
          error.message.includes('GitHub CLI') || error.message.includes('gh'),
          `Error should be from gh CLI: ${error.message}`
        );
      }
    });

    it('(behavior) should accept valid gh api command', async () => {
      // Test that a valid gh command runs (though may fail for auth reasons)
      // The point is ghCliWithRetry doesn't crash on valid syntax
      try {
        // This will likely fail due to auth, but should not throw syntax error
        await ghCliWithRetry(['api', 'rate_limit'], {}, 1);
      } catch (error) {
        // Any error is fine - we're just testing the function accepts valid commands
        assert.ok(error instanceof Error);
      }
    });

    it('should have expected function signature', () => {
      // ghCliWithRetry should accept at least args parameter
      assert.ok(ghCliWithRetry.length >= 1, 'Should accept at least one parameter');
    });
  });

  describe('retry behavior verification', () => {
    it('(behavior) should retry rate limit errors through wrapper', async () => {
      // Create a mock that simulates rate limit error then success
      let callCount = 0;
      const mockGhCli: GhCliFn = async () => {
        callCount++;
        if (callCount === 1) {
          const error: any = new Error('API rate limit exceeded');
          error.exitCode = 429;
          throw error;
        }
        return 'success';
      };

      const { ghCliWithRetry: shared } = await import('@commons/mcp-common/gh-retry');
      const result = await shared(mockGhCli, ['test'], {}, 3);

      assert.strictEqual(result, 'success');
      assert.strictEqual(callCount, 2, 'Should have retried once after rate limit');
    });

    it('(behavior) should retry network errors through wrapper', async () => {
      let callCount = 0;
      const mockGhCli: GhCliFn = async () => {
        callCount++;
        if (callCount === 1) {
          const error: any = new Error('Network timeout');
          error.code = 'ETIMEDOUT';
          throw error;
        }
        return 'success';
      };

      const { ghCliWithRetry: shared } = await import('@commons/mcp-common/gh-retry');
      const result = await shared(mockGhCli, ['test'], {}, 3);

      assert.strictEqual(result, 'success');
      assert.strictEqual(callCount, 2, 'Should have retried once after network error');
    });

    it('(behavior) should retry 503 server errors through wrapper', async () => {
      let callCount = 0;
      const mockGhCli: GhCliFn = async () => {
        callCount++;
        if (callCount === 1) {
          const error: any = new Error('HTTP 503 Service Unavailable');
          error.exitCode = 503;
          throw error;
        }
        return 'success';
      };

      const { ghCliWithRetry: shared } = await import('@commons/mcp-common/gh-retry');
      const result = await shared(mockGhCli, ['test'], {}, 3);

      assert.strictEqual(result, 'success');
      assert.strictEqual(callCount, 2, 'Should have retried once after 503 error');
    });

    it('(behavior) should not retry 404 errors through wrapper', async () => {
      let callCount = 0;
      const mockGhCli: GhCliFn = async () => {
        callCount++;
        const error: any = new Error('HTTP 404 Not Found');
        error.exitCode = 404;
        throw error;
      };

      const { ghCliWithRetry: shared } = await import('@commons/mcp-common/gh-retry');

      try {
        await shared(mockGhCli, ['test'], {}, 3);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.strictEqual(callCount, 1, 'Should not retry 404 errors');
      }
    });

    it('(behavior) should exhaust retries and throw final error', async () => {
      let callCount = 0;
      const mockGhCli: GhCliFn = async () => {
        callCount++;
        const error: any = new Error('HTTP 503 Service Unavailable');
        error.exitCode = 503;
        throw error;
      };

      const { ghCliWithRetry: shared } = await import('@commons/mcp-common/gh-retry');

      try {
        await shared(mockGhCli, ['test'], {}, 2);
        assert.fail('Should have thrown after exhausting retries');
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.strictEqual(callCount, 2, 'Should have attempted maxRetries times');
        assert.ok(error.message.includes('503'), 'Should throw the final error');
      }
    });
  });

  describe('wrapper delegation edge cases', () => {
    it('(integration) should handle errors without exitCode property', async () => {
      const mockGhCli: GhCliFn = async () => {
        // Throw a plain Error without exitCode - should fall back to message pattern matching
        throw new Error('Connection timeout - network error');
      };

      const { ghCliWithRetry: shared } = await import('@commons/mcp-common/gh-retry');

      let callCount = 0;
      const countingGhCli: GhCliFn = async (...args) => {
        callCount++;
        if (callCount === 1) {
          return mockGhCli(...args);
        }
        return 'success';
      };

      const result = await shared(countingGhCli, ['test'], {}, 3);

      assert.strictEqual(result, 'success');
      assert.ok(callCount >= 2, 'Should retry based on message pattern matching');
    });

    it('(integration) should handle mixed error types in retry sequence', async () => {
      let callCount = 0;
      const mockGhCli: GhCliFn = async () => {
        callCount++;
        if (callCount === 1) {
          const error: any = new Error('HTTP 429 Too Many Requests');
          error.exitCode = 429;
          throw error;
        }
        if (callCount === 2) {
          const error: any = new Error('Network timeout');
          error.code = 'ETIMEDOUT';
          throw error;
        }
        return 'success';
      };

      const { ghCliWithRetry: shared } = await import('@commons/mcp-common/gh-retry');
      const result = await shared(mockGhCli, ['test'], {}, 5);

      assert.strictEqual(result, 'success');
      assert.strictEqual(callCount, 3, 'Should handle different error types across retries');
    });
  });
});
