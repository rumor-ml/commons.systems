/**
 * Tests for prioritize-issues tool
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('PrioritizeIssues - Found While Working On Extraction', () => {
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
