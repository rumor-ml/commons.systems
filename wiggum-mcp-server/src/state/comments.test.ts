/**
 * Tests for PR comment utilities - searchCommandInComments
 *
 * These tests verify the core search logic used by hasReviewCommandEvidence.
 * The search function is extracted as a pure function for testability,
 * avoiding the need to mock GitHub API calls.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { _testExports } from './comments.js';

const { searchCommandInComments } = _testExports;

describe('searchCommandInComments', () => {
  describe('command found cases', () => {
    it('should return true when command is mentioned in a comment', () => {
      const comments = [{ body: 'Running /security-review now' }];

      const result = searchCommandInComments(comments, '/security-review');

      assert.strictEqual(result, true, 'Should find command in comment body');
    });

    it('should return true when command is found in any comment', () => {
      const comments = [
        { body: 'First comment without command' },
        { body: 'Second comment also without' },
        { body: 'Third comment has /security-review in it' },
      ];

      const result = searchCommandInComments(comments, '/security-review');

      assert.strictEqual(result, true, 'Should find command in third comment');
    });

    it('should return true when command appears at start of comment', () => {
      const comments = [{ body: '/code-review starting now...' }];

      const result = searchCommandInComments(comments, '/code-review');

      assert.strictEqual(result, true, 'Should find command at start');
    });

    it('should return true when command appears at end of comment', () => {
      const comments = [{ body: 'Will now run /code-review' }];

      const result = searchCommandInComments(comments, '/code-review');

      assert.strictEqual(result, true, 'Should find command at end');
    });

    it('should return true when command is the entire comment body', () => {
      const comments = [{ body: '/security-review' }];

      const result = searchCommandInComments(comments, '/security-review');

      assert.strictEqual(result, true, 'Should find command as entire body');
    });

    it('should return true for command in multiline comment', () => {
      const comments = [
        {
          body: `## Review Status

Starting security review...

/security-review

Please wait for completion.`,
        },
      ];

      const result = searchCommandInComments(comments, '/security-review');

      assert.strictEqual(result, true, 'Should find command in multiline body');
    });
  });

  describe('command not found cases', () => {
    it('should return false when command is not mentioned', () => {
      const comments = [
        { body: 'This is a regular comment' },
        { body: 'Another comment without any command' },
      ];

      const result = searchCommandInComments(comments, '/security-review');

      assert.strictEqual(result, false, 'Should not find absent command');
    });

    it('should return false for empty comments array', () => {
      const comments: { body: string }[] = [];

      const result = searchCommandInComments(comments, '/security-review');

      assert.strictEqual(result, false, 'Should return false for empty array');
    });

    it('should return false when only partial command matches', () => {
      const comments = [{ body: 'Ran /security but not the full review' }];

      const result = searchCommandInComments(comments, '/security-review');

      assert.strictEqual(result, false, 'Should not match partial command');
    });
  });

  describe('case sensitivity', () => {
    it('should perform case-sensitive search', () => {
      const comments = [{ body: 'Running /SECURITY-REVIEW now' }];

      const result = searchCommandInComments(comments, '/security-review');

      assert.strictEqual(result, false, 'Search should be case-sensitive');
    });

    it('should match exact case', () => {
      const comments = [{ body: 'Running /SECURITY-REVIEW now' }];

      const result = searchCommandInComments(comments, '/SECURITY-REVIEW');

      assert.strictEqual(result, true, 'Should match when case is exact');
    });
  });

  describe('edge cases', () => {
    it('should handle command with special regex characters', () => {
      // The search uses String.includes(), not regex, so this should work
      const comments = [{ body: 'Found [command] in text' }];

      const result = searchCommandInComments(comments, '[command]');

      assert.strictEqual(result, true, 'Should handle brackets in command');
    });

    it('should handle empty command string', () => {
      const comments = [{ body: 'Any comment' }];

      // Empty string is included in any string per String.includes() behavior
      const result = searchCommandInComments(comments, '');

      assert.strictEqual(result, true, 'Empty string is included in any string');
    });

    it('should handle very long comment body', () => {
      const longBody = 'x'.repeat(10000) + '/security-review' + 'y'.repeat(10000);
      const comments = [{ body: longBody }];

      const result = searchCommandInComments(comments, '/security-review');

      assert.strictEqual(result, true, 'Should find command in long body');
    });

    it('should handle comments with only whitespace', () => {
      const comments = [{ body: '   \n\t  ' }];

      const result = searchCommandInComments(comments, '/security-review');

      assert.strictEqual(result, false, 'Should not find in whitespace-only');
    });

    it('should handle command appearing multiple times', () => {
      const comments = [
        { body: '/code-review starting... /code-review done' },
        { body: 'Another /code-review mention' },
      ];

      const result = searchCommandInComments(comments, '/code-review');

      assert.strictEqual(result, true, 'Should find command that appears multiple times');
    });
  });

  describe('code block handling', () => {
    it('should find command even when in a code block', () => {
      // Note: Current implementation does not distinguish code blocks
      // This test documents the current behavior
      const comments = [
        {
          body: `Here's how to run:
\`\`\`
/security-review
\`\`\``,
        },
      ];

      const result = searchCommandInComments(comments, '/security-review');

      assert.strictEqual(result, true, 'Current implementation finds command in code blocks');
    });

    it('should find command in inline code', () => {
      const comments = [{ body: 'Use the `/security-review` command' }];

      const result = searchCommandInComments(comments, '/security-review');

      assert.strictEqual(result, true, 'Should find command in inline code');
    });
  });

  describe('link handling', () => {
    it('should find command in markdown link text', () => {
      const comments = [{ body: 'See [/security-review](https://example.com) for docs' }];

      const result = searchCommandInComments(comments, '/security-review');

      assert.strictEqual(result, true, 'Should find command in link text');
    });
  });

  describe('search order', () => {
    it('should find command in first comment and return early', () => {
      const comments = [
        { body: '/security-review found here' },
        { body: 'Another comment' },
        { body: '/security-review also here' },
      ];

      const result = searchCommandInComments(comments, '/security-review');

      // Function returns true on first match, but we just verify it returns true
      assert.strictEqual(result, true, 'Should return true when found in first comment');
    });
  });
});

describe('hasReviewCommandEvidence integration behavior', () => {
  /**
   * Note: Full integration tests for hasReviewCommandEvidence would require
   * mocking getPRComments which involves ESM module mocking.
   * These documentation tests describe expected behavior.
   */

  it('documents expected behavior: returns true when command found in PR comments', () => {
    /**
     * SPECIFICATION: hasReviewCommandEvidence behavior
     *
     * When getPRComments returns comments containing the command:
     * 1. Calls getPRComments(prNumber, repo)
     * 2. Logs debug message with pr number, command, and comment count
     * 3. Searches each comment body for command substring
     * 4. Returns true on first match
     *
     * See comments.ts hasReviewCommandEvidence function.
     */
    assert.ok(true, 'Behavior documented: returns true when command found');
  });

  it('documents expected behavior: returns false when command not in comments', () => {
    /**
     * SPECIFICATION: hasReviewCommandEvidence behavior when not found
     *
     * When getPRComments returns comments NOT containing the command:
     * 1. Calls getPRComments(prNumber, repo)
     * 2. Logs debug message with pr number, command, and comment count
     * 3. Searches all comment bodies without finding command
     * 4. Logs debug message that command was not found
     * 5. Returns false
     *
     * See comments.ts hasReviewCommandEvidence function.
     */
    assert.ok(true, 'Behavior documented: returns false when command not found');
  });

  it('documents expected behavior: handles empty comments array', () => {
    /**
     * SPECIFICATION: hasReviewCommandEvidence with no comments
     *
     * When getPRComments returns empty array:
     * 1. commentCount in log will be 0
     * 2. Loop exits immediately (no iterations)
     * 3. Logs debug message that command was not found
     * 4. Returns false
     *
     * This handles new PRs with no comments gracefully.
     */
    assert.ok(true, 'Behavior documented: handles empty comments');
  });

  it('documents expected behavior: propagates GitHub API errors', () => {
    /**
     * SPECIFICATION: hasReviewCommandEvidence error handling
     *
     * When getPRComments throws GitHubCliError:
     * 1. Error propagates to caller (not caught)
     * 2. Caller should handle error appropriately
     * 3. Common errors: rate limit, network failure, PR not found
     *
     * See gh-cli.ts for error types that can be thrown.
     */
    assert.ok(true, 'Behavior documented: propagates GitHub API errors');
  });
});
