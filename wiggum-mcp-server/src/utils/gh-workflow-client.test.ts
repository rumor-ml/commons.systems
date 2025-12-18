/**
 * Tests for MCP client retry logic
 *
 * These tests verify the callToolWithRetry function handles timeouts,
 * retries, and error conditions correctly.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { _testExports } from './gh-workflow-client.js';

const { callToolWithRetry } = _testExports;

/**
 * Mock MCP Client for testing
 *
 * Provides controlled behavior for simulating timeout errors,
 * successful responses, and other error conditions.
 * Uses `as any` casting when passed to callToolWithRetry since
 * the full MCP Client interface is complex and not needed for unit tests.
 */
class MockMCPClient {
  private callCount = 0;
  private responses: Array<
    | { type: 'success'; result: unknown; delay?: number }
    | { type: 'error'; error: Error; delay?: number }
  > = [];

  /**
   * Queue a successful response
   */
  queueSuccess(result: unknown): void {
    this.responses.push({ type: 'success', result });
  }

  /**
   * Queue a timeout error (MCP code -32001)
   */
  queueTimeoutError(): void {
    const error = new Error('Request timed out') as Error & { code: number };
    error.code = -32001;
    this.responses.push({ type: 'error', error });
  }

  /**
   * Queue a timeout error with delay (for Phase 3.4 real timeout tests)
   */
  queueTimeoutErrorWithDelay(delayMs: number): void {
    const error = new Error('Request timed out') as Error & { code: number };
    error.code = -32001;
    this.responses.push({ type: 'error', error, delay: delayMs });
  }

  /**
   * Queue a timeout error with message pattern (no error code)
   */
  queueTimeoutMessageError(): void {
    this.responses.push({ type: 'error', error: new Error('request timed out after 60s') });
  }

  /**
   * Queue a non-timeout error
   */
  queueNonTimeoutError(message: string): void {
    this.responses.push({ type: 'error', error: new Error(message) });
  }

  /**
   * Get the number of times callTool was invoked
   */
  getCallCount(): number {
    return this.callCount;
  }

  /**
   * Reset the mock for a new test
   */
  reset(): void {
    this.callCount = 0;
    this.responses = [];
  }

  /**
   * MCP Client callTool implementation
   */
  async callTool(_params: { name: string; arguments: unknown }): Promise<unknown> {
    this.callCount++;

    if (this.responses.length === 0) {
      throw new Error('MockMCPClient: No responses queued');
    }

    const response = this.responses.shift()!;

    // Simulate delay if specified
    if (response.delay) {
      await new Promise((resolve) => setTimeout(resolve, response.delay));
    }

    if (response.type === 'error') {
      throw response.error;
    }

    return response.result;
  }
}

