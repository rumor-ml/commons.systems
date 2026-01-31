/**
 * Tests for type guard functions in types.ts
 *
 * These tests verify the type guard functions that provide type narrowing
 * for discriminated unions (IssueState, PRState).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isIssueExists,
  isIssueDoesNotExist,
  isPRExists,
  isPRDoesNotExist,
  createIssueExists,
  createIssueDoesNotExist,
  createPRExists,
  createPRDoesNotExist,
  type IssueState,
  type PRState,
} from './types.js';

describe('isIssueExists type guard', () => {
  it('should return true when state.exists is true and number exists', () => {
    const state: IssueState = createIssueExists(123);
    assert.strictEqual(isIssueExists(state), true);
  });

  it('should return false when state.exists is false', () => {
    const state: IssueState = createIssueDoesNotExist();
    assert.strictEqual(isIssueExists(state), false);
  });

  it('should narrow type to IssueExists', () => {
    const state: IssueState = createIssueExists(456);
    if (isIssueExists(state)) {
      // TypeScript should allow accessing number property
      assert.strictEqual(state.number, 456);
      assert.strictEqual(state.exists, true);
    } else {
      assert.fail('Expected isIssueExists to return true');
    }
  });

  it('should handle large issue numbers', () => {
    const state: IssueState = createIssueExists(999999);
    // Large issue numbers should work fine
    assert.strictEqual(isIssueExists(state), true);
    if (isIssueExists(state)) {
      assert.strictEqual(state.number, 999999);
    }
  });
});

describe('isIssueDoesNotExist type guard', () => {
  it('should return true when state.exists is false', () => {
    const state: IssueState = createIssueDoesNotExist();
    assert.strictEqual(isIssueDoesNotExist(state), true);
  });

  it('should return false when state.exists is true', () => {
    const state: IssueState = createIssueExists(123);
    assert.strictEqual(isIssueDoesNotExist(state), false);
  });

  it('should narrow type to IssueDoesNotExist', () => {
    const state: IssueState = createIssueDoesNotExist();
    if (isIssueDoesNotExist(state)) {
      // TypeScript should enforce that exists is false
      assert.strictEqual(state.exists, false);
      // @ts-expect-error - number should not exist on IssueDoesNotExist
      const num = state.number;
    } else {
      assert.fail('Expected isIssueDoesNotExist to return true');
    }
  });
});

describe('isPRExists type guard', () => {
  it('should return true when state.exists is true and has PR properties', () => {
    const state: PRState = createPRExists({
      state: 'OPEN',
      number: 123,
      title: 'Test PR',
      url: 'https://github.com/test/repo/pull/123',
      labels: [],
      headRefName: 'feature',
      baseRefName: 'main',
    });
    assert.strictEqual(isPRExists(state), true);
  });

  it('should return false when state.exists is false', () => {
    const state: PRState = createPRDoesNotExist();
    assert.strictEqual(isPRExists(state), false);
  });

  it('should narrow type to PRExists', () => {
    const state: PRState = createPRExists({
      state: 'OPEN',
      number: 456,
      title: 'Test',
      url: 'https://test',
      labels: [],
      headRefName: 'branch',
      baseRefName: 'main',
    });
    if (isPRExists(state)) {
      // TypeScript should allow accessing PR properties
      assert.strictEqual(state.number, 456);
      assert.strictEqual(state.state, 'OPEN');
      assert.strictEqual(state.title, 'Test');
      assert.strictEqual(state.url, 'https://test');
      assert.strictEqual(state.exists, true);
    } else {
      assert.fail('Expected isPRExists to return true');
    }
  });

  it('should work with CLOSED PR state', () => {
    const state: PRState = createPRExists({
      state: 'CLOSED',
      number: 789,
      title: 'Closed PR',
      url: 'https://github.com/test/repo/pull/789',
      labels: ['wontfix'],
      headRefName: 'old-feature',
      baseRefName: 'main',
    });
    assert.strictEqual(isPRExists(state), true);
    if (isPRExists(state)) {
      assert.strictEqual(state.state, 'CLOSED');
      assert.strictEqual(state.number, 789);
    }
  });

  it('should work with MERGED PR state', () => {
    const state: PRState = createPRExists({
      state: 'MERGED',
      number: 100,
      title: 'Merged PR',
      url: 'https://github.com/test/repo/pull/100',
      labels: [],
      headRefName: 'feature',
      baseRefName: 'main',
    });
    assert.strictEqual(isPRExists(state), true);
    if (isPRExists(state)) {
      assert.strictEqual(state.state, 'MERGED');
    }
  });
});

describe('isPRDoesNotExist type guard', () => {
  it('should return true when state.exists is false', () => {
    const state: PRState = createPRDoesNotExist();
    assert.strictEqual(isPRDoesNotExist(state), true);
  });

  it('should return false when state.exists is true', () => {
    const state: PRState = createPRExists({
      state: 'OPEN',
      number: 123,
      title: 'Test PR',
      url: 'https://github.com/test/repo/pull/123',
      labels: [],
      headRefName: 'feature',
      baseRefName: 'main',
    });
    assert.strictEqual(isPRDoesNotExist(state), false);
  });

  it('should narrow type to PRDoesNotExist', () => {
    const state: PRState = createPRDoesNotExist();
    if (isPRDoesNotExist(state)) {
      // TypeScript should enforce that exists is false
      assert.strictEqual(state.exists, false);
      // @ts-expect-error - number should not exist on PRDoesNotExist
      const num = state.number;
      // @ts-expect-error - state should not exist on PRDoesNotExist
      const prState = state.state;
    } else {
      assert.fail('Expected isPRDoesNotExist to return true');
    }
  });
});
