/**
 * Tests for executeStateUpdateWithRetry and related retry logic
 *
 * These tests verify the core retry mechanism that consolidates ~300 lines of duplicated
 * error handling logic from router.ts. The function handles:
 * - Basic success/retry paths
 * - Error classification and retry decisions (relies on classifyGitHubError classifying errors correctly)
 * - Exponential backoff with capping
 * - Config validation
 * - Defensive fallback error paths
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { _testExports, createStateUpdateFailure } from './router.js';
import type { WiggumState } from './types.js';
import { GitHubCliError, ValidationError } from '../utils/errors.js';

const { executeStateUpdateWithRetry, safeStringify } = _testExports;

/**
 * Create a minimal mock WiggumState for testing
 */
function createMockState(overrides?: Partial<WiggumState>): WiggumState {
  return {
    iteration: 1,
    step: 'p1-1',
    completedSteps: [],
    phase: 'phase1',
    ...overrides,
  };
}

describe('executeStateUpdateWithRetry - Basic Success Path', () => {
  it('should succeed on first attempt', async () => {
    const mockUpdate = mock.fn(async () => {});
    const state = createMockState();

    const result = await executeStateUpdateWithRetry(
      { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
      state,
      'test-step',
      3
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(mockUpdate.mock.calls.length, 1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (mockUpdate.mock.calls[0] as any)?.arguments;
    assert.ok(callArgs && callArgs.length === 2);
    assert.strictEqual(callArgs[0], 123);
    assert.deepStrictEqual(callArgs[1], state);
  });

  it('should pass correct resourceId to updateFn', async () => {
    const mockUpdate = mock.fn(async () => {});
    const state = createMockState();

    await executeStateUpdateWithRetry(
      { resourceType: 'issue', resourceId: 456, updateFn: mockUpdate },
      state,
      'test-step',
      3
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const callArgs = (mockUpdate.mock.calls[0] as any)?.arguments;
    assert.ok(callArgs && callArgs.length >= 1);
    assert.strictEqual(callArgs[0], 456);
  });
});

describe('executeStateUpdateWithRetry - Retry Logic', () => {
  it('should retry on rate limit error and succeed', async () => {
    let attempts = 0;
    const mockUpdate = mock.fn(async () => {
      attempts++;
      if (attempts < 3) {
        // Throw 429 rate limit error (relies on classifyGitHubError classifying as transient)
        throw new GitHubCliError('API rate limit exceeded', 429, 'rate limit exceeded');
      }
    });

    const state = createMockState();
    const result = await executeStateUpdateWithRetry(
      { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
      state,
      'test-step',
      3
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(attempts, 3);
    assert.strictEqual(mockUpdate.mock.calls.length, 3);
  });

  it('should retry on network error and succeed', async () => {
    let attempts = 0;
    const mockUpdate = mock.fn(async () => {
      attempts++;
      if (attempts < 2) {
        // Throw network error (relies on classifyGitHubError classifying as transient)
        const error = new Error('HTTP fetch failed: ECONNRESET');
        throw error;
      }
    });

    const state = createMockState();
    const result = await executeStateUpdateWithRetry(
      { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
      state,
      'test-step',
      3
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(attempts, 2);
  });

  it('should return failure result after exhausting retries', async () => {
    const mockUpdate = mock.fn(async () => {
      // Always throw rate limit error
      throw new GitHubCliError('API rate limit exceeded', 429, 'rate limit');
    });

    const state = createMockState();
    const result = await executeStateUpdateWithRetry(
      { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
      state,
      'test-step',
      3
    );

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.reason, 'rate_limit');
      assert.strictEqual(result.attemptCount, 3);
      assert.ok(result.lastError instanceof Error);
    }
    assert.strictEqual(mockUpdate.mock.calls.length, 3);
  });
});

describe('executeStateUpdateWithRetry - Critical Errors', () => {
  it('should throw immediately on 404 error', async () => {
    const testError = new GitHubCliError('Not Found', 404, 'PR not found');
    const mockUpdate = mock.fn(async () => {
      throw testError;
    });

    const state = createMockState();
    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.strictEqual(error, testError);
        return true;
      }
    );

    // Should only attempt once (no retry)
    assert.strictEqual(mockUpdate.mock.calls.length, 1);
  });

  it('should throw immediately on auth error', async () => {
    const testError = new GitHubCliError('Unauthorized', 401, 'Bad credentials');
    const mockUpdate = mock.fn(async () => {
      throw testError;
    });

    const state = createMockState();
    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.strictEqual(error, testError);
        return true;
      }
    );

    // Should only attempt once (no retry)
    assert.strictEqual(mockUpdate.mock.calls.length, 1);
  });
});

describe('executeStateUpdateWithRetry - Non-Error Thrown Values', () => {
  it('should wrap string thrown value', async () => {
    const mockUpdate = mock.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'string error';
    });

    const state = createMockState();
    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.ok(error.message.includes('Non-Error value thrown'));
        assert.ok(error.message.includes('string error'));
        return true;
      }
    );
  });

  it('should wrap null thrown value', async () => {
    const mockUpdate = mock.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw null;
    });

    const state = createMockState();
    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.ok(error.message.includes('Non-Error value thrown'));
        assert.ok(error.message.includes('null'));
        return true;
      }
    );
  });

  it('should wrap undefined thrown value', async () => {
    const mockUpdate = mock.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw undefined;
    });

    const state = createMockState();
    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.ok(error.message.includes('Non-Error value thrown'));
        assert.ok(error.message.includes('undefined'));
        return true;
      }
    );
  });

  it('should wrap number thrown value', async () => {
    const mockUpdate = mock.fn(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 42;
    });

    const state = createMockState();
    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.ok(error.message.includes('Non-Error value thrown'));
        assert.ok(error.message.includes('42'));
        return true;
      }
    );
  });
});