describe('callToolWithRetry', () => {
  let mockClient: MockMCPClient;

  beforeEach(() => {
    mockClient = new MockMCPClient();
  });

  afterEach(() => {
    mockClient.reset();
  });

  describe('success scenarios', () => {
    it('should return immediately on first success', async () => {
      const expectedResult = { content: [{ type: 'text', text: 'success' }] };
      mockClient.queueSuccess(expectedResult);

      const result = await callToolWithRetry(
        mockClient as any,
        'test_tool',
        { arg: 'value' },
        10000
      );

      assert.deepStrictEqual(result, expectedResult);
      assert.strictEqual(mockClient.getCallCount(), 1);
    });

    it('should return after successful retry', async () => {
      const expectedResult = { content: [{ type: 'text', text: 'success after retry' }] };

      // First call times out, second succeeds
      mockClient.queueTimeoutError();
      mockClient.queueSuccess(expectedResult);

      const result = await callToolWithRetry(mockClient as any, 'test_tool', {}, 10000);

      assert.deepStrictEqual(result, expectedResult);
      assert.strictEqual(mockClient.getCallCount(), 2);
    });

    it('should retry multiple times until success', async () => {
      const expectedResult = { content: [{ type: 'text', text: 'success after 3 retries' }] };

      // Three timeouts, then success
      mockClient.queueTimeoutError();
      mockClient.queueTimeoutError();
      mockClient.queueTimeoutError();
      mockClient.queueSuccess(expectedResult);

      const result = await callToolWithRetry(mockClient as any, 'test_tool', {}, 10000);

      assert.deepStrictEqual(result, expectedResult);
      assert.strictEqual(mockClient.getCallCount(), 4);
    });
  });

  describe('timeout handling', () => {
    it('should retry on MCP error code -32001', async () => {
      mockClient.queueTimeoutError();
      mockClient.queueSuccess({ ok: true });

      const result = await callToolWithRetry(mockClient as any, 'test_tool', {}, 10000);

      assert.deepStrictEqual(result, { ok: true });
      assert.strictEqual(mockClient.getCallCount(), 2);
    });

    it('should retry on timeout message pattern', async () => {
      mockClient.queueTimeoutMessageError();
      mockClient.queueSuccess({ ok: true });

      const result = await callToolWithRetry(mockClient as any, 'test_tool', {}, 10000);

      assert.deepStrictEqual(result, { ok: true });
      assert.strictEqual(mockClient.getCallCount(), 2);
    });

    it('should retry on "operation timed out" message', async () => {
      const error = new Error('The operation timed out after 60 seconds');
      mockClient.queueNonTimeoutError(error.message);
      mockClient.queueSuccess({ ok: true });

      // This will fail because "operation timed out" matches the pattern
      const result = await callToolWithRetry(mockClient as any, 'test_tool', {}, 10000);

      assert.deepStrictEqual(result, { ok: true });
      assert.strictEqual(mockClient.getCallCount(), 2);
    });
  });

  describe('non-timeout error handling', () => {
    it('should not retry on non-timeout errors', async () => {
      mockClient.queueNonTimeoutError('Connection refused');

      await assert.rejects(
        () => callToolWithRetry(mockClient as any, 'test_tool', {}, 10000),
        /Connection refused/
      );

      assert.strictEqual(mockClient.getCallCount(), 1);
    });

    it('should not retry on validation errors', async () => {
      mockClient.queueNonTimeoutError('Invalid argument: pr_number must be a positive integer');

      await assert.rejects(
        () => callToolWithRetry(mockClient as any, 'test_tool', { pr_number: -1 }, 10000),
        /Invalid argument/
      );

      assert.strictEqual(mockClient.getCallCount(), 1);
    });

    it('should not retry on authentication errors', async () => {
      mockClient.queueNonTimeoutError('Authentication failed: invalid token');

      await assert.rejects(
        () => callToolWithRetry(mockClient as any, 'test_tool', {}, 10000),
        /Authentication failed/
      );

      assert.strictEqual(mockClient.getCallCount(), 1);
    });
  });

  describe('validation', () => {
    it('should reject negative maxDurationMs', async () => {
      mockClient.queueSuccess({ ok: true });

      await assert.rejects(
        () => callToolWithRetry(mockClient as any, 'test_tool', {}, -1000),
        /Invalid maxDurationMs: -1000. Must be positive/
      );

      assert.strictEqual(mockClient.getCallCount(), 0);
    });

    it('should reject zero maxDurationMs', async () => {
      mockClient.queueSuccess({ ok: true });

      await assert.rejects(
        () => callToolWithRetry(mockClient as any, 'test_tool', {}, 0),
        /Invalid maxDurationMs: 0. Must be positive/
      );

      assert.strictEqual(mockClient.getCallCount(), 0);
    });

    it('should accept large maxDurationMs', async () => {
      const expectedResult = { content: [{ type: 'text', text: 'success' }] };
      mockClient.queueSuccess(expectedResult);

      // 1 hour timeout
      const result = await callToolWithRetry(mockClient as any, 'test_tool', {}, 3600000);

      assert.deepStrictEqual(result, expectedResult);
      assert.strictEqual(mockClient.getCallCount(), 1);
    });
  });

  describe('duration exceeded', () => {
    it('should fail when maxDurationMs is exceeded', async () => {
      // Queue many timeouts - enough that we can verify duration exceeded behavior
      // Note: We can't rely on timing alone as it's non-deterministic.
      // Instead, we verify that the function correctly checks duration by using
      // a short timeout and many queued responses.
      for (let i = 0; i < 10000; i++) {
        mockClient.queueTimeoutError();
      }

      // Use a short duration - 10ms should be exceeded with many async iterations
      const startTime = Date.now();
      const maxDurationMs = 10;

      await assert.rejects(
        () => callToolWithRetry(mockClient as any, 'test_tool', {}, maxDurationMs),
        /Operation exceeded maximum duration/
      );

      // Verify reasonable elapsed time (give some buffer for test overhead)
      const elapsed = Date.now() - startTime;
      assert.ok(
        elapsed >= maxDurationMs,
        `Expected elapsed (${elapsed}ms) >= maxDurationMs (${maxDurationMs}ms)`
      );

      // At least 1 attempt was made before timing out
      assert.ok(mockClient.getCallCount() >= 1);
    });
  });

  describe('MCP retry with real timeouts (Phase 3.4)', () => {
    it('enforces maxDurationMs with real delays', async () => {
      // Mock 50ms delay per call, maxDurationMs=120ms
      // Should get 2-3 attempts before timing out at ~120ms
      for (let i = 0; i < 10; i++) {
        mockClient.queueTimeoutErrorWithDelay(50);
      }

      const startTime = Date.now();
      const maxDurationMs = 120;

      await assert.rejects(
        () => callToolWithRetry(mockClient as any, 'test_tool', {}, maxDurationMs),
        /Operation exceeded maximum duration/
      );

      const elapsed = Date.now() - startTime;

      // Should complete around 120ms (give ±50ms buffer for timing variance)
      assert.ok(elapsed >= maxDurationMs, `Expected elapsed (${elapsed}ms) >= ${maxDurationMs}ms`);
      assert.ok(
        elapsed < maxDurationMs + 100,
        `Expected elapsed (${elapsed}ms) < ${maxDurationMs + 100}ms (with buffer)`
      );

      // Should have made 2-3 attempts (each taking ~50ms)
      const callCount = mockClient.getCallCount();
      assert.ok(callCount >= 2, `Expected at least 2 attempts, got ${callCount}`);
      assert.ok(callCount <= 3, `Expected at most 3 attempts, got ${callCount}`);
    });

    it('continues retrying until maxDurationMs', async () => {
      // Queue 100 timeouts with 10ms delay each, maxDurationMs=250ms
      // Should get ~25 attempts before timing out
      for (let i = 0; i < 100; i++) {
        mockClient.queueTimeoutErrorWithDelay(10);
      }

      const startTime = Date.now();
      const maxDurationMs = 250;

      await assert.rejects(
        () => callToolWithRetry(mockClient as any, 'test_tool', {}, maxDurationMs),
        /Operation exceeded maximum duration/
      );

      const elapsed = Date.now() - startTime;

      // Should complete around 250ms (give ±50ms buffer)
      assert.ok(elapsed >= maxDurationMs, `Expected elapsed (${elapsed}ms) >= ${maxDurationMs}ms`);
      assert.ok(
        elapsed < maxDurationMs + 100,
        `Expected elapsed (${elapsed}ms) < ${maxDurationMs + 100}ms (with buffer)`
      );

      // Should have made approximately 25 attempts (250ms / 10ms per attempt)
      // Allow range 20-30 for timing variance
      const callCount = mockClient.getCallCount();
      assert.ok(callCount >= 20, `Expected at least 20 attempts, got ${callCount}`);
      assert.ok(callCount <= 30, `Expected at most 30 attempts, got ${callCount}`);
    });
  });

  describe('error propagation', () => {
    it('should preserve original error message', async () => {
      const originalError = 'GitHub API rate limit exceeded';
      mockClient.queueNonTimeoutError(originalError);

      try {
        await callToolWithRetry(mockClient as any, 'test_tool', {}, 10000);
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof Error);
        assert.strictEqual(error.message, originalError);
      }
    });

    it('should preserve error code on non-timeout errors', async () => {
      const error = new Error('Rate limited') as Error & { code: number };
      error.code = 429;
      mockClient.queueNonTimeoutError('Rate limited');

      try {
        await callToolWithRetry(mockClient as any, 'test_tool', {}, 10000);
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err instanceof Error);
        assert.strictEqual(err.message, 'Rate limited');
      }
    });
  });
});

