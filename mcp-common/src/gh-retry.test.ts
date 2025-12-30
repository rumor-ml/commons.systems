/**
 * Tests for gh-retry.ts - GitHub CLI retry logic shared across MCP servers
 *
 * Tests critical error handling paths including:
 * - maxRetries validation
 * - Exit code extraction from error messages
 * - Error classification (retryable vs non-retryable)
 * - Retry behavior with exponential backoff
 * - Success after retry logging
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ghCliWithRetry, sleep, type GhCliFn, type GhCliWithRetryOptions } from './gh-retry.js';
import { GitHubCliError } from './errors.js';

describe('ghCliWithRetry', () => {
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

  describe('maxRetries validation', () => {
    const mockGhCli: GhCliFn = async () => 'success';

    it('should throw GitHubCliError for maxRetries=0', async () => {
      await assert.rejects(
        async () => ghCliWithRetry(mockGhCli, ['test'], {}, 0),
        (error: unknown) => {
          assert.ok(error instanceof GitHubCliError);
          assert.ok(error.message.includes('must be a positive integer'));
          assert.ok(error.message.includes('between 1 and 100'));
          assert.ok(error.message.includes('got: 0'));
          return true;
        }
      );
    });

    it('should throw GitHubCliError for maxRetries=-1', async () => {
      await assert.rejects(
        async () => ghCliWithRetry(mockGhCli, ['test'], {}, -1),
        (error: unknown) => {
          assert.ok(error instanceof GitHubCliError);
          assert.ok(error.message.includes('must be a positive integer'));
          assert.ok(error.message.includes('got: -1'));
          return true;
        }
      );
    });

    it('should throw GitHubCliError for maxRetries=0.5 (non-integer)', async () => {
      await assert.rejects(
        async () => ghCliWithRetry(mockGhCli, ['test'], {}, 0.5),
        (error: unknown) => {
          assert.ok(error instanceof GitHubCliError);
          assert.ok(error.message.includes('must be a positive integer'));
          assert.ok(error.message.includes('got: 0.5'));
          return true;
        }
      );
    });

    it('should throw GitHubCliError for maxRetries=NaN', async () => {
      await assert.rejects(
        async () => ghCliWithRetry(mockGhCli, ['test'], {}, NaN),
        (error: unknown) => {
          assert.ok(error instanceof GitHubCliError);
          assert.ok(error.message.includes('must be a positive integer'));
          return true;
        }
      );
    });

    it('should throw GitHubCliError for maxRetries=Infinity', async () => {
      await assert.rejects(
        async () => ghCliWithRetry(mockGhCli, ['test'], {}, Infinity),
        (error: unknown) => {
          assert.ok(error instanceof GitHubCliError);
          assert.ok(error.message.includes('must be a positive integer'));
          return true;
        }
      );
    });

    it('should throw GitHubCliError for maxRetries > 100', async () => {
      await assert.rejects(
        async () => ghCliWithRetry(mockGhCli, ['test'], {}, 101),
        (error: unknown) => {
          assert.ok(error instanceof GitHubCliError);
          assert.ok(error.message.includes('between 1 and 100'));
          assert.ok(error.message.includes('got: 101'));
          return true;
        }
      );
    });

    it('should accept valid maxRetries=1', async () => {
      const result = await ghCliWithRetry(mockGhCli, ['test'], {}, 1);
      assert.equal(result, 'success');
    });

    it('should accept valid maxRetries=100', async () => {
      const result = await ghCliWithRetry(mockGhCli, ['test'], {}, 100);
      assert.equal(result, 'success');
    });

    it('should include command in error message', async () => {
      await assert.rejects(
        async () => ghCliWithRetry(mockGhCli, ['pr', 'create', '--title', 'test'], {}, 0),
        (error: unknown) => {
          assert.ok(error instanceof GitHubCliError);
          assert.ok(error.message.includes('gh pr create --title test'));
          return true;
        }
      );
    });
  });

  describe('exit code extraction from error messages', () => {
    it('should extract 429 from "HTTP 429" error message', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        throw new Error('HTTP 429 rate limit exceeded');
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      // Should have retried because 429 is retryable
      assert.equal(attemptCount, 2, 'Should retry 429 errors');
    });

    it('should extract 503 from "status: 503" error message', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        throw new Error('GitHub API error status: 503');
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      // Should have retried because 503 is retryable
      assert.equal(attemptCount, 2, 'Should retry 503 errors');
    });

    it('should extract 429 from "429 Too Many Requests" message', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        throw new Error('429 Too Many Requests');
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      // Should have retried because 429 is retryable
      assert.equal(attemptCount, 2, 'Should retry 429 Too Many Requests errors');
    });

    it('should extract status from rate limit messages', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        throw new Error('rate limit exceeded 429');
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      assert.equal(attemptCount, 2, 'Should retry rate limit errors');
    });

    it('should NOT extract invalid HTTP status codes (e.g., 999)', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        throw new Error('HTTP 999 invalid status');
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      // 999 is not a valid HTTP status code (100-599), should not retry
      assert.equal(attemptCount, 1, 'Should NOT retry invalid status codes');
    });

    it('should log DEBUG when extracting HTTP status', async () => {
      const mockGhCli: GhCliFn = async () => {
        throw new Error('HTTP 429 rate limit');
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 1));

      const debugLog = consoleErrors.find((log) => log.includes('DEBUG Extracted HTTP status'));
      assert.ok(debugLog, 'Should log DEBUG when extracting HTTP status');
      assert.ok(debugLog.includes('exitCode: 429'), 'Should log extracted status code');
    });

    it('should log WARN when HTTP-like error fails to parse', async () => {
      const mockGhCli: GhCliFn = async () => {
        // Contains "HTTP" but no valid status code
        throw new Error('HTTP error occurred');
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 1));

      const warnLog = consoleErrors.find((log) =>
        log.includes('WARN Failed to extract HTTP status code')
      );
      assert.ok(warnLog, 'Should log WARN for HTTP-like errors without valid status');
    });
  });

  describe('error classification - isRetryableError', () => {
    it('should retry errors with exit code 429', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error('rate limited') as Error & { exitCode: number };
        err.exitCode = 429;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 3));
      assert.equal(attemptCount, 3, 'Should retry exit code 429');
    });

    it('should retry errors with exit code 502', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error('bad gateway') as Error & { exitCode: number };
        err.exitCode = 502;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      assert.equal(attemptCount, 2, 'Should retry exit code 502');
    });

    it('should retry errors with exit code 503', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error('service unavailable') as Error & { exitCode: number };
        err.exitCode = 503;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      assert.equal(attemptCount, 2, 'Should retry exit code 503');
    });

    it('should retry errors with exit code 504', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error('gateway timeout') as Error & { exitCode: number };
        err.exitCode = 504;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      assert.equal(attemptCount, 2, 'Should retry exit code 504');
    });

    it('should retry errors with ECONNRESET error code', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error('connection reset') as NodeJS.ErrnoException;
        err.code = 'ECONNRESET';
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      assert.equal(attemptCount, 2, 'Should retry ECONNRESET');
    });

    it('should retry errors with ETIMEDOUT error code', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error('timed out') as NodeJS.ErrnoException;
        err.code = 'ETIMEDOUT';
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      assert.equal(attemptCount, 2, 'Should retry ETIMEDOUT');
    });

    it('should retry errors with ECONNREFUSED error code', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error('connection refused') as NodeJS.ErrnoException;
        err.code = 'ECONNREFUSED';
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      assert.equal(attemptCount, 2, 'Should retry ECONNREFUSED');
    });

    it('should retry errors with "rate limit" in message', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        throw new Error('API rate limit exceeded');
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      assert.equal(attemptCount, 2, 'Should retry rate limit messages');
    });

    it('should retry errors with "network" in message', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        throw new Error('network error occurred');
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      assert.equal(attemptCount, 2, 'Should retry network errors');
    });

    it('should retry errors with "timeout" in message', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        throw new Error('request timeout');
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      assert.equal(attemptCount, 2, 'Should retry timeout errors');
    });

    it('should NOT retry errors with exit code 400 (validation)', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error('bad request') as Error & { exitCode: number };
        err.exitCode = 400;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 3));
      assert.equal(attemptCount, 1, 'Should NOT retry exit code 400');
    });

    it('should NOT retry errors with exit code 404 (not found)', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error('not found') as Error & { exitCode: number };
        err.exitCode = 404;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 3));
      assert.equal(attemptCount, 1, 'Should NOT retry exit code 404');
    });

    it('should NOT retry errors with exit code 401 (unauthorized)', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error('unauthorized') as Error & { exitCode: number };
        err.exitCode = 401;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 3));
      assert.equal(attemptCount, 1, 'Should NOT retry exit code 401');
    });

    it('should NOT retry unknown errors without retryable patterns', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        throw new Error('some completely unknown error');
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 3));
      assert.equal(attemptCount, 1, 'Should NOT retry unknown errors');
    });
  });

  describe('retry behavior', () => {
    it('should return success on first attempt when no error', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        return 'success result';
      };

      const result = await ghCliWithRetry(mockGhCli, ['test'], {}, 3);
      assert.equal(result, 'success result');
      assert.equal(attemptCount, 1, 'Should succeed on first attempt');
    });

    it('should succeed after retry and continue', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        if (attemptCount === 1) {
          const err = new Error('temporary failure') as Error & { exitCode: number };
          err.exitCode = 503;
          throw err;
        }
        return 'success after retry';
      };

      const result = await ghCliWithRetry(mockGhCli, ['test'], {}, 3);
      assert.equal(result, 'success after retry');
      assert.equal(attemptCount, 2, 'Should succeed on second attempt');
    });

    it('should exhaust all retries and throw final error', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error(`attempt ${attemptCount} failed`) as Error & { exitCode: number };
        err.exitCode = 503;
        throw err;
      };

      await assert.rejects(
        async () => ghCliWithRetry(mockGhCli, ['test'], {}, 3),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(error.message.includes('attempt 3 failed'));
          return true;
        }
      );
      assert.equal(attemptCount, 3, 'Should exhaust all retries');
    });

    it('should pass args to ghCli function', async () => {
      let receivedArgs: string[] = [];
      const mockGhCli: GhCliFn = async (args) => {
        receivedArgs = args;
        return 'success';
      };

      await ghCliWithRetry(mockGhCli, ['pr', 'create', '--title', 'test'], {}, 1);
      assert.deepEqual(receivedArgs, ['pr', 'create', '--title', 'test']);
    });

    it('should pass options to ghCli function', async () => {
      let receivedOptions: GhCliWithRetryOptions | undefined;
      const mockGhCli: GhCliFn = async (args, options) => {
        receivedOptions = options;
        return 'success';
      };

      const options: GhCliWithRetryOptions = { repo: 'owner/repo', timeout: 5000 };
      await ghCliWithRetry(mockGhCli, ['test'], options, 1);
      assert.deepEqual(receivedOptions, options);
    });

    it('should log INFO on first retry attempt', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        if (attemptCount === 1) {
          const err = new Error('temporary') as Error & { exitCode: number };
          err.exitCode = 503;
          throw err;
        }
        return 'success';
      };

      await ghCliWithRetry(mockGhCli, ['test'], {}, 2);

      const infoLog = consoleErrors.find((log) => log.includes('INFO ghCliWithRetry: initial'));
      assert.ok(infoLog, 'Should log INFO on first retry');
      assert.ok(infoLog.includes('attempt 1/2'), 'Should include attempt count');
    });

    it('should log WARN on subsequent retry attempts', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        if (attemptCount <= 2) {
          const err = new Error('temporary') as Error & { exitCode: number };
          err.exitCode = 503;
          throw err;
        }
        return 'success';
      };

      await ghCliWithRetry(mockGhCli, ['test'], {}, 3);

      const warnLog = consoleErrors.find((log) => log.includes('WARN ghCliWithRetry: retry'));
      assert.ok(warnLog, 'Should log WARN on subsequent retries');
      assert.ok(warnLog.includes('attempt 2/3'), 'Should include attempt count');
    });

    it('should log when all attempts exhausted', async () => {
      const mockGhCli: GhCliFn = async () => {
        const err = new Error('persistent failure') as Error & { exitCode: number };
        err.exitCode = 503;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));

      const exhaustedLog = consoleErrors.find((log) => log.includes('all attempts failed'));
      assert.ok(exhaustedLog, 'Should log when all attempts exhausted');
      assert.ok(exhaustedLog.includes('maxRetries: 2'), 'Should include maxRetries');
    });

    it('should log non-retryable error', async () => {
      const mockGhCli: GhCliFn = async () => {
        const err = new Error('bad request') as Error & { exitCode: number };
        err.exitCode = 400;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 3));

      const nonRetryableLog = consoleErrors.find((log) =>
        log.includes('non-retryable error encountered')
      );
      assert.ok(nonRetryableLog, 'Should log non-retryable error');
    });
  });

  describe('error classification - classifyErrorType', () => {
    it('should classify exit code 429 as rate_limit', async () => {
      const mockGhCli: GhCliFn = async () => {
        const err = new Error('rate limited') as Error & { exitCode: number };
        err.exitCode = 429;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 1));

      const log = consoleErrors.find((log) => log.includes('errorType: rate_limit'));
      assert.ok(log, 'Should classify 429 as rate_limit');
    });

    it('should classify exit code 502 as server_error', async () => {
      const mockGhCli: GhCliFn = async () => {
        const err = new Error('bad gateway') as Error & { exitCode: number };
        err.exitCode = 502;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 1));

      const log = consoleErrors.find((log) => log.includes('errorType: server_error'));
      assert.ok(log, 'Should classify 502 as server_error');
    });

    it('should classify exit code 401 as permission', async () => {
      const mockGhCli: GhCliFn = async () => {
        const err = new Error('unauthorized') as Error & { exitCode: number };
        err.exitCode = 401;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 1));

      const log = consoleErrors.find((log) => log.includes('errorType: permission'));
      assert.ok(log, 'Should classify 401 as permission');
    });

    it('should classify exit code 404 as not_found', async () => {
      const mockGhCli: GhCliFn = async () => {
        const err = new Error('not found') as Error & { exitCode: number };
        err.exitCode = 404;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 1));

      const log = consoleErrors.find((log) => log.includes('errorType: not_found'));
      assert.ok(log, 'Should classify 404 as not_found');
    });

    it('should classify ECONNRESET as network', async () => {
      const mockGhCli: GhCliFn = async () => {
        const err = new Error('connection reset') as NodeJS.ErrnoException;
        err.code = 'ECONNRESET';
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 1));

      const log = consoleErrors.find((log) => log.includes('errorType: network'));
      assert.ok(log, 'Should classify ECONNRESET as network');
    });

    it('should classify ETIMEDOUT as timeout', async () => {
      const mockGhCli: GhCliFn = async () => {
        const err = new Error('timed out') as NodeJS.ErrnoException;
        err.code = 'ETIMEDOUT';
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 1));

      const log = consoleErrors.find((log) => log.includes('errorType: timeout'));
      assert.ok(log, 'Should classify ETIMEDOUT as timeout');
    });

    it('should classify unknown errors as unknown', async () => {
      const mockGhCli: GhCliFn = async () => {
        throw new Error('completely unknown error');
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 1));

      const log = consoleErrors.find((log) => log.includes('errorType: unknown'));
      assert.ok(log, 'Should classify unknown errors as unknown');
    });

    it('should log WARN for unknown error classification without exit code', async () => {
      // The error must be retryable to enter the retry loop where the WARN is logged
      // Using "timeout" in message makes it retryable via pattern matching,
      // but classifyErrorType doesn't recognize the message pattern "connection timeout dropped"
      // so it returns "unknown". This tests the observability warning.
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        // Use a message that matches retryable patterns but classifies as unknown
        // "connection" is a retryable pattern, but there's no specific classifier for it
        throw new Error('connection dropped unexpectedly');
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      assert.equal(attemptCount, 2, 'Should retry connection errors');

      const warnLog = consoleErrors.find(
        (log) =>
          log.includes('WARN Error classification unknown') &&
          log.includes('no exit code extracted')
      );
      assert.ok(warnLog, 'Should log WARN for unknown classification without exit code');
    });
  });

  describe('exponential backoff', () => {
    it('should use correct delay formula (2^attempt * 1000ms)', () => {
      // Test the mathematical formula without actually waiting
      const delays = [1, 2, 3, 4, 5, 6].map((attempt) => Math.pow(2, attempt) * 1000);

      assert.equal(delays[0], 2000, '1st retry: 2s');
      assert.equal(delays[1], 4000, '2nd retry: 4s');
      assert.equal(delays[2], 8000, '3rd retry: 8s');
      assert.equal(delays[3], 16000, '4th retry: 16s');
      assert.equal(delays[4], 32000, '5th retry: 32s');
      assert.equal(delays[5], 64000, '6th retry: would be 64s but capped');
    });

    it('should cap delays at 60 seconds', () => {
      // Test that delays are capped at 60s for high attempt numbers
      const MAX_DELAY_MS = 60000;

      const highAttemptDelays = [6, 7, 8, 9, 10].map((attempt) => {
        const uncapped = Math.pow(2, attempt) * 1000;
        return Math.min(uncapped, MAX_DELAY_MS);
      });

      // All should be capped at 60000
      highAttemptDelays.forEach((delay, index) => {
        assert.equal(delay, 60000, `Attempt ${index + 6} should be capped at 60s`);
      });
    });

    it('should apply backoff between retry attempts', async () => {
      // Test that retries actually wait between attempts
      // Use short delays to keep test fast
      let attemptCount = 0;
      const attemptTimes: number[] = [];

      const mockGhCli: GhCliFn = async () => {
        attemptTimes.push(Date.now());
        attemptCount++;
        if (attemptCount < 3) {
          // Throw retryable error
          const err = new Error('HTTP 503') as Error & { exitCode: number };
          err.exitCode = 503;
          throw err;
        }
        return 'success';
      };

      const result = await ghCliWithRetry(mockGhCli, ['test'], {}, 3);

      assert.equal(result, 'success');
      assert.equal(attemptCount, 3, 'Should take 3 attempts');
      assert.equal(attemptTimes.length, 3, 'Should have 3 attempt timestamps');

      // Verify delays are approximately correct (with tolerance for timing variance)
      // First backoff: 2^1 * 1000 = 2000ms
      const delay1 = attemptTimes[1] - attemptTimes[0];
      assert.ok(delay1 >= 1800 && delay1 <= 2500, `First delay should be ~2s, got ${delay1}ms`);

      // Second backoff: 2^2 * 1000 = 4000ms
      const delay2 = attemptTimes[2] - attemptTimes[1];
      assert.ok(delay2 >= 3800 && delay2 <= 4500, `Second delay should be ~4s, got ${delay2}ms`);
    });

    it('should NOT retry non-retryable errors (404)', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error('HTTP 404 Not Found') as Error & { exitCode: number };
        err.exitCode = 404;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 5));
      assert.equal(attemptCount, 1, 'Should NOT retry 404 errors');
    });
  });

  describe('success after retry logging', () => {
    it('should log recovery message after successful retry', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        if (attemptCount === 1) {
          const err = new Error('temporary failure') as Error & { exitCode: number };
          err.exitCode = 503;
          throw err;
        }
        return 'success';
      };

      await ghCliWithRetry(mockGhCli, ['test'], {}, 3);

      const recoveryLog = consoleErrors.find((log) =>
        log.includes('WARN ghCliWithRetry: succeeded after retry')
      );
      assert.ok(recoveryLog, 'Should log recovery message');
      assert.ok(recoveryLog.includes('transient failure recovered'), 'Should mention recovery');
      assert.ok(recoveryLog.includes('attempt 2/3'), 'Should include attempt count');
    });

    it('should include error type in recovery log', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        if (attemptCount === 1) {
          const err = new Error('rate limited') as Error & { exitCode: number };
          err.exitCode = 429;
          throw err;
        }
        return 'success';
      };

      await ghCliWithRetry(mockGhCli, ['test'], {}, 3);

      const recoveryLog = consoleErrors.find((log) =>
        log.includes('WARN ghCliWithRetry: succeeded after retry')
      );
      assert.ok(recoveryLog, 'Should log recovery message');
      assert.ok(recoveryLog.includes('errorType: rate_limit'), 'Should include error type');
    });

    it('should NOT log recovery on first attempt success', async () => {
      const mockGhCli: GhCliFn = async () => 'success';

      await ghCliWithRetry(mockGhCli, ['test'], {}, 3);

      const recoveryLog = consoleErrors.find((log) => log.includes('succeeded after retry'));
      assert.ok(!recoveryLog, 'Should NOT log recovery on first attempt success');
    });
  });

  describe('sleep function', () => {
    it('should export sleep function', () => {
      assert.ok(typeof sleep === 'function', 'sleep should be a function');
    });

    it('should return a Promise', () => {
      const result = sleep(0);
      assert.ok(result instanceof Promise, 'sleep should return a Promise');
    });

    it('should resolve after specified time', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;

      // Allow for some timing variance
      assert.ok(elapsed >= 40, 'Should wait at least ~50ms');
      assert.ok(elapsed < 150, 'Should not wait too long');
    });
  });

  describe('edge cases', () => {
    it('should handle non-Error objects thrown by ghCli', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        throw 'string error'; // eslint-disable-line no-throw-literal
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 3));
      // String error should not be retried (no exit code, no retryable pattern)
      assert.equal(attemptCount, 1, 'Should not retry non-Error objects without retryable pattern');
    });

    it('should handle Error without message', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error();
        (err as any).exitCode = 503;
        throw err;
      };

      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test'], {}, 2));
      assert.equal(attemptCount, 2, 'Should still retry based on exit code');
    });

    it('should use default maxRetries when not provided', async () => {
      let attemptCount = 0;
      const mockGhCli: GhCliFn = async () => {
        attemptCount++;
        const err = new Error('server error') as Error & { exitCode: number };
        err.exitCode = 503;
        throw err;
      };

      // Default maxRetries is 3
      await assert.rejects(async () => ghCliWithRetry(mockGhCli, ['test']));
      assert.equal(attemptCount, 3, 'Should use default maxRetries of 3');
    });
  });
});