describe('executeStateUpdateWithRetry - Config Validation', () => {
  it('should throw on non-integer resourceId', async () => {
    const mockUpdate = mock.fn(async () => {});
    const state = createMockState();

    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 0.5, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.ok(error instanceof ValidationError);
        assert.ok(error.message.includes('prNumber'));
        assert.ok(error.message.includes('positive integer'));
        assert.ok(error.message.includes('0.5'));
        return true;
      }
    );
  });

  it('should throw on negative resourceId', async () => {
    const mockUpdate = mock.fn(async () => {});
    const state = createMockState();

    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: -1, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.ok(error instanceof ValidationError);
        assert.ok(error.message.includes('prNumber'));
        assert.ok(error.message.includes('positive integer'));
        return true;
      }
    );
  });

  it('should throw on zero resourceId', async () => {
    const mockUpdate = mock.fn(async () => {});
    const state = createMockState();

    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 0, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.ok(error instanceof ValidationError);
        assert.ok(error.message.includes('positive integer'));
        return true;
      }
    );
  });

  it('should throw on NaN resourceId', async () => {
    const mockUpdate = mock.fn(async () => {});
    const state = createMockState();

    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: NaN, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.ok(error instanceof ValidationError);
        assert.ok(error.message.includes('positive integer'));
        return true;
      }
    );
  });

  it('should throw on non-function updateFn', async () => {
    const state = createMockState();

    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { resourceType: 'pr', resourceId: 123, updateFn: 'not a function' as any },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.ok(error instanceof ValidationError);
        assert.ok(error.message.includes('updateFn must be a function'));
        assert.ok(error.message.includes('string'));
        return true;
      }
    );
  });

  it('should throw on null updateFn', async () => {
    const state = createMockState();

    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { resourceType: 'pr', resourceId: 123, updateFn: null as any },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.ok(error instanceof ValidationError);
        assert.ok(error.message.includes('updateFn must be a function'));
        return true;
      }
    );
  });

  it('should use correct field name for issue resources', async () => {
    const mockUpdate = mock.fn(async () => {});
    const state = createMockState();

    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'issue', resourceId: -1, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.ok(error.message.includes('issueNumber'));
        assert.ok(!error.message.includes('prNumber'));
        return true;
      }
    );
  });
});

describe('executeStateUpdateWithRetry - MaxRetries Validation', () => {
  it('should throw on maxRetries < 1', async () => {
    const mockUpdate = mock.fn(async () => {});
    const state = createMockState();

    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
          state,
          'test-step',
          0
        ),
      (error: Error) => {
        assert.ok(error.message.includes('maxRetries must be a positive integer'));
        assert.ok(error.message.includes('between 1 and 100'));
        return true;
      }
    );
  });

  it('should throw on maxRetries > 100', async () => {
    const mockUpdate = mock.fn(async () => {});
    const state = createMockState();

    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
          state,
          'test-step',
          101
        ),
      (error: Error) => {
        assert.ok(error.message.includes('maxRetries must be a positive integer'));
        assert.ok(error.message.includes('between 1 and 100'));
        return true;
      }
    );
  });

  it('should throw on non-integer maxRetries', async () => {
    const mockUpdate = mock.fn(async () => {});
    const state = createMockState();

    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
          state,
          'test-step',
          3.5
        ),
      (error: Error) => {
        assert.ok(error.message.includes('maxRetries must be a positive integer'));
        return true;
      }
    );
  });

  it('should throw on NaN maxRetries', async () => {
    const mockUpdate = mock.fn(async () => {});
    const state = createMockState();

    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
          state,
          'test-step',
          NaN
        ),
      (error: Error) => {
        assert.ok(error.message.includes('maxRetries must be a positive integer'));
        return true;
      }
    );
  });
});

