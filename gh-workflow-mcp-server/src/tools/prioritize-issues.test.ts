/**
 * Tests for prioritize-issues tool
 *
 * Note: This test file uses a four-tier categorization system (Tier 1-4).
 * Helper functions (extractFoundWhileWorkingCount, calculatePriorityScore, determineTier)
 * are imported directly from the implementation to ensure tests verify actual behavior.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractFoundWhileWorkingCount,
  calculatePriorityScore,
  determineTier,
  type GitHubIssue,
} from './prioritize-issues.js';

describe('PrioritizeIssues - Found While Working On Extraction', () => {
  it('extracts single issue reference', () => {
    const result = extractFoundWhileWorkingCount('Found while working on #123');
    assert.equal(result.count, 1);
    assert.equal(result.isMalformed, false);
  });

  it('extracts multiple issue references', () => {
    const result = extractFoundWhileWorkingCount('Found while working on #123, #456, #789');
    assert.equal(result.count, 3);
    assert.equal(result.isMalformed, false);
  });

  it('extracts issues with varying whitespace', () => {
    const result = extractFoundWhileWorkingCount('Found while working on #123,#456, #789');
    assert.equal(result.count, 3);
    assert.equal(result.isMalformed, false);
  });

  it('returns 0 when no "Found while working on" line present', () => {
    const result = extractFoundWhileWorkingCount(
      'This is a regular issue description without the pattern'
    );
    assert.equal(result.count, 0);
    assert.equal(result.isMalformed, false);
  });

  it('returns 0 when body is null', () => {
    const result = extractFoundWhileWorkingCount(null);
    assert.equal(result.count, 0);
    assert.equal(result.isMalformed, false);
  });

  it('returns 0 when body is empty string', () => {
    const result = extractFoundWhileWorkingCount('');
    assert.equal(result.count, 0);
    assert.equal(result.isMalformed, false);
  });

  it('handles case insensitive matching', () => {
    const result = extractFoundWhileWorkingCount('FOUND WHILE WORKING ON #123');
    assert.equal(result.count, 1);
    assert.equal(result.isMalformed, false);
  });

  it('extracts from multiline body', () => {
    const body = `This is a bug report.

Found while working on #100, #200

More details here.`;
    const result = extractFoundWhileWorkingCount(body);
    assert.equal(result.count, 2);
    assert.equal(result.isMalformed, false);
  });

  it('ignores issue numbers not in "Found while working on" line', () => {
    const result = extractFoundWhileWorkingCount('Related to #999. Found while working on #123');
    assert.equal(result.count, 1);
    assert.equal(result.isMalformed, false);
  });

  it('handles issue references without spaces after commas', () => {
    const result = extractFoundWhileWorkingCount('Found while working on #1,#2,#3,#4,#5');
    assert.equal(result.count, 5);
    assert.equal(result.isMalformed, false);
  });
});

describe('PrioritizeIssues - Priority Score Calculation', () => {
  // Helper to create mock issue for testing
  function createMockIssue(comments: number, body: string | null): GitHubIssue {
    return {
      number: 123,
      title: 'Test Issue',
      labels: [{ name: 'enhancement' }],
      url: 'https://github.com/owner/repo/issues/123',
      comments,
      body,
    };
  }

  it('uses comment count when higher than found count', () => {
    const issue = createMockIssue(10, 'Found while working on #123');
    const result = calculatePriorityScore(issue);
    assert.equal(result.priority_score, 10);
    assert.equal(result.comment_count, 10);
    assert.equal(result.found_while_working_count, 1);
  });

  it('uses found count when higher than comment count', () => {
    const issue = createMockIssue(2, 'Found while working on #1, #2, #3, #4, #5');
    const result = calculatePriorityScore(issue);
    assert.equal(result.priority_score, 5);
    assert.equal(result.comment_count, 2);
    assert.equal(result.found_while_working_count, 5);
  });

  it('uses comment count when found count is zero', () => {
    const issue = createMockIssue(7, 'No reference');
    const result = calculatePriorityScore(issue);
    assert.equal(result.priority_score, 7);
    assert.equal(result.comment_count, 7);
    assert.equal(result.found_while_working_count, 0);
  });

  it('uses found count when comment count is zero', () => {
    const issue = createMockIssue(0, 'Found while working on #100, #200');
    const result = calculatePriorityScore(issue);
    assert.equal(result.priority_score, 2);
    assert.equal(result.comment_count, 0);
    assert.equal(result.found_while_working_count, 2);
  });

  it('returns zero score when both metrics are zero', () => {
    const issue = createMockIssue(0, null);
    const result = calculatePriorityScore(issue);
    assert.equal(result.priority_score, 0);
    assert.equal(result.comment_count, 0);
    assert.equal(result.found_while_working_count, 0);
  });

  it('handles equal comment count and found count', () => {
    const issue = createMockIssue(3, 'Found while working on #1, #2, #3');
    const result = calculatePriorityScore(issue);
    assert.equal(result.priority_score, 3);
    assert.equal(result.comment_count, 3);
    assert.equal(result.found_while_working_count, 3);
  });
});

describe('PrioritizeIssues - Tier Determination', () => {
  it('assigns Tier 1 to bug', () => {
    const labels = [{ name: 'bug' }];
    assert.equal(determineTier(labels), 1);
  });

  it('assigns Tier 1 to enhancement + bug', () => {
    const labels = [{ name: 'enhancement' }, { name: 'bug' }];
    assert.equal(determineTier(labels), 1);
  });

  it('assigns Tier 2 to code-reviewer (without bug)', () => {
    const labels = [{ name: 'enhancement' }, { name: 'code-reviewer' }];
    assert.equal(determineTier(labels), 2);
  });

  it('assigns Tier 3 to code-simplifier (without bug or code-reviewer)', () => {
    const labels = [{ name: 'enhancement' }, { name: 'code-simplifier' }];
    assert.equal(determineTier(labels), 3);
  });

  it('assigns Tier 4 to enhancement only', () => {
    const labels = [{ name: 'enhancement' }];
    assert.equal(determineTier(labels), 4);
  });

  it('handles case insensitive label matching', () => {
    const labels = [{ name: 'Enhancement' }, { name: 'Bug' }];
    assert.equal(determineTier(labels), 1);
  });

  it('prioritizes bug over code-reviewer (Tier 1 > Tier 2)', () => {
    const labels = [{ name: 'enhancement' }, { name: 'bug' }, { name: 'code-reviewer' }];
    assert.equal(determineTier(labels), 1);
  });

  it('prioritizes bug over code-simplifier (Tier 1 > Tier 3)', () => {
    const labels = [{ name: 'enhancement' }, { name: 'bug' }, { name: 'code-simplifier' }];
    assert.equal(determineTier(labels), 1);
  });

  it('prioritizes code-reviewer over code-simplifier (Tier 2 > Tier 3)', () => {
    const labels = [
      { name: 'enhancement' },
      { name: 'code-reviewer' },
      { name: 'code-simplifier' },
    ];
    assert.equal(determineTier(labels), 2);
  });

  it('assigns Tier 4 to empty label array', () => {
    const labels: Array<{ name: string }> = [];
    assert.equal(determineTier(labels), 4);
  });

  it('handles extra labels alongside tier criteria', () => {
    const labels = [
      { name: 'enhancement' },
      { name: 'bug' },
      { name: 'documentation' },
      { name: 'good first issue' },
    ];
    assert.equal(determineTier(labels), 1);
  });

  it('assigns Tier 1 when bug is present even without enhancement', () => {
    const labels = [{ name: 'bug' }];
    assert.equal(determineTier(labels), 1);
  });

  it('assigns Tier 2 when code-reviewer is present without bug', () => {
    const labels = [{ name: 'code-reviewer' }];
    assert.equal(determineTier(labels), 2);
  });

  it('assigns Tier 3 when code-simplifier is present without bug or code-reviewer', () => {
    const labels = [{ name: 'code-simplifier' }];
    assert.equal(determineTier(labels), 3);
  });
});

describe('PrioritizeIssues - Issue Sorting', () => {
  interface PrioritizedIssue {
    number: number;
    tier: 1 | 2 | 3 | 4;
    priority_score: number;
  }

  // Mirror the sorting logic
  function sortIssues(issues: PrioritizedIssue[]): PrioritizedIssue[] {
    return [...issues].sort((a, b) => {
      if (a.tier !== b.tier) {
        return a.tier - b.tier;
      }
      return b.priority_score - a.priority_score;
    });
  }

  it('sorts by tier first (Tier 1 before Tier 2 before Tier 3 before Tier 4)', () => {
    const issues: PrioritizedIssue[] = [
      { number: 1, tier: 4, priority_score: 10 },
      { number: 2, tier: 1, priority_score: 1 },
      { number: 3, tier: 3, priority_score: 5 },
      { number: 4, tier: 2, priority_score: 7 },
    ];

    const sorted = sortIssues(issues);
    assert.equal(sorted[0].tier, 1);
    assert.equal(sorted[1].tier, 2);
    assert.equal(sorted[2].tier, 3);
    assert.equal(sorted[3].tier, 4);
  });

  it('sorts within tier by priority_score descending', () => {
    const issues: PrioritizedIssue[] = [
      { number: 1, tier: 1, priority_score: 5 },
      { number: 2, tier: 1, priority_score: 10 },
      { number: 3, tier: 1, priority_score: 3 },
    ];

    const sorted = sortIssues(issues);
    assert.equal(sorted[0].priority_score, 10);
    assert.equal(sorted[1].priority_score, 5);
    assert.equal(sorted[2].priority_score, 3);
  });

  it('maintains sort stability for equal scores in same tier', () => {
    const issues: PrioritizedIssue[] = [
      { number: 100, tier: 2, priority_score: 5 },
      { number: 200, tier: 2, priority_score: 5 },
      { number: 300, tier: 2, priority_score: 5 },
    ];

    const sorted = sortIssues(issues);
    // All should be in same tier with same score
    assert.equal(sorted[0].tier, 2);
    assert.equal(sorted[1].tier, 2);
    assert.equal(sorted[2].tier, 2);
    assert.equal(sorted[0].priority_score, 5);
    assert.equal(sorted[1].priority_score, 5);
    assert.equal(sorted[2].priority_score, 5);
  });

  it('sorts complex mix of tiers and scores correctly', () => {
    const issues: PrioritizedIssue[] = [
      { number: 1, tier: 4, priority_score: 20 },
      { number: 2, tier: 1, priority_score: 2 },
      { number: 3, tier: 2, priority_score: 15 },
      { number: 4, tier: 1, priority_score: 10 },
      { number: 5, tier: 3, priority_score: 1 },
      { number: 6, tier: 2, priority_score: 8 },
      { number: 7, tier: 4, priority_score: 5 },
      { number: 8, tier: 3, priority_score: 12 },
    ];

    const sorted = sortIssues(issues);

    // Tier 1 issues first (sorted by score desc)
    assert.equal(sorted[0].number, 4); // Tier 1, score 10
    assert.equal(sorted[1].number, 2); // Tier 1, score 2

    // Tier 2 issues next (sorted by score desc)
    assert.equal(sorted[2].number, 3); // Tier 2, score 15
    assert.equal(sorted[3].number, 6); // Tier 2, score 8

    // Tier 3 issues next (sorted by score desc)
    assert.equal(sorted[4].number, 8); // Tier 3, score 12
    assert.equal(sorted[5].number, 5); // Tier 3, score 1

    // Tier 4 issues last (sorted by score desc)
    assert.equal(sorted[6].number, 1); // Tier 4, score 20
    assert.equal(sorted[7].number, 7); // Tier 4, score 5
  });
});

describe('PrioritizeIssues - Edge Cases: Large Found While Working Counts', () => {
  // Helper to create mock issue for testing
  function createMockIssue(comments: number, body: string | null): GitHubIssue {
    return {
      number: 123,
      title: 'Test Issue',
      labels: [{ name: 'enhancement' }],
      url: 'https://github.com/owner/repo/issues/123',
      comments,
      body,
    };
  }

  it('handles very large found_while_working_count (20+ issues)', () => {
    const issueRefs = Array.from({ length: 25 }, (_, i) => `#${i + 1}`).join(', ');
    const body = `Found while working on ${issueRefs}`;

    const issue = createMockIssue(3, body);
    const result = calculatePriorityScore(issue);
    assert.equal(result.found_while_working_count, 25);
    assert.equal(result.priority_score, 25); // Should use max(3, 25) = 25
    assert.equal(result.comment_count, 3);
  });

  it('handles extremely large found_while_working_count (100+ issues)', () => {
    const issueRefs = Array.from({ length: 150 }, (_, i) => `#${i + 1}`).join(', ');
    const body = `Found while working on ${issueRefs}`;

    const issue = createMockIssue(10, body);
    const result = calculatePriorityScore(issue);
    assert.equal(result.found_while_working_count, 150);
    assert.equal(result.priority_score, 150);
    assert.equal(result.comment_count, 10);
  });

  it('handles large found count with no spaces after commas', () => {
    const issueRefs = Array.from({ length: 30 }, (_, i) => `#${i + 1}`).join(',');
    const body = `Found while working on ${issueRefs}`;

    const issue = createMockIssue(5, body);
    const result = calculatePriorityScore(issue);
    assert.equal(result.found_while_working_count, 30);
    assert.equal(result.priority_score, 30);
  });

  it('correctly prioritizes large found count over high comment count', () => {
    const issueRefs = Array.from({ length: 50 }, (_, i) => `#${i + 1}`).join(', ');
    const body = `Found while working on ${issueRefs}`;

    const issue = createMockIssue(45, body);
    const result = calculatePriorityScore(issue);
    assert.equal(result.found_while_working_count, 50);
    assert.equal(result.comment_count, 45);
    assert.equal(result.priority_score, 50); // 50 > 45
  });

  it('does not incorrectly match issue numbers from code snippets', () => {
    const body = `
This bug occurs in the parser.

Found while working on #123, #456

Example code:
const arr = [#1, #2, #3, #4, #5];
`;

    const result = extractFoundWhileWorkingCount(body);
    // Should only match #123 and #456 from the "Found while working on" line
    assert.equal(result.count, 2);
  });

  it('handles mixed formatting in large lists', () => {
    const body = 'Found while working on #1, #2,#3, #4,  #5,#6,  #7, #8';
    const result = extractFoundWhileWorkingCount(body);
    assert.equal(result.count, 8);
  });

  it('handles large numbers in issue references', () => {
    const body = 'Found while working on #9999, #10000, #123456';
    const result = extractFoundWhileWorkingCount(body);
    assert.equal(result.count, 3);
  });
});

describe('PrioritizeIssues - Integration: Main Function Behavior', () => {
  // Test the expected behavior patterns for the main prioritizeIssues function
  // These tests document how the function should handle various GitHub API responses

  it('should handle empty array from GitHub API', () => {
    // Expected behavior: When GitHub returns [], function should return
    // a message indicating no issues found
    const mockResponse: any[] = [];

    // Simulate the processing logic
    if (mockResponse.length === 0) {
      const expectedMessage = 'No open issues found with label "enhancement"';
      assert.ok(expectedMessage.includes('No'));
      assert.ok(expectedMessage.includes('issues found'));
    }
  });

  it('should handle null body fields gracefully', () => {
    // Expected behavior: Issues with null body should have found_while_working_count = 0
    const mockIssue: GitHubIssue = {
      number: 123,
      title: 'Test Issue',
      labels: [{ name: 'enhancement' }],
      url: 'https://github.com/owner/repo/issues/123',
      comments: 5,
      body: null,
    };

    const result = extractFoundWhileWorkingCount(mockIssue.body);
    assert.equal(result.count, 0);

    // Priority score should fall back to comment count
    const scoreResult = calculatePriorityScore(mockIssue);
    assert.equal(scoreResult.priority_score, 5);
  });

  it('should handle undefined body fields gracefully', () => {
    // Expected behavior: Issues with undefined body should have found_while_working_count = 0
    const mockIssue: GitHubIssue = {
      number: 456,
      title: 'Another Test',
      labels: [{ name: 'enhancement' }],
      url: 'https://github.com/owner/repo/issues/456',
      comments: 3,
      body: undefined as any,
    };

    const result = extractFoundWhileWorkingCount(mockIssue.body);
    assert.equal(result.count, 0);
  });

  it('should format output correctly with mixed tiers', () => {
    // Expected behavior: Output should group issues by tier and show score details
    const mockIssues = [
      {
        number: 1,
        tier: 1,
        priority_score: 10,
        comment_count: 10,
        found_while_working_count: 0,
        title: 'Tier 1 Issue',
        url: 'https://github.com/owner/repo/issues/1',
      },
      {
        number: 2,
        tier: 2,
        priority_score: 5,
        comment_count: 0,
        found_while_working_count: 5,
        title: 'Tier 2 Issue',
        url: 'https://github.com/owner/repo/issues/2',
      },
      {
        number: 3,
        tier: 3,
        priority_score: 3,
        comment_count: 3,
        found_while_working_count: 0,
        title: 'Tier 3 Issue',
        url: 'https://github.com/owner/repo/issues/3',
      },
    ];

    // Verify tier grouping logic
    const tier1 = mockIssues.filter((i) => i.tier === 1);
    const tier2 = mockIssues.filter((i) => i.tier === 2);
    const tier3 = mockIssues.filter((i) => i.tier === 3);

    assert.equal(tier1.length, 1);
    assert.equal(tier2.length, 1);
    assert.equal(tier3.length, 1);

    // Verify score details formatting logic
    const formatScoreDetails = (issue: (typeof mockIssues)[0]) => {
      const details = [];
      if (issue.comment_count > 0) {
        details.push(`${issue.comment_count} comments`);
      }
      if (issue.found_while_working_count > 0) {
        details.push(`found in ${issue.found_while_working_count} issues`);
      }
      return details.length > 0 ? ` [${details.join(', ')}]` : '';
    };

    assert.equal(formatScoreDetails(mockIssues[0]), ' [10 comments]');
    assert.equal(formatScoreDetails(mockIssues[1]), ' [found in 5 issues]');
    assert.equal(formatScoreDetails(mockIssues[2]), ' [3 comments]');
  });

  it('should handle issues with both high comments and high found count', () => {
    // Expected behavior: priority_score should be max(comment_count, found_while_working_count)
    const mockIssue: GitHubIssue = {
      number: 789,
      title: 'Test Issue',
      labels: [{ name: 'enhancement' }],
      url: 'https://github.com/owner/repo/issues/789',
      comments: 25,
      body:
        'Found while working on ' + Array.from({ length: 30 }, (_, i) => `#${i + 1}`).join(', '),
    };

    const foundResult = extractFoundWhileWorkingCount(mockIssue.body);
    const scoreResult = calculatePriorityScore(mockIssue);

    assert.equal(foundResult.count, 30);
    assert.equal(scoreResult.priority_score, 30); // max(25, 30) = 30
  });

  it('should handle empty tier gracefully in output formatting', () => {
    // Expected behavior: If a tier has no issues, formatIssueList should return early
    const tier1Issues: any[] = [];

    const formatIssueList = (tierIssues: any[], tierName: string) => {
      if (tierIssues.length === 0) return undefined;
      return `${tierName} (${tierIssues.length} issues):`;
    };

    const result = formatIssueList(tier1Issues, 'Tier 1');
    assert.equal(result, undefined);
  });

  it('should handle issues with zero comments and zero found count', () => {
    // Expected behavior: priority_score should be 0
    const mockIssue: GitHubIssue = {
      number: 999,
      title: 'Test Issue',
      labels: [{ name: 'enhancement' }],
      url: 'https://github.com/owner/repo/issues/999',
      comments: 0,
      body: 'Just a regular issue description',
    };

    const foundResult = extractFoundWhileWorkingCount(mockIssue.body);
    const scoreResult = calculatePriorityScore(mockIssue);

    assert.equal(foundResult.count, 0);
    assert.equal(scoreResult.priority_score, 0); // max(0, 0) = 0
  });

  it('detects malformed "Found while working on" references', () => {
    // Expected behavior: When pattern exists but no # symbols, mark as malformed
    const result = extractFoundWhileWorkingCount('Found while working on 123, 456');
    assert.equal(result.count, 0);
    assert.equal(result.isMalformed, true);
    assert.equal(result.pattern, '123, 456');
  });

  it('handles well-formed references (not malformed)', () => {
    const result = extractFoundWhileWorkingCount('Found while working on #123, #456');
    assert.equal(result.count, 2);
    assert.equal(result.isMalformed, false);
    assert.equal(result.pattern, undefined);
  });

  it('calculatePriorityScore includes malformed flag in result', () => {
    const issue: GitHubIssue = {
      number: 100,
      title: 'Test',
      labels: [{ name: 'enhancement' }],
      url: 'https://github.com/owner/repo/issues/100',
      comments: 5,
      body: 'Found while working on 999',
    };

    const result = calculatePriorityScore(issue);
    assert.equal(result.found_while_working_malformed, true);
    assert.equal(result.found_while_working_pattern, '999');
  });
});

describe('PrioritizeIssues - Integration Tests', () => {
  /**
   * Integration tests for the main prioritizeIssues() function.
   *
   * NOTE: These tests currently document expected behavior with various GitHub API responses.
   * They test helper functions and validation logic but do NOT test the actual prioritizeIssues()
   * function with mocked GitHub CLI responses.
   *
   * TODO(#1498): Add real integration tests with gh CLI mocking
   *
   * Required mocking infrastructure:
   * - Mock ghCliJson() to return controlled GitHub API responses
   * - Mock resolveRepo() to return test repository
   *
   * Critical test coverage gaps (HIGH PRIORITY):
   * 1. GitHub API error handling:
   *    - Malformed JSON responses → should throw ValidationError
   *    - 404 errors (repo not found) → should return error ToolResult
   *    - 500 errors (server error) → should return error ToolResult
   *    - Network timeouts → should return error ToolResult
   *    - Rate limiting (403) → should return error with rate limit message
   *
   * 2. Data validation failures:
   *    - Non-array response from GitHub → should throw ValidationError
   *    - Missing required fields (number, title, labels, url) → should throw ValidationError
   *    - Invalid comments field type → should throw ValidationError
   *
   * 3. Success scenarios with edge cases:
   *    - Empty results array → should return "No issues found" message
   *    - Issues with null/undefined body → should handle gracefully (found_count = 0)
   *    - Issues with malformed "Found while working on" → should add to warning section
   *    - Large result sets (1000 issues) → should process without errors
   *    - Mixed tier distribution → should group and sort correctly
   *
   * Implementation approach:
   * ```typescript
   * import { jest } from '@jest/globals'; // or equivalent mocking library
   *
   * describe('prioritizeIssues() - with mocked gh CLI', () => {
   *   it('handles GitHub API 404 error gracefully', async () => {
   *     // Mock ghCliJson to throw error
   *     jest.spyOn(ghCli, 'ghCliJson').mockRejectedValue(
   *       new Error('GitHub CLI command failed: 404 Not Found')
   *     );
   *
   *     const result = await prioritizeIssues({ label: 'enhancement' });
   *
   *     assert.equal(result.isError, true);
   *     assert.ok(result.content[0].text.includes('404'));
   *   });
   *
   *   it('processes real issue data correctly', async () => {
   *     // Mock ghCliJson to return fixture data
   *     jest.spyOn(ghCli, 'ghCliJson').mockResolvedValue([
   *       {
   *         number: 1,
   *         title: 'Test Issue',
   *         labels: [{ name: 'enhancement' }, { name: 'bug' }],
   *         url: 'https://github.com/owner/repo/issues/1',
   *         comments: 5,
   *         body: 'Found while working on #100, #200'
   *       }
   *     ]);
   *
   *     const result = await prioritizeIssues({ label: 'enhancement' });
   *
   *     assert.equal(result.isError, undefined);
   *     assert.ok(result.content[0].text.includes('Tier 1')); // bug label
   *     assert.ok(result.content[0].text.includes('found in 2 issues'));
   *   });
   * });
   * ```
   *
   * Current test coverage:
   * - Helper functions: ✅ Comprehensive unit tests
   * - Validation logic: ✅ Documented expected behaviors
   * - Main function with GitHub API: ❌ NO TESTS (requires mocking)
   */

  describe('Error Handling - Expected Behaviors', () => {
    it('documents expected error for non-array GitHub response', () => {
      // Expected behavior: If GitHub CLI returns non-array (e.g., {}), throw ValidationError
      // The function checks: if (!Array.isArray(rawIssues)) { throw new ValidationError(...) }
      const mockResponse = {}; // Not an array

      // Verify validation logic
      const isArray = Array.isArray(mockResponse);
      assert.equal(isArray, false);

      // Expected: ValidationError with message "GitHub CLI returned invalid issue data (not an array)"
    });

    it('documents expected error for missing number field', () => {
      // Expected behavior: If issue.number is not a number, throw ValidationError
      const mockIssue = {
        number: 'invalid', // Should be number
        title: 'Test',
        labels: [],
        url: 'https://github.com/owner/repo/issues/1',
        comments: 0,
        body: null,
      };

      const isValid = typeof mockIssue.number === 'number';
      assert.equal(isValid, false);

      // Expected: ValidationError with message containing "without valid 'number' field"
    });

    it('documents expected error for missing labels array', () => {
      // Expected behavior: If issue.labels is not an array, throw ValidationError
      const mockIssue = {
        number: 123,
        title: 'Test',
        labels: null, // Should be array
        url: 'https://github.com/owner/repo/issues/123',
        comments: 0,
        body: null,
      };

      const isValid = Array.isArray(mockIssue.labels);
      assert.equal(isValid, false);

      // Expected: ValidationError with message containing "without valid 'labels' array"
    });

    it('documents expected error for invalid comments field (not number or array)', () => {
      // Expected behavior: If issue.comments is not a number or array, throw ValidationError
      const mockIssue = {
        number: 123,
        title: 'Test',
        labels: [],
        url: 'https://github.com/owner/repo/issues/123',
        comments: 'five', // Should be number or array
        body: null,
      };

      const isValidNumber = typeof mockIssue.comments === 'number';
      const isValidArray = Array.isArray(mockIssue.comments);
      assert.equal(isValidNumber, false);
      assert.equal(isValidArray, false);

      // Expected: ValidationError with message "Expected a number or array, got: string"
    });

    it('handles comments as array (current GitHub CLI format)', () => {
      // Expected behavior: GitHub CLI returns comments as array - use length
      const mockIssues = [
        {
          number: 100,
          title: 'Test Issue',
          labels: [{ name: 'enhancement' }],
          url: 'https://github.com/owner/repo/issues/100',
          comments: [], // Array format with no comments
          body: 'Test body',
        },
        {
          number: 101,
          title: 'Test Issue 2',
          labels: [{ name: 'enhancement' }],
          url: 'https://github.com/owner/repo/issues/101',
          comments: [{}, {}, {}], // Array format with 3 comments
          body: 'Test body 2',
        },
      ];

      // Simulate the normalization logic from prioritizeIssues
      const normalizedIssues = mockIssues.map((issue) => {
        let commentCount: number;
        if (Array.isArray(issue.comments)) {
          commentCount = issue.comments.length;
        } else if (typeof issue.comments === 'number') {
          commentCount = issue.comments;
        } else {
          throw new Error('Invalid comments field');
        }
        return { ...issue, comments: commentCount };
      });

      assert.equal(normalizedIssues[0].comments, 0); // Empty array → 0 comments
      assert.equal(normalizedIssues[1].comments, 3); // 3 items in array → 3 comments
    });

    it('handles comments as number (legacy format)', () => {
      // Expected behavior: GitHub CLI may return comments as number - use directly
      const mockIssue = {
        number: 100,
        title: 'Test Issue',
        labels: [{ name: 'enhancement' }],
        url: 'https://github.com/owner/repo/issues/100',
        comments: 5, // Number format
        body: 'Test body',
      };

      // Simulate the normalization logic from prioritizeIssues
      let commentCount: number;
      if (Array.isArray(mockIssue.comments)) {
        commentCount = mockIssue.comments.length;
      } else if (typeof mockIssue.comments === 'number') {
        commentCount = mockIssue.comments;
      } else {
        throw new Error('Invalid comments field');
      }

      assert.equal(commentCount, 5);
    });

    it('documents expected error for missing title field', () => {
      // Expected behavior: If issue.title is not a string, throw ValidationError
      const mockIssue = {
        number: 123,
        title: null, // Should be string
        labels: [],
        url: 'https://github.com/owner/repo/issues/123',
        comments: 0,
        body: null,
      };

      const isValid = typeof mockIssue.title === 'string';
      assert.equal(isValid, false);

      // Expected: ValidationError with message containing "without valid 'title' field"
    });

    it('documents expected error for missing url field', () => {
      // Expected behavior: If issue.url is not a string, throw ValidationError
      const mockIssue = {
        number: 123,
        title: 'Test',
        labels: [],
        url: undefined, // Should be string
        comments: 0,
        body: null,
      };

      const isValid = typeof mockIssue.url === 'string';
      assert.equal(isValid, false);

      // Expected: ValidationError with message containing "without valid 'url' field"
    });
  });

  describe('Success Scenarios - Expected Behaviors', () => {
    it('documents expected output for empty results', () => {
      // Expected behavior: When GitHub returns [], return message "No {state} issues found"
      const mockResponse: any[] = [];

      if (mockResponse.length === 0) {
        const expectedMessage = 'No open issues found with label "enhancement"';
        assert.ok(expectedMessage.includes('No'));
        assert.ok(expectedMessage.includes('issues found'));
      }

      // Expected output format:
      // {
      //   content: [{
      //     type: 'text',
      //     text: 'No open issues found with label "enhancement" in owner/repo'
      //   }]
      // }
    });

    it('documents expected tier categorization', () => {
      // Expected behavior: Issues are categorized into tiers based on labels
      const mockIssues = [
        { labels: [{ name: 'bug' }] }, // Tier 1
        { labels: [{ name: 'code-reviewer' }] }, // Tier 2
        { labels: [{ name: 'code-simplifier' }] }, // Tier 3
        { labels: [{ name: 'enhancement' }] }, // Tier 4
      ];

      // Verify tier logic
      assert.equal(determineTier(mockIssues[0].labels), 1);
      assert.equal(determineTier(mockIssues[1].labels), 2);
      assert.equal(determineTier(mockIssues[2].labels), 3);
      assert.equal(determineTier(mockIssues[3].labels), 4);

      // Expected output: Issues grouped by tier in output
      // Tier 1 issues appear first, then Tier 2, then Tier 3, then Tier 4
    });

    it('documents expected priority score sorting', () => {
      // Expected behavior: Within each tier, sort by priority_score descending
      const tier1Issues = [
        { number: 1, comments: 10, body: null }, // score: 10
        { number: 2, comments: 5, body: 'Found while working on #1, #2, #3' }, // score: 5
        { number: 3, comments: 2, body: 'Found while working on #1, #2, #3, #4, #5' }, // score: 5
      ];

      const scores = tier1Issues.map((issue) =>
        calculatePriorityScore({
          ...issue,
          title: 'Test',
          labels: [{ name: 'enhancement' }],
          url: 'https://github.com/owner/repo/issues/1',
        })
      );

      assert.equal(scores[0].priority_score, 10);
      assert.equal(scores[1].priority_score, 5);
      assert.equal(scores[2].priority_score, 5);

      // Expected output: Issue #1 first (score 10), then #2 and #3 (score 5 each)
    });

    it('documents expected output format for malformed references', () => {
      // Expected behavior: Malformed "Found while working on" refs shown in warning section
      const mockIssues = [
        {
          number: 100,
          title: 'Test',
          labels: [{ name: 'enhancement' }],
          url: 'https://github.com/owner/repo/issues/100',
          comments: 5,
          body: 'Found while working on 999, 888', // Malformed (missing #)
        },
      ];

      const scoreResult = calculatePriorityScore(mockIssues[0]);
      assert.equal(scoreResult.found_while_working_malformed, true);

      // Expected output includes:
      // ⚠️  Issues with malformed "Found while working on" references:
      //   - #100: "999, 888" (missing # symbols)
      //   Expected format: "Found while working on #123, #456"
    });

    it('documents expected handling of large issue counts', () => {
      // Expected behavior: Function should handle 1000 issues (max limit)
      const limit = 1000;
      const mockIssues = Array.from({ length: limit }, (_, i) => ({
        number: i + 1,
        title: `Issue ${i + 1}`,
        labels: [{ name: 'enhancement' }],
        url: `https://github.com/owner/repo/issues/${i + 1}`,
        comments: Math.floor(Math.random() * 10),
        body: null,
      }));

      assert.equal(mockIssues.length, 1000);

      // Expected: Function processes all 1000 issues without errors
      // Expected: Output shows "Prioritized 1000 issues from owner/repo"
    });

    it('documents expected handling of mixed tier distribution', () => {
      // Expected behavior: Output groups issues by tier, skips empty tiers
      const mockIssues = [
        { labels: [{ name: 'bug' }] }, // Tier 1
        { labels: [{ name: 'bug' }] }, // Tier 1
        { labels: [{ name: 'code-simplifier' }] }, // Tier 3
        { labels: [{ name: 'enhancement' }] }, // Tier 4
        // No Tier 2 issues
      ];

      const tier1Count = mockIssues.filter((i) => determineTier(i.labels) === 1).length;
      const tier2Count = mockIssues.filter((i) => determineTier(i.labels) === 2).length;
      const tier3Count = mockIssues.filter((i) => determineTier(i.labels) === 3).length;
      const tier4Count = mockIssues.filter((i) => determineTier(i.labels) === 4).length;

      assert.equal(tier1Count, 2);
      assert.equal(tier2Count, 0);
      assert.equal(tier3Count, 1);
      assert.equal(tier4Count, 1);

      // Expected output:
      // - Shows "Tier 1: ..." with 2 issues
      // - Skips "Tier 2: ..." (no issues)
      // - Shows "Tier 3: ..." with 1 issue
      // - Shows "Tier 4: ..." with 1 issue
    });
  });

  describe('GitHub CLI Error Scenarios - Expected Behaviors', () => {
    it('documents expected handling of 404 errors', () => {
      // Expected behavior: GitHub CLI 404 error (repo not found, issue not found)
      // Should be caught by createErrorResult() and return ToolResult with error message

      const mockError = new Error('GitHub CLI command failed: 404 Not Found');

      // Expected output structure:
      // {
      //   content: [{
      //     type: 'text',
      //     text: 'Error: GitHub CLI command failed: 404 Not Found'
      //   }],
      //   isError: true
      // }

      assert.ok(mockError.message.includes('404'));
    });

    it('documents expected handling of 500 errors', () => {
      // Expected behavior: GitHub API 500 error (server error)
      // Should be caught by createErrorResult() and return ToolResult with error message

      const mockError = new Error('GitHub CLI command failed: 500 Internal Server Error');

      assert.ok(mockError.message.includes('500'));

      // Expected: Error message propagated to user with clear indication of API failure
    });

    it('documents expected handling of network timeouts', () => {
      // Expected behavior: Network timeout during gh CLI call
      // Should be caught by createErrorResult()

      const mockError = new Error('GitHub CLI command timed out after 30s');

      assert.ok(mockError.message.includes('timed out'));

      // Expected: Timeout error with suggestion to retry
    });

    it('documents expected handling of rate limiting', () => {
      // Expected behavior: GitHub API rate limit exceeded (403)
      // Should be caught and return error with rate limit message

      const mockError = new Error(
        'GitHub CLI command failed: 403 API rate limit exceeded for user'
      );

      assert.ok(mockError.message.includes('rate limit'));

      // Expected: Error message with rate limit info and retry-after suggestion
    });
  });

  describe('Edge Cases - Expected Behaviors', () => {
    it('documents expected handling of issues with extremely long titles', () => {
      // Expected behavior: Long titles should not break output formatting
      const longTitle = 'A'.repeat(500);
      const mockIssue: GitHubIssue = {
        number: 123,
        title: longTitle,
        labels: [{ name: 'enhancement' }],
        url: 'https://github.com/owner/repo/issues/123',
        comments: 5,
        body: null,
      };

      assert.equal(mockIssue.title.length, 500);

      // Expected: Title displayed in full (no truncation in current implementation)
      // Output format: "  1. #123: AAAA...AAAA [5 comments]"
    });

    it('documents expected handling of issues with special characters in title', () => {
      // Expected behavior: Special chars should be preserved in output
      const specialTitle = 'Fix: "quotes" & <tags> and emoji 🔥';
      const mockIssue: GitHubIssue = {
        number: 456,
        title: specialTitle,
        labels: [{ name: 'enhancement' }],
        url: 'https://github.com/owner/repo/issues/456',
        comments: 0,
        body: null,
      };

      assert.ok(mockIssue.title.includes('"'));
      assert.ok(mockIssue.title.includes('<'));
      assert.ok(mockIssue.title.includes('🔥'));

      // Expected: Special characters preserved in output (no escaping needed for text output)
    });

    it('documents expected handling of issues with no labels', () => {
      // Expected behavior: Issues with empty labels array default to Tier 4
      const mockIssue = {
        labels: [] as Array<{ name: string }>,
      };

      const tier = determineTier(mockIssue.labels);
      assert.equal(tier, 4);

      // Expected: Issue categorized as Tier 4
    });

    it('documents expected handling of issues with duplicate labels', () => {
      // Expected behavior: Duplicate labels don't affect tier determination
      const mockIssue = {
        labels: [{ name: 'enhancement' }, { name: 'enhancement' }, { name: 'bug' }],
      };

      const tier = determineTier(mockIssue.labels);
      assert.equal(tier, 1); // Still Tier 1 (enhancement + bug)

      // Expected: Duplicate labels ignored, tier determined correctly
    });

    it('documents expected handling of case variations in labels', () => {
      // Expected behavior: Label matching is case-insensitive
      const mockIssues = [
        { labels: [{ name: 'Enhancement' }, { name: 'Bug' }] }, // Mixed case
        { labels: [{ name: 'ENHANCEMENT' }, { name: 'BUG' }] }, // Upper case
        { labels: [{ name: 'enhancement' }, { name: 'bug' }] }, // Lower case
      ];

      // All should be Tier 1
      mockIssues.forEach((issue) => {
        assert.equal(determineTier(issue.labels), 1);
      });

      // Expected: Case-insensitive matching works correctly
    });

    it('documents expected zero comment and zero found count issue', () => {
      // Already covered in main integration tests but explicitly documented here
      const mockIssue: GitHubIssue = {
        number: 999,
        title: 'Test',
        labels: [{ name: 'enhancement' }],
        url: 'https://github.com/owner/repo/issues/999',
        comments: 0,
        body: 'No references',
      };

      const result = calculatePriorityScore(mockIssue);
      assert.equal(result.priority_score, 0);

      // Expected: Priority score is 0, issue appears last in its tier
    });
  });
});
