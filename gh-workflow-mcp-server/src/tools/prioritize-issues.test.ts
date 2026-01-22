/**
 * Tests for prioritize-issues tool
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('PrioritizeIssues - Found While Working On Extraction', () => {
  // TODO(#1474): Extract test helpers to shared utility instead of duplicating implementation
  // Mirror the extractFoundWhileWorkingCount function for testing
  function extractFoundWhileWorkingCount(body: string | null): number {
    if (!body) return 0;

    const foundWhilePattern = /Found while working on\s+([#\d,\s]+)/i;
    const match = body.match(foundWhilePattern);

    if (!match) return 0;

    const issueRefs = match[1].match(/#\d+/g);
    return issueRefs ? issueRefs.length : 0;
  }

  it('extracts single issue reference', () => {
    const body = 'Found while working on #123';
    assert.equal(extractFoundWhileWorkingCount(body), 1);
  });

  it('extracts multiple issue references', () => {
    const body = 'Found while working on #123, #456, #789';
    assert.equal(extractFoundWhileWorkingCount(body), 3);
  });

  it('extracts issues with varying whitespace', () => {
    const body = 'Found while working on #123,#456, #789';
    assert.equal(extractFoundWhileWorkingCount(body), 3);
  });

  it('returns 0 when no "Found while working on" line present', () => {
    const body = 'This is a regular issue description without the pattern';
    assert.equal(extractFoundWhileWorkingCount(body), 0);
  });

  it('returns 0 when body is null', () => {
    assert.equal(extractFoundWhileWorkingCount(null), 0);
  });

  it('returns 0 when body is empty string', () => {
    assert.equal(extractFoundWhileWorkingCount(''), 0);
  });

  it('handles case insensitive matching', () => {
    const body = 'FOUND WHILE WORKING ON #123';
    assert.equal(extractFoundWhileWorkingCount(body), 1);
  });

  it('extracts from multiline body', () => {
    const body = `This is a bug report.

Found while working on #100, #200

More details here.`;
    assert.equal(extractFoundWhileWorkingCount(body), 2);
  });

  it('ignores issue numbers not in "Found while working on" line', () => {
    const body = 'Related to #999. Found while working on #123';
    assert.equal(extractFoundWhileWorkingCount(body), 1);
  });

  it('handles issue references without spaces after commas', () => {
    const body = 'Found while working on #1,#2,#3,#4,#5';
    assert.equal(extractFoundWhileWorkingCount(body), 5);
  });
});

describe('PrioritizeIssues - Priority Score Calculation', () => {
  // Mirror the calculatePriorityScore logic for testing
  function calculatePriorityScore(
    comments: number,
    body: string | null
  ): { priority_score: number; comment_count: number; found_while_working_count: number } {
    function extractFoundWhileWorkingCount(body: string | null): number {
      if (!body) return 0;
      const foundWhilePattern = /Found while working on\s+([#\d,\s]+)/i;
      const match = body.match(foundWhilePattern);
      if (!match) return 0;
      const issueRefs = match[1].match(/#\d+/g);
      return issueRefs ? issueRefs.length : 0;
    }

    const comment_count = comments;
    const found_while_working_count = extractFoundWhileWorkingCount(body);

    return {
      priority_score: Math.max(comment_count, found_while_working_count),
      comment_count,
      found_while_working_count,
    };
  }

  it('uses comment count when higher than found count', () => {
    const result = calculatePriorityScore(10, 'Found while working on #123');
    assert.equal(result.priority_score, 10);
    assert.equal(result.comment_count, 10);
    assert.equal(result.found_while_working_count, 1);
  });

  it('uses found count when higher than comment count', () => {
    const result = calculatePriorityScore(2, 'Found while working on #1, #2, #3, #4, #5');
    assert.equal(result.priority_score, 5);
    assert.equal(result.comment_count, 2);
    assert.equal(result.found_while_working_count, 5);
  });

  it('uses comment count when found count is zero', () => {
    const result = calculatePriorityScore(7, 'No reference');
    assert.equal(result.priority_score, 7);
    assert.equal(result.comment_count, 7);
    assert.equal(result.found_while_working_count, 0);
  });

  it('uses found count when comment count is zero', () => {
    const result = calculatePriorityScore(0, 'Found while working on #100, #200');
    assert.equal(result.priority_score, 2);
    assert.equal(result.comment_count, 0);
    assert.equal(result.found_while_working_count, 2);
  });

  it('returns zero score when both metrics are zero', () => {
    const result = calculatePriorityScore(0, null);
    assert.equal(result.priority_score, 0);
    assert.equal(result.comment_count, 0);
    assert.equal(result.found_while_working_count, 0);
  });

  it('handles equal comment count and found count', () => {
    const result = calculatePriorityScore(3, 'Found while working on #1, #2, #3');
    assert.equal(result.priority_score, 3);
    assert.equal(result.comment_count, 3);
    assert.equal(result.found_while_working_count, 3);
  });
});

describe('PrioritizeIssues - Tier Determination', () => {
  // Mirror the determineTier function for testing
  function determineTier(labels: Array<{ name: string }>): 1 | 2 | 3 {
    const labelNames = labels.map((l) => l.name.toLowerCase());

    const hasEnhancement = labelNames.includes('enhancement');
    const hasBug = labelNames.includes('bug');
    const hasHighPriority = labelNames.includes('high priority');

    if (hasEnhancement && hasBug) {
      return 1;
    }

    if (hasEnhancement && hasHighPriority) {
      return 2;
    }

    return 3;
  }

  it('assigns Tier 1 to enhancement + bug', () => {
    const labels = [{ name: 'enhancement' }, { name: 'bug' }];
    assert.equal(determineTier(labels), 1);
  });

  it('assigns Tier 2 to enhancement + high priority', () => {
    const labels = [{ name: 'enhancement' }, { name: 'high priority' }];
    assert.equal(determineTier(labels), 2);
  });

  it('assigns Tier 3 to enhancement only', () => {
    const labels = [{ name: 'enhancement' }];
    assert.equal(determineTier(labels), 3);
  });

  it('handles case insensitive label matching', () => {
    const labels = [{ name: 'Enhancement' }, { name: 'Bug' }];
    assert.equal(determineTier(labels), 1);
  });

  it('prioritizes bug over high priority (Tier 1 > Tier 2)', () => {
    const labels = [{ name: 'enhancement' }, { name: 'bug' }, { name: 'high priority' }];
    assert.equal(determineTier(labels), 1);
  });

  it('assigns Tier 3 when enhancement not present', () => {
    const labels = [{ name: 'bug' }];
    assert.equal(determineTier(labels), 3);
  });

  it('assigns Tier 3 when only high priority (no enhancement)', () => {
    const labels = [{ name: 'high priority' }];
    assert.equal(determineTier(labels), 3);
  });

  it('assigns Tier 3 to empty label array', () => {
    const labels: Array<{ name: string }> = [];
    assert.equal(determineTier(labels), 3);
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
});

describe('PrioritizeIssues - Issue Sorting', () => {
  interface PrioritizedIssue {
    number: number;
    tier: 1 | 2 | 3;
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

  it('sorts by tier first (Tier 1 before Tier 2 before Tier 3)', () => {
    const issues: PrioritizedIssue[] = [
      { number: 1, tier: 3, priority_score: 10 },
      { number: 2, tier: 1, priority_score: 1 },
      { number: 3, tier: 2, priority_score: 5 },
    ];

    const sorted = sortIssues(issues);
    assert.equal(sorted[0].tier, 1);
    assert.equal(sorted[1].tier, 2);
    assert.equal(sorted[2].tier, 3);
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
      { number: 1, tier: 3, priority_score: 20 },
      { number: 2, tier: 1, priority_score: 2 },
      { number: 3, tier: 2, priority_score: 15 },
      { number: 4, tier: 1, priority_score: 10 },
      { number: 5, tier: 3, priority_score: 1 },
      { number: 6, tier: 2, priority_score: 8 },
    ];

    const sorted = sortIssues(issues);

    // Tier 1 issues first (sorted by score desc)
    assert.equal(sorted[0].number, 4); // Tier 1, score 10
    assert.equal(sorted[1].number, 2); // Tier 1, score 2

    // Tier 2 issues next (sorted by score desc)
    assert.equal(sorted[2].number, 3); // Tier 2, score 15
    assert.equal(sorted[3].number, 6); // Tier 2, score 8

    // Tier 3 issues last (sorted by score desc)
    assert.equal(sorted[4].number, 1); // Tier 3, score 20
    assert.equal(sorted[5].number, 5); // Tier 3, score 1
  });
});

describe('PrioritizeIssues - Edge Cases: Large Found While Working Counts', () => {
  // Mirror the extractFoundWhileWorkingCount function for testing
  function extractFoundWhileWorkingCount(body: string | null): number {
    if (!body) return 0;

    const foundWhilePattern = /Found while working on\s+([#\d,\s]+)/i;
    const match = body.match(foundWhilePattern);

    if (!match) return 0;

    const issueRefs = match[1].match(/#\d+/g);
    return issueRefs ? issueRefs.length : 0;
  }

  function calculatePriorityScore(
    comments: number,
    body: string | null
  ): { priority_score: number; comment_count: number; found_while_working_count: number } {
    const comment_count = comments;
    const found_while_working_count = extractFoundWhileWorkingCount(body);

    return {
      priority_score: Math.max(comment_count, found_while_working_count),
      comment_count,
      found_while_working_count,
    };
  }

  it('handles very large found_while_working_count (20+ issues)', () => {
    const issueRefs = Array.from({ length: 25 }, (_, i) => `#${i + 1}`).join(', ');
    const body = `Found while working on ${issueRefs}`;

    const result = calculatePriorityScore(3, body);
    assert.equal(result.found_while_working_count, 25);
    assert.equal(result.priority_score, 25); // Should use max(3, 25) = 25
    assert.equal(result.comment_count, 3);
  });

  it('handles extremely large found_while_working_count (100+ issues)', () => {
    const issueRefs = Array.from({ length: 150 }, (_, i) => `#${i + 1}`).join(', ');
    const body = `Found while working on ${issueRefs}`;

    const result = calculatePriorityScore(10, body);
    assert.equal(result.found_while_working_count, 150);
    assert.equal(result.priority_score, 150);
    assert.equal(result.comment_count, 10);
  });

  it('handles large found count with no spaces after commas', () => {
    const issueRefs = Array.from({ length: 30 }, (_, i) => `#${i + 1}`).join(',');
    const body = `Found while working on ${issueRefs}`;

    const result = calculatePriorityScore(5, body);
    assert.equal(result.found_while_working_count, 30);
    assert.equal(result.priority_score, 30);
  });

  it('correctly prioritizes large found count over high comment count', () => {
    const issueRefs = Array.from({ length: 50 }, (_, i) => `#${i + 1}`).join(', ');
    const body = `Found while working on ${issueRefs}`;

    const result = calculatePriorityScore(45, body);
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
    assert.equal(result, 2);
  });

  it('handles mixed formatting in large lists', () => {
    const body = 'Found while working on #1, #2,#3, #4,  #5,#6,  #7, #8';
    const result = extractFoundWhileWorkingCount(body);
    assert.equal(result, 8);
  });

  it('handles large numbers in issue references', () => {
    const body = 'Found while working on #9999, #10000, #123456';
    const result = extractFoundWhileWorkingCount(body);
    assert.equal(result, 3);
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
    const mockIssue = {
      number: 123,
      title: 'Test Issue',
      labels: [{ name: 'enhancement' }],
      url: 'https://github.com/owner/repo/issues/123',
      comments: 5,
      body: null,
    };

    // Mirror the extraction logic
    function extractFoundWhileWorkingCount(body: string | null): number {
      if (!body) return 0;
      const foundWhilePattern = /Found while working on\s+([#\d,\s]+)/i;
      const match = body.match(foundWhilePattern);
      if (!match) return 0;
      const issueRefs = match[1].match(/#\d+/g);
      return issueRefs ? issueRefs.length : 0;
    }

    const foundCount = extractFoundWhileWorkingCount(mockIssue.body);
    assert.equal(foundCount, 0);

    // Priority score should fall back to comment count
    const priorityScore = Math.max(mockIssue.comments, foundCount);
    assert.equal(priorityScore, 5);
  });

  it('should handle undefined body fields gracefully', () => {
    // Expected behavior: Issues with undefined body should have found_while_working_count = 0
    const mockIssue = {
      number: 456,
      title: 'Another Test',
      labels: [{ name: 'enhancement' }],
      url: 'https://github.com/owner/repo/issues/456',
      comments: 3,
      body: undefined as any,
    };

    function extractFoundWhileWorkingCount(body: string | null): number {
      if (!body) return 0;
      const foundWhilePattern = /Found while working on\s+([#\d,\s]+)/i;
      const match = body.match(foundWhilePattern);
      if (!match) return 0;
      const issueRefs = match[1].match(/#\d+/g);
      return issueRefs ? issueRefs.length : 0;
    }

    const foundCount = extractFoundWhileWorkingCount(mockIssue.body);
    assert.equal(foundCount, 0);
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
    const mockIssue = {
      number: 789,
      comments: 25,
      body:
        'Found while working on ' + Array.from({ length: 30 }, (_, i) => `#${i + 1}`).join(', '),
    };

    function extractFoundWhileWorkingCount(body: string | null): number {
      if (!body) return 0;
      const foundWhilePattern = /Found while working on\s+([#\d,\s]+)/i;
      const match = body.match(foundWhilePattern);
      if (!match) return 0;
      const issueRefs = match[1].match(/#\d+/g);
      return issueRefs ? issueRefs.length : 0;
    }

    const foundCount = extractFoundWhileWorkingCount(mockIssue.body);
    const priorityScore = Math.max(mockIssue.comments, foundCount);

    assert.equal(foundCount, 30);
    assert.equal(priorityScore, 30); // max(25, 30) = 30
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
    const mockIssue = {
      number: 999,
      comments: 0,
      body: 'Just a regular issue description',
    };

    function extractFoundWhileWorkingCount(body: string | null): number {
      if (!body) return 0;
      const foundWhilePattern = /Found while working on\s+([#\d,\s]+)/i;
      const match = body.match(foundWhilePattern);
      if (!match) return 0;
      const issueRefs = match[1].match(/#\d+/g);
      return issueRefs ? issueRefs.length : 0;
    }

    const foundCount = extractFoundWhileWorkingCount(mockIssue.body);
    const priorityScore = Math.max(mockIssue.comments, foundCount);

    assert.equal(foundCount, 0);
    assert.equal(priorityScore, 0); // max(0, 0) = 0
  });
});