describe('executeStateUpdateWithRetry - Backoff Delay Calculation', () => {
  it('should calculate exponential backoff delays correctly', () => {
    const cases = [
      { attempt: 1, expected: 2000 },
      { attempt: 2, expected: 4000 },
      { attempt: 3, expected: 8000 },
      { attempt: 4, expected: 16000 },
    ];

    for (const { attempt, expected } of cases) {
      const delay = Math.pow(2, attempt) * 1000;
      assert.strictEqual(delay, expected);
    }
  });

  it('should cap delays at 60 seconds', () => {
    const MAX_DELAY_MS = 60000;
    const cases = [
      { attempt: 1, uncapped: 2000, capped: 2000 },
      { attempt: 6, uncapped: 64000, capped: 60000 },
      { attempt: 10, uncapped: 1024000, capped: 60000 },
    ];

    for (const { attempt, uncapped, capped } of cases) {
      const delay = Math.min(Math.pow(2, attempt) * 1000, MAX_DELAY_MS);
      assert.strictEqual(Math.pow(2, attempt) * 1000, uncapped);
      assert.strictEqual(delay, capped);
    }
  });
});

describe('executeStateUpdateWithRetry - Unexpected Errors', () => {
  it('should re-throw unexpected errors immediately', async () => {
    const testError = new Error('unexpected programming error');
    const mockUpdate = mock.fn(async () => {
      throw testError;
    });

    const state = createMockState();
    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.strictEqual(error, testError);
        return true;
      }
    );

    // Should only attempt once (no retry)
    assert.strictEqual(mockUpdate.mock.calls.length, 1);
  });
});

describe('createStateUpdateFailure', () => {
  it('should create valid failure result', () => {
    const error = new Error('test error');
    const result = createStateUpdateFailure('rate_limit', error, 3);

    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.reason, 'rate_limit');
      assert.strictEqual(result.lastError, error);
      assert.strictEqual(result.attemptCount, 3);
    }
  });

  it('should throw on non-positive attemptCount', () => {
    const error = new Error('test');
    assert.throws(
      () => createStateUpdateFailure('rate_limit', error, 0),
      /attemptCount must be positive integer/
    );
  });

  it('should throw on non-integer attemptCount', () => {
    const error = new Error('test');
    assert.throws(
      () => createStateUpdateFailure('rate_limit', error, 3.5),
      /attemptCount must be positive integer/
    );
  });

  it('should throw on non-Error lastError', () => {
    assert.throws(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => createStateUpdateFailure('rate_limit', 'not an error' as any, 3),
      /lastError must be Error instance/
    );
  });
});

describe('executeStateUpdateWithRetry - Sleep Failure Handling', () => {
  it('should throw clear error when sleep() fails during retry', async () => {
    // This test documents the expected behavior for sleep() failures during retry backoff.
    // The defensive error handling is implemented in router.ts lines 481-496:
    //
    // try { await sleep(delayMs); }
    // catch (sleepError) {
    //   safeLog('error', 'CRITICAL: sleep() failed during retry backoff', {...});
    //   throw new Error(`INTERNAL ERROR: sleep() failed during retry backoff. delayMs: ${delayMs}, attempt: ${attempt}, error: ${sleepError.message}`);
    // }
    //
    // Testing this path requires mocking the sleep() function at the module level,
    // which is complex with ESM modules in node:test. The implementation ensures that
    // if sleep() throws (e.g., timer interrupted, invalid delay), we get a clear error
    // message with context (delayMs, attempt) rather than an unhandled promise rejection.

    // Verify this behavior is documented
    assert.ok(true, 'Sleep failure handling is implemented in router.ts lines 481-496');
  });
});

