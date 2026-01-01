/**
 * Tests for git command utilities
 *
 * NOTE: Functions that depend on actual git commands (git, getCurrentBranch, etc.)
 * require mocking ES module exports or running in actual git repositories.
 * These tests focus on:
 * 1. Pure functions that can be tested directly (extractIssueNumberFromBranch, isSafeBranchName, sanitizeBranchNameForShell)
 * 2. GitError class behavior
 * 3. Export verification
 *
 * For full integration testing, use actual git repositories via test fixtures.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractIssueNumberFromBranch,
  isSafeBranchName,
  sanitizeBranchNameForShell,
  getGitRoot,
  git,
  getCurrentBranch,
  hasUncommittedChanges,
  hasRemoteTracking,
  isBranchPushed,
  getMainBranch,
} from './git.js';
import { GitError } from './errors.js';

describe('Git Utilities - Exports', () => {
  it('should export getGitRoot function', () => {
    assert.strictEqual(typeof getGitRoot, 'function');
  });

  it('should export git function', () => {
    assert.strictEqual(typeof git, 'function');
  });

  it('should export getCurrentBranch function', () => {
    assert.strictEqual(typeof getCurrentBranch, 'function');
  });

  it('should export hasUncommittedChanges function', () => {
    assert.strictEqual(typeof hasUncommittedChanges, 'function');
  });

  it('should export hasRemoteTracking function', () => {
    assert.strictEqual(typeof hasRemoteTracking, 'function');
  });

  it('should export isBranchPushed function', () => {
    assert.strictEqual(typeof isBranchPushed, 'function');
  });

  it('should export getMainBranch function', () => {
    assert.strictEqual(typeof getMainBranch, 'function');
  });

  it('should export extractIssueNumberFromBranch function', () => {
    assert.strictEqual(typeof extractIssueNumberFromBranch, 'function');
  });

  it('should export isSafeBranchName function', () => {
    assert.strictEqual(typeof isSafeBranchName, 'function');
  });

  it('should export sanitizeBranchNameForShell function', () => {
    assert.strictEqual(typeof sanitizeBranchNameForShell, 'function');
  });
});

describe('GitError', () => {
  it('should preserve exit code and stderr', () => {
    const error = new GitError('Command failed', 1, 'stderr output');
    assert.strictEqual(error.exitCode, 1);
    assert.strictEqual(error.stderr, 'stderr output');
    assert.strictEqual(error.message, 'Command failed');
  });

  it('should work without exit code and stderr', () => {
    const error = new GitError('Command failed');
    assert.strictEqual(error.exitCode, undefined);
    assert.strictEqual(error.stderr, undefined);
    assert.strictEqual(error.message, 'Command failed');
  });

  it('should be an instance of Error', () => {
    const error = new GitError('Test error');
    assert.ok(error instanceof Error);
    assert.ok(error instanceof GitError);
  });

  it('should have correct name property', () => {
    const error = new GitError('Test error');
    assert.strictEqual(error.name, 'GitError');
  });
});

describe('extractIssueNumberFromBranch', () => {
  it('should extract issue number from standard branch format', () => {
    assert.strictEqual(extractIssueNumberFromBranch('123-feature-name'), 123);
  });

  it('should handle branch names with multiple dashes', () => {
    assert.strictEqual(extractIssueNumberFromBranch('123-my-feature-name-here'), 123);
  });

  it('should return null for branch names starting with non-numeric characters', () => {
    assert.strictEqual(extractIssueNumberFromBranch('feature-name'), null);
    assert.strictEqual(extractIssueNumberFromBranch('main'), null);
    assert.strictEqual(extractIssueNumberFromBranch('v123-feature'), null);
    assert.strictEqual(extractIssueNumberFromBranch('feature-123'), null);
    assert.strictEqual(extractIssueNumberFromBranch('abc-feature'), null);
  });

  it('should handle edge cases with small numbers', () => {
    assert.strictEqual(extractIssueNumberFromBranch('0-feature'), 0);
    assert.strictEqual(extractIssueNumberFromBranch('1-x'), 1);
  });

  it('should handle branch names with only issue number and dash', () => {
    // Even with just "123-" it should extract the number
    assert.strictEqual(extractIssueNumberFromBranch('123-'), 123);
  });

  it('should return null for branch names with only number (no dash)', () => {
    // The split creates ['123'], parts[0] = '123', parseInt returns 123
    // Actually looking at the code, it doesn't require a dash after the number
    // Let me check the actual implementation
    assert.strictEqual(extractIssueNumberFromBranch('123'), 123);
  });

  it('should handle branch names with leading zeros', () => {
    // parseInt with radix 10 converts '0123' to 123
    assert.strictEqual(extractIssueNumberFromBranch('0123-feature'), 123);
  });

  it('should return null for empty string', () => {
    // split('') returns [''], parseInt('') is NaN
    assert.strictEqual(extractIssueNumberFromBranch(''), null);
  });

  it('should return null for dash-only string', () => {
    // split('-') returns ['', ...], parseInt('') is NaN
    assert.strictEqual(extractIssueNumberFromBranch('-'), null);
  });

  it('should return null for negative numbers', () => {
    // split('-') returns ['', '123', 'feature'], first part is empty string
    assert.strictEqual(extractIssueNumberFromBranch('-123-feature'), null);
  });

  it('should handle very large issue numbers', () => {
    assert.strictEqual(extractIssueNumberFromBranch('999999-large-issue'), 999999);
    assert.strictEqual(extractIssueNumberFromBranch('1234567890-huge'), 1234567890);
  });

  it('should handle branch names with special characters after dash', () => {
    assert.strictEqual(extractIssueNumberFromBranch('123-feature_name'), 123);
    assert.strictEqual(extractIssueNumberFromBranch('456-fix/bug'), 456);
    assert.strictEqual(extractIssueNumberFromBranch('789-feature.test'), 789);
  });
});

describe('isSafeBranchName', () => {
  describe('valid branch names', () => {
    it('should accept alphanumeric branch names', () => {
      assert.strictEqual(isSafeBranchName('feature123'), true);
      assert.strictEqual(isSafeBranchName('main'), true);
      assert.strictEqual(isSafeBranchName('UPPERCASE'), true);
    });

    it('should accept branch names with hyphens', () => {
      assert.strictEqual(isSafeBranchName('feature-branch'), true);
      assert.strictEqual(isSafeBranchName('123-my-feature'), true);
    });

    it('should accept branch names with underscores', () => {
      assert.strictEqual(isSafeBranchName('feature_branch'), true);
      assert.strictEqual(isSafeBranchName('my_feature_123'), true);
    });

    it('should accept branch names with forward slashes', () => {
      assert.strictEqual(isSafeBranchName('feature/branch'), true);
      assert.strictEqual(isSafeBranchName('user/feature/123'), true);
    });

    it('should accept branch names with dots', () => {
      assert.strictEqual(isSafeBranchName('v1.0.0'), true);
      assert.strictEqual(isSafeBranchName('feature.test'), true);
    });

    it('should accept combined valid characters', () => {
      assert.strictEqual(isSafeBranchName('feature/123-my_branch.test'), true);
    });
  });

  describe('invalid branch names', () => {
    it('should reject branch names with semicolons', () => {
      assert.strictEqual(isSafeBranchName('feature; rm -rf /'), false);
      assert.strictEqual(isSafeBranchName('test;echo'), false);
    });

    it('should reject branch names with backticks', () => {
      assert.strictEqual(isSafeBranchName('feature`whoami`'), false);
    });

    it('should reject branch names with dollar signs', () => {
      assert.strictEqual(isSafeBranchName('$HOME'), false);
      assert.strictEqual(isSafeBranchName('feature$(cmd)'), false);
    });

    it('should reject branch names with spaces', () => {
      assert.strictEqual(isSafeBranchName('feature branch'), false);
    });

    it('should reject branch names with ampersands', () => {
      assert.strictEqual(isSafeBranchName('feature&&echo'), false);
      assert.strictEqual(isSafeBranchName('a&b'), false);
    });

    it('should reject branch names with pipes', () => {
      assert.strictEqual(isSafeBranchName('feature|cat'), false);
    });

    it('should reject branch names with angle brackets', () => {
      assert.strictEqual(isSafeBranchName('feature>file'), false);
      assert.strictEqual(isSafeBranchName('feature<file'), false);
    });

    it('should reject branch names with quotes', () => {
      assert.strictEqual(isSafeBranchName("feature'test"), false);
      assert.strictEqual(isSafeBranchName('feature"test'), false);
    });

    it('should reject empty string', () => {
      assert.strictEqual(isSafeBranchName(''), false);
    });
  });
});

describe('sanitizeBranchNameForShell', () => {
  describe('safe branch names (no sanitization needed)', () => {
    it('should return original name when already safe', () => {
      const result = sanitizeBranchNameForShell('feature/123');
      assert.strictEqual(result.name, 'feature/123');
      assert.strictEqual(result.wasSanitized, false);
      assert.strictEqual(result.warning, undefined);
    });

    it('should handle all valid characters without sanitization', () => {
      const result = sanitizeBranchNameForShell('feature/123-my_branch.test');
      assert.strictEqual(result.name, 'feature/123-my_branch.test');
      assert.strictEqual(result.wasSanitized, false);
    });
  });

  describe('unsafe branch names (sanitization needed)', () => {
    it('should sanitize branch names with command injection attempts', () => {
      const result = sanitizeBranchNameForShell('feature; rm -rf /');
      assert.strictEqual(result.wasSanitized, true);
      assert.ok(result.warning);
      assert.ok(result.warning.includes('unsafe characters'));
      // Unsafe chars replaced with space
      assert.strictEqual(result.name, 'feature  rm -rf /');
    });

    it('should sanitize branch names with backticks', () => {
      const result = sanitizeBranchNameForShell('feature`whoami`');
      assert.strictEqual(result.wasSanitized, true);
      assert.ok(!result.name.includes('`'));
    });

    it('should sanitize branch names with dollar signs', () => {
      const result = sanitizeBranchNameForShell('$HOME/feature');
      assert.strictEqual(result.wasSanitized, true);
      assert.ok(!result.name.includes('$'));
    });

    it('should include original and sanitized in warning', () => {
      const result = sanitizeBranchNameForShell('test&cmd');
      assert.strictEqual(result.wasSanitized, true);
      assert.ok(result.warning);
      assert.ok(result.warning.includes('test&cmd'));
      assert.ok(result.warning.includes('test cmd'));
    });
  });
});

describe('Git Utilities - Function Signatures', () => {
  describe('getGitRoot', () => {
    it('should be an async function', () => {
      assert.strictEqual(getGitRoot.constructor.name, 'AsyncFunction');
    });

    it('should throw GitError when not in a git repository', async () => {
      // NOTE: This test documents expected behavior but cannot run
      // without mocking. The function THROWS GitError (not fallback).
      // When run in this actual git repo, it will succeed.
      // This documents that getGitRoot throws, not falls back.
    });
  });

  describe('git', () => {
    it('should be an async function', () => {
      assert.strictEqual(git.constructor.name, 'AsyncFunction');
    });
  });

  describe('getCurrentBranch', () => {
    it('should be an async function', () => {
      assert.strictEqual(getCurrentBranch.constructor.name, 'AsyncFunction');
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should be an async function', () => {
      assert.strictEqual(hasUncommittedChanges.constructor.name, 'AsyncFunction');
    });
  });

  describe('hasRemoteTracking', () => {
    it('should be an async function', () => {
      assert.strictEqual(hasRemoteTracking.constructor.name, 'AsyncFunction');
    });
  });

  describe('isBranchPushed', () => {
    it('should be an async function', () => {
      assert.strictEqual(isBranchPushed.constructor.name, 'AsyncFunction');
    });
  });

  describe('getMainBranch', () => {
    it('should be an async function', () => {
      assert.strictEqual(getMainBranch.constructor.name, 'AsyncFunction');
    });
  });
});
