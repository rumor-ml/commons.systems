/**
 * Tests for error-remediation.ts utility
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { classifyGitHubError, buildGitHubErrorMessage } from './error-remediation.js';

// TODO(#313): Add negative test cases - null/undefined inputs, empty strings, edge cases

describe('classifyGitHubError', () => {
  it('should classify permission errors', () => {
    const result = classifyGitHubError('GraphQL: Forbidden (HTTP 403)');
    assert.strictEqual(result.type, 'permission');
    assert.strictEqual(result.isRetryable, false);
    assert.ok(result.remediationSteps.some((s) => s.includes('gh auth status')));
  });

  it('should classify rate limit errors', () => {
    const result = classifyGitHubError('API rate limit exceeded');
    assert.strictEqual(result.type, 'rate_limit');
    assert.strictEqual(result.isRetryable, true);
    assert.ok(result.remediationSteps[0].includes('rate limit status'));
  });

  it('should classify timeout errors', () => {
    const result = classifyGitHubError('Request timed out');
    assert.strictEqual(result.type, 'timeout');
    assert.strictEqual(result.isRetryable, true);
  });

  it('should classify network errors', () => {
    const result = classifyGitHubError('ECONNREFUSED');
    assert.strictEqual(result.type, 'network');
    assert.strictEqual(result.isRetryable, true);
    assert.ok(result.remediationSteps[0].includes('Check internet connectivity'));
  });

  it('should classify not found errors', () => {
    const result = classifyGitHubError('Resource not found (HTTP 404)');
    assert.strictEqual(result.type, 'not_found');
    assert.strictEqual(result.isRetryable, false);
  });

  it('should classify unknown errors', () => {
    const result = classifyGitHubError('Something strange happened');
    assert.strictEqual(result.type, 'unknown');
    assert.strictEqual(result.isRetryable, false);
  });

  it('should classify by exit code', () => {
    const result = classifyGitHubError('Some error', 4);
    assert.strictEqual(result.type, 'permission');
  });
});

describe('buildGitHubErrorMessage', () => {
  it('should build complete error message', () => {
    const message = buildGitHubErrorMessage('create PR', 'GraphQL: Forbidden', 1, {
      prNumber: 123,
    });

    assert.ok(message.includes('GitHub operation failed: create PR'));
    assert.ok(message.includes('Error type: permission'));
    assert.ok(message.includes('Error message: GraphQL: Forbidden'));
    assert.ok(message.includes('Exit code: 1'));
    assert.ok(message.includes('Additional context:'));
    assert.ok(message.includes('prNumber'));
    assert.ok(message.includes('How to fix:'));
  });

  it('should build message without exit code', () => {
    const message = buildGitHubErrorMessage('post comment', 'Network error');

    assert.ok(message.includes('GitHub operation failed: post comment'));
    assert.ok(message.includes('Error type: network'));
    assert.ok(!message.includes('Exit code:'));
  });

  it('should include retryable note for transient errors', () => {
    const message = buildGitHubErrorMessage('fetch data', 'Timeout');

    assert.ok(message.includes('This error is likely transient'));
  });

  it('should not include retryable note for terminal errors', () => {
    const message = buildGitHubErrorMessage('access resource', 'Forbidden');

    assert.ok(!message.includes('This error is likely transient'));
  });

  // TODO(#313): Add edge case tests - exit code precedence, HTTP 502/503/504, case-insensitive matching
  // TODO(#313): Add edge case tests for GitHub error classification
  // - Test exit code 4 as permission (precedence over message)
  // - Test HTTP 502/503/504 classification
  // - Test case-insensitive error message matching
  // - Test multiple error indicators (precedence order)
  // - Test empty error message handling
  // - Test overlapping patterns (e.g., "network timeout")

  // TODO(#313): Improve test structure verification - use line-by-line assertions instead of .includes()
  // TODO(#313): Improve test structure verification (avoid brittle string inclusion)
  // - Verify exact structure and ordering of error message sections
  // - Use line-by-line assertions instead of .includes()
  // - Consider snapshot testing for complex multi-line messages

  // TODO(#313): Add explicit tests for isRetryable flag consistency
  // - Verify all error types have correct isRetryable value
  // - Test: permission → false, rate_limit → true, timeout → true
  // - Test: network → true, not_found → false, unknown → false
});