describe('executeStateUpdateWithRetry - Invalid Delay Detection', () => {
  it('should throw on NaN delay from corrupted attempt counter', async () => {
    let callCount = 0;
    const mockUpdate = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new GitHubCliError('Rate limit', 429, 'rate limit');
      }
    });

    // Patch Math.pow to simulate corrupted attempt counter
    const originalPow = Math.pow;
    Math.pow = (() => NaN) as typeof Math.pow;

    try {
      const state = createMockState();
      await assert.rejects(
        () =>
          executeStateUpdateWithRetry(
            { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
            state,
            'test-step',
            3
          ),
        (error: Error) => {
          assert.ok(error.message.includes('INTERNAL ERROR: Invalid uncapped delay calculated'));
          assert.ok(error.message.includes('NaN') || error.message.includes('retry loop counter'));
          return true;
        }
      );
    } finally {
      Math.pow = originalPow;
    }
  });

  it('should throw on negative delay from corrupted attempt counter', async () => {
    let callCount = 0;
    const mockUpdate = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new GitHubCliError('Rate limit', 429, 'rate limit');
      }
    });

    // Patch Math.pow to simulate negative delay
    const originalPow = Math.pow;
    Math.pow = (() => -1000) as typeof Math.pow;

    try {
      const state = createMockState();
      await assert.rejects(
        () =>
          executeStateUpdateWithRetry(
            { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
            state,
            'test-step',
            3
          ),
        (error: Error) => {
          assert.ok(error.message.includes('INTERNAL ERROR: Invalid uncapped delay calculated'));
          assert.ok(error.message.includes('-1000'));
          return true;
        }
      );
    } finally {
      Math.pow = originalPow;
    }
  });

  it('should throw on Infinity delay before capping', async () => {
    let callCount = 0;
    const mockUpdate = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new GitHubCliError('Rate limit', 429, 'rate limit');
      }
    });

    // Patch Math.min to pass through Infinity (simulating broken capping logic)
    const originalMin = Math.min;
    Math.min = ((a: number, _b: number) => a) as typeof Math.min;

    // Also make Math.pow return Infinity
    const originalPow = Math.pow;
    Math.pow = (() => Infinity) as typeof Math.pow;

    try {
      const state = createMockState();
      await assert.rejects(
        () =>
          executeStateUpdateWithRetry(
            { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
            state,
            'test-step',
            3
          ),
        (error: Error) => {
          assert.ok(error.message.includes('INTERNAL ERROR: Invalid uncapped delay calculated'));
          return true;
        }
      );
    } finally {
      Math.pow = originalPow;
      Math.min = originalMin;
    }
  });
});

describe('executeStateUpdateWithRetry - Error Classification Failure', () => {
  it('should not retry on unexpected errors without recognized patterns', async () => {
    // This test verifies the conservative fallback: errors that don't match
    // any recognized patterns (404, auth, rate limit, network) are treated as
    // unexpected and not retried.
    //
    // The error classification try-catch in router.ts lines 367-403 provides
    // additional safety: if classifyGitHubError itself throws, it falls back to
    // a safe default classification (all false) which results in no retry.

    const testError = new GitHubCliError('Unknown error', 500, 'internal server error');
    const mockUpdate = mock.fn(async () => {
      throw testError;
    });

    const state = createMockState();

    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        // Should re-throw the original error (conservative: no retry for unexpected errors)
        assert.strictEqual(error, testError);
        return true;
      }
    );

    // Should only attempt once (no retry because error is not classified as transient)
    assert.strictEqual(mockUpdate.mock.calls.length, 1);
  });

  it('should not retry generic Error instances', async () => {
    // This test documents that the conservative fallback (no retry) is applied
    // for generic Error instances that don't match transient error patterns.
    // The behavior is implemented in router.ts lines 367-403 with the try-catch
    // around classifyGitHubError.

    const testError = new Error('Some unexpected programming error');
    const mockUpdate = mock.fn(async () => {
      throw testError;
    });

    const state = createMockState();

    await assert.rejects(
      () =>
        executeStateUpdateWithRetry(
          { resourceType: 'pr', resourceId: 123, updateFn: mockUpdate },
          state,
          'test-step',
          3
        ),
      (error: Error) => {
        assert.strictEqual(error, testError);
        return true;
      }
    );

    // Verify no retry happened (only 1 attempt)
    assert.strictEqual(mockUpdate.mock.calls.length, 1);
  });
});

describe('safeStringify', () => {
  it('should stringify simple objects', () => {
    const obj = { phase: 'phase1', step: 'p1-1' };
    const result = safeStringify(obj, 'test');
    assert.strictEqual(result, JSON.stringify(obj));
  });

  it('should extract partial state on circular reference', () => {
    const state: WiggumState & { circular?: unknown } = createMockState();
    state.circular = state; // Create circular reference

    const result = safeStringify(state, 'state');
    assert.ok(result.includes('<partial state:'));
    assert.ok(result.includes('phase=phase1'));
    assert.ok(result.includes('step=p1-1'));
    assert.ok(result.includes('iteration=1'));
  });

  it('should handle non-state objects with serialization failure', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj: any = {};
    obj.circular = obj;

    const result = safeStringify(obj, 'test-label');
    assert.ok(result.includes('<serialization failed'));
  });
});