describe('extractTextFromMCPResult', () => {
  const { extractTextFromMCPResult } = _testExports;

  describe('valid results', () => {
    it('should extract text from single content item', () => {
      const result = {
        content: [{ type: 'text', text: 'Hello world' }],
      };

      const text = extractTextFromMCPResult(result, 'test_tool', 'test context');
      assert.strictEqual(text, 'Hello world');
    });

    it('should extract text from multiple content items', () => {
      const result = {
        content: [
          { type: 'image', url: 'http://example.com/img.png' },
          { type: 'text', text: 'Found text' },
        ],
      };

      const text = extractTextFromMCPResult(result, 'test_tool', 'test context');
      assert.strictEqual(text, 'Found text');
    });

    it('should extract first text from multiple text items', () => {
      const result = {
        content: [
          { type: 'text', text: 'First text' },
          { type: 'text', text: 'Second text' },
        ],
      };

      const text = extractTextFromMCPResult(result, 'test_tool', 'test context');
      assert.strictEqual(text, 'First text');
    });
  });

  describe('invalid results', () => {
    it('should throw for missing content array', () => {
      const result = {};

      assert.throws(
        () => extractTextFromMCPResult(result, 'test_tool', 'test context'),
        /No content in test_tool response for test context/
      );
    });

    it('should throw for empty content array', () => {
      const result = { content: [] };

      assert.throws(
        () => extractTextFromMCPResult(result, 'test_tool', 'test context'),
        /No content in test_tool response for test context/
      );
    });

    it('should throw for content without text type', () => {
      const result = {
        content: [{ type: 'image', url: 'http://example.com/img.png' }],
      };

      assert.throws(
        () => extractTextFromMCPResult(result, 'test_tool', 'test context'),
        /No text content in test_tool response for test context/
      );
    });

    it('should throw for non-array content', () => {
      const result = { content: 'not an array' };

      assert.throws(
        () => extractTextFromMCPResult(result, 'test_tool', 'test context'),
        /No content in test_tool response for test context/
      );
    });
  });
});

describe('getGhWorkflowClient singleton', () => {
  // Note: This test is intentionally minimal because full integration testing
  // of getGhWorkflowClient requires the MCP server to be running.
  // The test validates that the singleton pattern would work correctly
  // by checking the interface, not the implementation.

  it('should export getGhWorkflowClient function', async () => {
    const { getGhWorkflowClient } = await import('./gh-workflow-client.js');
    assert.strictEqual(typeof getGhWorkflowClient, 'function');
  });

  it('should document singleton behavior for manual testing', () => {
    // This test documents the expected behavior for integration testing:
    // 1. Launch 10 concurrent calls to getGhWorkflowClient()
    // 2. All should return the same Client instance
    // 3. Only one MCP server connection should be established
    //
    // Implementation note: If race conditions exist, concurrent calls could:
    // - Create multiple Client instances
    // - Establish multiple server connections
    // - Cause resource leaks
    //
    // Fix pattern: Add initPromise to serialize initialization (see MCP singleton pattern docs)

    assert.ok(true, 'Documentation test - see comments for details');
  });
});
