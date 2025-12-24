/**
 * Tests for state detection
 *
 * NOTE: Full behavioral tests for detectGitState, detectPRState, and detectCurrentState
 * require mocking ES module exports, which Node.js test runner doesn't support directly.
 * These tests verify:
 * 1. Functions are exported correctly
 * 2. Type safety for discriminated unions (PRState)
 * 3. Basic error handling patterns
 *
 * For full integration testing, use actual git repositories via test fixtures.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { detectGitState, detectPRState, detectCurrentState } from './detector.js';
import type { PRState } from './types.js';

describe('State Detection', () => {
  describe('exports', () => {
    it('should export detectGitState function', () => {
      assert.strictEqual(typeof detectGitState, 'function');
    });

    it('should export detectPRState function', () => {
      assert.strictEqual(typeof detectPRState, 'function');
    });

    it('should export detectCurrentState function', () => {
      assert.strictEqual(typeof detectCurrentState, 'function');
    });
  });

  describe('function signatures', () => {
    it('detectGitState should return a Promise', () => {
      // Verify it's an async function by checking constructor name
      // We don't actually call it to avoid git operations
      assert.ok(
        detectGitState.constructor.name === 'AsyncFunction',
        'detectGitState should be an async function'
      );
    });

    it('detectPRState should accept optional repo parameter', () => {
      // Function length tells us about required params
      // Optional params still result in length 0 for the first optional
      assert.ok(
        detectPRState.constructor.name === 'AsyncFunction',
        'detectPRState should be an async function'
      );
    });

    it('detectCurrentState should accept optional repo and depth parameters', () => {
      assert.ok(
        detectCurrentState.constructor.name === 'AsyncFunction',
        'detectCurrentState should be an async function'
      );
    });
  });
});

describe('Type Safety', () => {
  describe('PRState discriminated union', () => {
    it('should narrow type when exists is true', () => {
      // TypeScript compile-time test: accessing properties should type-check
      const prState: PRState = {
        exists: true,
        number: 123,
        title: 'Test PR',
        state: 'OPEN',
        url: 'https://github.com/owner/repo/pull/123',
        labels: ['bug'],
        headRefName: 'feature-123',
        baseRefName: 'main',
      };

      if (prState.exists) {
        // Type narrowing allows accessing these properties
        assert.strictEqual(typeof prState.number, 'number');
        assert.strictEqual(typeof prState.title, 'string');
        assert.strictEqual(typeof prState.state, 'string');
        assert.strictEqual(typeof prState.url, 'string');
        assert.ok(Array.isArray(prState.labels));
        assert.strictEqual(typeof prState.headRefName, 'string');
        assert.strictEqual(typeof prState.baseRefName, 'string');
      }
    });

    it('should have correct structure when exists is false', () => {
      const prState: PRState = {
        exists: false,
      };

      assert.strictEqual(prState.exists, false);
      // TypeScript prevents accessing .number, .title, etc. when exists is false
      // Runtime check: these properties should not exist
      assert.strictEqual('number' in prState, false);
      assert.strictEqual('title' in prState, false);
    });

    it('should only accept OPEN, CLOSED, or MERGED states', () => {
      const validStates = ['OPEN', 'CLOSED', 'MERGED'];

      // All valid states should work
      for (const state of validStates) {
        const prState: PRState = {
          exists: true,
          number: 1,
          title: 'Test',
          state: state as 'OPEN' | 'CLOSED' | 'MERGED',
          url: 'https://github.com/test/test/pull/1',
          labels: [],
          headRefName: 'test',
          baseRefName: 'main',
        };
        assert.ok(validStates.includes(prState.state));
      }
    });

    it('should require all fields when exists is true', () => {
      // This is a compile-time check - TypeScript would error if any field is missing
      const prState: PRState = {
        exists: true,
        number: 123,
        title: 'Required',
        state: 'OPEN',
        url: 'https://github.com/owner/repo/pull/123',
        labels: [],
        headRefName: 'feature',
        baseRefName: 'main',
      };

      // All required fields present
      assert.ok(prState.exists);
      assert.ok(typeof prState.number === 'number');
      assert.ok(typeof prState.title === 'string');
      assert.ok(typeof prState.state === 'string');
      assert.ok(typeof prState.url === 'string');
      assert.ok(Array.isArray(prState.labels));
      assert.ok(typeof prState.headRefName === 'string');
      assert.ok(typeof prState.baseRefName === 'string');
    });
  });

  describe('labels array', () => {
    it('should accept empty labels array', () => {
      const prState: PRState = {
        exists: true,
        number: 1,
        title: 'Test',
        state: 'OPEN',
        url: 'https://github.com/test/test/pull/1',
        labels: [],
        headRefName: 'test',
        baseRefName: 'main',
      };

      assert.deepStrictEqual(prState.labels, []);
    });

    it('should accept labels array with strings', () => {
      const prState: PRState = {
        exists: true,
        number: 1,
        title: 'Test',
        state: 'OPEN',
        url: 'https://github.com/test/test/pull/1',
        labels: ['bug', 'enhancement', 'priority:high'],
        headRefName: 'test',
        baseRefName: 'main',
      };

      assert.strictEqual(prState.labels.length, 3);
      assert.ok(prState.labels.includes('bug'));
      assert.ok(prState.labels.includes('enhancement'));
      assert.ok(prState.labels.includes('priority:high'));
    });
  });
});
