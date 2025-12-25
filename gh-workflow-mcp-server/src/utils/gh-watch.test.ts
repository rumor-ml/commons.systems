/**
 * Unit tests for GitHub CLI watch utilities
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { getCheckIcon, determineOverallStatus } from './gh-watch.js';

describe('determineOverallStatus', () => {
  test('returns SUCCESS when all checks succeed', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'success' },
    ];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'SUCCESS');
    assert.strictEqual(result.successCount, 2);
    assert.strictEqual(result.failureCount, 0);
    assert.strictEqual(result.otherCount, 0);
  });

  test('returns FAILED when any check fails', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'failure' },
    ];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(result.successCount, 1);
    assert.strictEqual(result.failureCount, 1);
    assert.strictEqual(result.otherCount, 0);
  });

  test('counts timed_out as failure', () => {
    const checks = [{ name: 'test', status: 'completed', conclusion: 'timed_out' }];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(result.failureCount, 1);
  });

  test('returns MIXED when checks have neither all success nor any failure', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'skipped' },
    ];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'MIXED');
    assert.strictEqual(result.successCount, 1);
    assert.strictEqual(result.failureCount, 0);
    assert.strictEqual(result.otherCount, 1);
  });

  test('handles empty checks array', () => {
    const checks: any[] = [];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'SUCCESS');
    assert.strictEqual(result.successCount, 0);
    assert.strictEqual(result.failureCount, 0);
    assert.strictEqual(result.otherCount, 0);
  });

  test('handles multiple failures correctly', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'failure' },
      { name: 'lint', status: 'completed', conclusion: 'failure' },
      { name: 'build', status: 'completed', conclusion: 'success' },
    ];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'FAILED');
    assert.strictEqual(result.successCount, 1);
    assert.strictEqual(result.failureCount, 2);
    assert.strictEqual(result.otherCount, 0);
  });

  test('handles cancelled conclusions as other', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'success' },
      { name: 'lint', status: 'completed', conclusion: 'cancelled' },
    ];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'MIXED');
    assert.strictEqual(result.successCount, 1);
    assert.strictEqual(result.failureCount, 0);
    assert.strictEqual(result.otherCount, 1);
  });

  test('handles all checks cancelled', () => {
    const checks = [
      { name: 'test', status: 'completed', conclusion: 'cancelled' },
      { name: 'lint', status: 'completed', conclusion: 'cancelled' },
    ];

    const result = determineOverallStatus(checks);

    assert.strictEqual(result.status, 'MIXED');
    assert.strictEqual(result.successCount, 0);
    assert.strictEqual(result.failureCount, 0);
    assert.strictEqual(result.otherCount, 2);
  });
});

describe('getCheckIcon', () => {
  test('returns ✓ for success', () => {
    assert.strictEqual(getCheckIcon('success'), '✓');
  });

  test('returns ✗ for failure', () => {
    assert.strictEqual(getCheckIcon('failure'), '✗');
  });

  test('returns ✗ for timed_out', () => {
    assert.strictEqual(getCheckIcon('timed_out'), '✗');
  });

  test('returns ○ for cancelled', () => {
    assert.strictEqual(getCheckIcon('cancelled'), '○');
  });

  test('returns ○ for skipped', () => {
    assert.strictEqual(getCheckIcon('skipped'), '○');
  });

  test('returns ○ for null conclusion', () => {
    assert.strictEqual(getCheckIcon(null), '○');
  });

  test('returns ○ for unknown conclusions (fallback)', () => {
    assert.strictEqual(getCheckIcon('unknown_conclusion'), '○');
  });

  test('returns ○ for action_required', () => {
    assert.strictEqual(getCheckIcon('action_required'), '○');
  });
});
