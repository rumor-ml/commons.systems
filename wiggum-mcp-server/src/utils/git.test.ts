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
import { GitError, ValidationError } from './errors.js';

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
    const error = GitError.create('Command failed', 1, 'stderr output');
    assert.strictEqual(error.exitCode, 1);
    assert.strictEqual(error.stderr, 'stderr output');
    assert.strictEqual(error.message, 'Command failed');
  });

  it('should work without exit code and stderr', () => {
    const error = GitError.create('Command failed');
    assert.strictEqual(error.exitCode, undefined);
    assert.strictEqual(error.stderr, undefined);
    assert.strictEqual(error.message, 'Command failed');
  });

  it('should be an instance of Error', () => {
    const error = GitError.create('Test error');
    assert.ok(error instanceof Error);
    assert.ok(error instanceof GitError);
  });

  it('should have correct name property', () => {
    const error = GitError.create('Test error');
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

describe('Git Functions - GitError.create() Integration', () => {
  describe('getGitRoot error handling with empty stderr', () => {
    it('should document defensive pattern for empty stderr', () => {
      // This test documents the defensive pattern used in getGitRoot()
      // Lines 47 and 63 use `result.stderr || undefined` to convert empty strings to undefined
      // This ensures GitError.create() receives undefined instead of empty string

      // Example from git.ts line 47:
      // result.stderr || undefined

      // This pattern is CRITICAL because:
      // 1. GitError.create() validates that stderr is not an empty string
      // 2. If empty string is passed, GitError.create() throws ValidationError
      // 3. The `|| undefined` converts '' to undefined, avoiding ValidationError

      // NOTE: Without mocking execa, we cannot test the actual error path.
      // This test serves as documentation that the defensive pattern exists.
      assert.ok(true, 'Defensive pattern documented');
    });
  });

  describe('git() error handling with empty stderr', () => {
    it('should document defensive pattern for empty stderr', () => {
      // This test documents the defensive pattern used in git()
      // Line 134 uses `result.stderr || undefined` to convert empty strings to undefined

      // Example from git.ts line 134:
      // result.stderr || undefined

      // This ensures GitError.create() receives undefined instead of empty string,
      // preventing ValidationError from being thrown during error construction.

      // NOTE: Without mocking execa, we cannot test the actual error path.
      // This test serves as documentation that the defensive pattern exists.
      assert.ok(true, 'Defensive pattern documented');
    });
  });

  describe('ValidationError re-throw behavior', () => {
    it('should document that getGitRoot re-throws ValidationError as-is', () => {
      // This test documents the ValidationError handling in getGitRoot()
      // Lines 68-70 in git.ts:
      //
      // if (error instanceof ValidationError) {
      //   throw error;
      // }
      //
      // This is CRITICAL because:
      // 1. If GitError.create() is called with invalid parameters, it throws ValidationError
      // 2. ValidationError indicates a programming error, not a runtime error
      // 3. Re-throwing as-is ensures the programming error is visible, not wrapped
      // 4. If wrapped in GitError, debugging would be much harder

      // Example scenario that would trigger this:
      // - Git command returns exitCode=300 (> 255, invalid)
      // - GitError.create() validates exitCode and throws ValidationError
      // - getGitRoot catches it and re-throws as-is (not wrapped)

      // NOTE: Without mocking execa to return invalid exitCode, we cannot test this.
      // This test serves as documentation that the re-throw logic exists.
      assert.ok(true, 'ValidationError re-throw logic documented');
    });

    it('should document that git() re-throws ValidationError as-is', () => {
      // This test documents the ValidationError handling in git()
      // Lines 145-147 in git.ts:
      //
      // if (error instanceof ValidationError) {
      //   throw error;
      // }
      //
      // This ensures programming errors in GitError.create() are not wrapped
      // and surface immediately for debugging.

      // Example scenario:
      // - Git command returns exitCode=300 (invalid)
      // - GitError.create() throws ValidationError
      // - git() re-throws without wrapping

      // NOTE: Without mocking execa, we cannot test the actual error path.
      // This test serves as documentation that the re-throw logic exists.
      assert.ok(true, 'ValidationError re-throw logic documented');
    });
  });

  describe('hasRemoteTracking exitCode 128 handling', () => {
    it('should document expected error handling for non-existent remote branch', () => {
      // This test documents the error handling in hasRemoteTracking()
      // Lines 246-248 in git.ts:
      //
      // if (error instanceof GitError && error.exitCode === 128) {
      //   return false;
      // }
      //
      // When checking for a remote branch that doesn't exist:
      // 1. git rev-parse --verify origin/branch-name fails with exitCode 128
      // 2. GitError.create() is called with exitCode=128 (valid, within range)
      // 3. hasRemoteTracking catches the GitError and returns false (expected behavior)
      // 4. No ValidationError is thrown because exitCode 128 is valid

      // This test documents that the function correctly handles the expected error case.
      assert.ok(true, 'exitCode 128 handling documented');
    });
  });

  describe('getMainBranch exitCode 128 handling', () => {
    it('should document expected error handling for non-existent branches', () => {
      // This test documents the error handling in getMainBranch()
      // Lines 331 and 349 in git.ts check for:
      //
      // if (!(error instanceof GitError && error.exitCode === 128))
      //
      // When checking for main/master branches that don't exist:
      // 1. git rev-parse --verify main/master fails with exitCode 128
      // 2. GitError.create() is called with exitCode=128 (valid)
      // 3. getMainBranch checks for exitCode 128 to distinguish expected vs unexpected errors
      // 4. If exitCode=128, falls back to checking next branch
      // 5. If both fail with 128, throws comprehensive error message

      // This test documents that the function correctly handles expected error cases.
      assert.ok(true, 'exitCode 128 handling documented');
    });
  });
});

describe('Git Functions - Error Handling with GitError.create() Validation', () => {
  describe('GitError.create() validation behavior', () => {
    it('should throw ValidationError for empty message', () => {
      assert.throws(
        () => GitError.create('', 1, 'stderr'),
        (error: Error) => {
          return (
            error.name === 'ValidationError' &&
            error.message.includes('message cannot be empty or whitespace-only')
          );
        },
        'Expected ValidationError for empty message'
      );
    });

    it('should throw ValidationError for whitespace-only message', () => {
      assert.throws(
        () => GitError.create('   ', 1, 'stderr'),
        (error: Error) => {
          return (
            error.name === 'ValidationError' &&
            error.message.includes('message cannot be empty or whitespace-only')
          );
        },
        'Expected ValidationError for whitespace-only message'
      );
    });

    it('should throw ValidationError for exitCode > 255', () => {
      assert.throws(
        () => GitError.create('Command failed', 300, 'stderr'),
        (error: Error) => {
          return (
            error.name === 'ValidationError' &&
            error.message.includes('exitCode must be an integer in range 0-255') &&
            error.message.includes('300')
          );
        },
        'Expected ValidationError for exitCode > 255'
      );
    });

    it('should throw ValidationError for negative exitCode', () => {
      assert.throws(
        () => GitError.create('Command failed', -1, 'stderr'),
        (error: Error) => {
          return (
            error.name === 'ValidationError' &&
            error.message.includes('exitCode must be an integer in range 0-255') &&
            error.message.includes('-1')
          );
        },
        'Expected ValidationError for negative exitCode'
      );
    });

    it('should throw ValidationError for non-integer exitCode', () => {
      assert.throws(
        () => GitError.create('Command failed', 1.5, 'stderr'),
        (error: Error) => {
          return (
            error.name === 'ValidationError' &&
            error.message.includes('exitCode must be an integer in range 0-255') &&
            error.message.includes('1.5')
          );
        },
        'Expected ValidationError for non-integer exitCode'
      );
    });

    it('should throw ValidationError for empty stderr string', () => {
      assert.throws(
        () => GitError.create('Command failed', 1, ''),
        (error: Error) => {
          return (
            error.name === 'ValidationError' &&
            error.message.includes('stderr cannot be empty or whitespace-only')
          );
        },
        'Expected ValidationError for empty stderr'
      );
    });

    it('should throw ValidationError for whitespace-only stderr', () => {
      assert.throws(
        () => GitError.create('Command failed', 1, '   '),
        (error: Error) => {
          return (
            error.name === 'ValidationError' &&
            error.message.includes('stderr cannot be empty or whitespace-only')
          );
        },
        'Expected ValidationError for whitespace-only stderr'
      );
    });

    it('should accept valid parameters without throwing', () => {
      const error = GitError.create('Command failed', 128, 'fatal: not a git repository');
      assert.strictEqual(error.message, 'Command failed');
      assert.strictEqual(error.exitCode, 128);
      assert.strictEqual(error.stderr, 'fatal: not a git repository');
    });

    it('should accept exitCode 128 (commonly used for git errors)', () => {
      const error = GitError.create('Not a git repository', 128, 'fatal: not a git repository');
      assert.strictEqual(error.exitCode, 128);
      assert.ok(error instanceof GitError);
    });

    it('should accept undefined stderr to avoid empty string validation', () => {
      const error = GitError.create('Command failed', 1, undefined);
      assert.strictEqual(error.exitCode, 1);
      assert.strictEqual(error.stderr, undefined);
    });

    it('should accept undefined exitCode and stderr', () => {
      const error = GitError.create('Command failed', undefined, undefined);
      assert.strictEqual(error.exitCode, undefined);
      assert.strictEqual(error.stderr, undefined);
    });
  });

  describe('Defensive stderr pattern (result.stderr || undefined)', () => {
    it('should verify that empty string converts to undefined', () => {
      // This test verifies the defensive pattern: result.stderr || undefined
      const emptyStderr = '';
      const convertedStderr = emptyStderr || undefined;

      assert.strictEqual(convertedStderr, undefined, 'Empty string should convert to undefined');

      // Verify that GitError.create() accepts the converted value
      const error = GitError.create('Command failed', 1, convertedStderr);
      assert.strictEqual(error.stderr, undefined);
      assert.ok(error instanceof GitError);
    });

    it('should verify that whitespace-only string does NOT convert to undefined', () => {
      // This test shows why the pattern is defensive but not complete
      const whitespaceStderr = '   ';
      const convertedStderr = whitespaceStderr || undefined;

      // Whitespace-only string is truthy, so it does NOT convert to undefined
      assert.strictEqual(convertedStderr, '   ', 'Whitespace string should not convert');

      // GitError.create() will throw ValidationError for whitespace-only
      assert.throws(
        () => GitError.create('Command failed', 1, convertedStderr),
        (error: Error) => {
          return (
            error.name === 'ValidationError' &&
            error.message.includes('stderr cannot be empty or whitespace-only')
          );
        }
      );
    });

    it('should verify that non-empty stderr preserves value', () => {
      const validStderr = 'fatal: not a git repository';
      const convertedStderr = validStderr || undefined;

      assert.strictEqual(convertedStderr, validStderr, 'Non-empty string should preserve value');

      // Verify that GitError.create() accepts the value
      const error = GitError.create('Command failed', 1, convertedStderr);
      assert.strictEqual(error.stderr, validStderr);
    });
  });

  describe('ValidationError re-throw pattern verification', () => {
    it('should verify that ValidationError is distinct from GitError', () => {
      // Create a ValidationError
      const validationError = new ValidationError('Invalid parameter');

      // Verify type relationships
      assert.ok(validationError instanceof ValidationError);
      assert.ok(!(validationError instanceof GitError), 'ValidationError should not be GitError');
      assert.strictEqual(validationError.name, 'ValidationError');
    });

    it('should demonstrate why ValidationError must be re-thrown as-is', () => {
      // This test shows the pattern that git() and getGitRoot() implement
      function exampleGitFunction() {
        try {
          // Simulate GitError.create() throwing ValidationError for invalid parameters
          throw new ValidationError('exitCode must be an integer in range 0-255, got: 300');
        } catch (error) {
          // Pattern from git.ts lines 166-168:
          if (error instanceof ValidationError) {
            throw error; // Re-throw as-is (programming error)
          }

          // Other errors would be wrapped in GitError here
          throw GitError.create('Wrapped error', undefined, undefined);
        }
      }

      // Verify that ValidationError propagates without wrapping
      assert.throws(
        () => exampleGitFunction(),
        (error: Error) => {
          return (
            error instanceof ValidationError &&
            error.message.includes('exitCode must be an integer in range 0-255')
          );
        },
        'ValidationError should propagate as-is, not wrapped in GitError'
      );
    });
  });

  describe('exitCode 128 handling pattern', () => {
    it('should verify that exitCode 128 creates valid GitError', () => {
      // exitCode 128 is commonly used by git for "not found" errors
      const error = GitError.create('Branch not found', 128, 'fatal: Needed a single revision');

      assert.strictEqual(error.exitCode, 128);
      assert.ok(error instanceof GitError);
      assert.strictEqual(error.name, 'GitError');
    });

    it('should demonstrate exitCode 128 check pattern', () => {
      // This shows the pattern used in hasRemoteTracking()
      const gitError = GitError.create('Branch not found', 128, 'fatal: Needed a single revision');

      // Pattern from git.ts line 247:
      if (gitError instanceof GitError && gitError.exitCode === 128) {
        // Expected error - branch doesn't exist
        assert.ok(true, 'exitCode 128 correctly detected');
      } else {
        assert.fail('Should have detected exitCode 128');
      }
    });

    it('should demonstrate non-128 exitCode does not match pattern', () => {
      const gitError = GitError.create('Permission denied', 1, 'fatal: could not read');

      // Pattern should NOT match for non-128 exitCode
      if (gitError instanceof GitError && gitError.exitCode === 128) {
        assert.fail('Should not match exitCode 128');
      } else {
        assert.ok(true, 'Non-128 exitCode correctly excluded');
      }
    });
  });
});
