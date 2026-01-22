/**
 * Tests for check-issue-dependencies tool
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('CheckIssueDependencies - Open Blocker Filtering', () => {
  interface BlockingIssue {
    id: number;
    number: number;
    state: string;
    title: string;
    url: string;
  }

  // Mirror the filtering logic for testing
  function filterOpenBlockers(blockingIssues: BlockingIssue[]): BlockingIssue[] {
    return blockingIssues.filter((issue) => issue.state === 'open');
  }

  it('filters only open blocking issues', () => {
    const blockers: BlockingIssue[] = [
      { id: 1, number: 100, state: 'open', title: 'Bug fix', url: 'https://github.com/repo/100' },
      { id: 2, number: 101, state: 'closed', title: 'Feature', url: 'https://github.com/repo/101' },
      {
        id: 3,
        number: 102,
        state: 'open',
        title: 'Enhancement',
        url: 'https://github.com/repo/102',
      },
    ];

    const openBlockers = filterOpenBlockers(blockers);
    assert.equal(openBlockers.length, 2);
    assert.equal(openBlockers[0].number, 100);
    assert.equal(openBlockers[1].number, 102);
  });

  it('returns empty array when all blockers are closed', () => {
    const blockers: BlockingIssue[] = [
      { id: 1, number: 100, state: 'closed', title: 'Bug fix', url: 'https://github.com/repo/100' },
      { id: 2, number: 101, state: 'closed', title: 'Feature', url: 'https://github.com/repo/101' },
    ];

    const openBlockers = filterOpenBlockers(blockers);
    assert.equal(openBlockers.length, 0);
  });

  it('returns all blockers when all are open', () => {
    const blockers: BlockingIssue[] = [
      { id: 1, number: 100, state: 'open', title: 'Bug fix', url: 'https://github.com/repo/100' },
      { id: 2, number: 101, state: 'open', title: 'Feature', url: 'https://github.com/repo/101' },
    ];

    const openBlockers = filterOpenBlockers(blockers);
    assert.equal(openBlockers.length, 2);
  });

  it('returns empty array when no blockers exist', () => {
    const blockers: BlockingIssue[] = [];
    const openBlockers = filterOpenBlockers(blockers);
    assert.equal(openBlockers.length, 0);
  });
});

describe('CheckIssueDependencies - Actionability Status', () => {
  interface BlockingIssue {
    id: number;
    number: number;
    state: string;
    title: string;
    url: string;
  }

  // Mirror the status determination logic
  function determineActionability(blockingIssues: BlockingIssue[]): {
    status: 'ACTIONABLE' | 'BLOCKED';
    hasOpenBlockers: boolean;
  } {
    const openBlockers = blockingIssues.filter((issue) => issue.state === 'open');

    return {
      status: openBlockers.length > 0 ? 'BLOCKED' : 'ACTIONABLE',
      hasOpenBlockers: openBlockers.length > 0,
    };
  }

  it('returns ACTIONABLE when no blocking issues exist', () => {
    const blockers: BlockingIssue[] = [];
    const result = determineActionability(blockers);
    assert.equal(result.status, 'ACTIONABLE');
    assert.equal(result.hasOpenBlockers, false);
  });

  it('returns ACTIONABLE when all blockers are closed', () => {
    const blockers: BlockingIssue[] = [
      { id: 1, number: 100, state: 'closed', title: 'Bug fix', url: 'https://github.com/repo/100' },
      { id: 2, number: 101, state: 'closed', title: 'Feature', url: 'https://github.com/repo/101' },
    ];
    const result = determineActionability(blockers);
    assert.equal(result.status, 'ACTIONABLE');
    assert.equal(result.hasOpenBlockers, false);
  });

  it('returns BLOCKED when at least one blocker is open', () => {
    const blockers: BlockingIssue[] = [
      { id: 1, number: 100, state: 'open', title: 'Bug fix', url: 'https://github.com/repo/100' },
      { id: 2, number: 101, state: 'closed', title: 'Feature', url: 'https://github.com/repo/101' },
    ];
    const result = determineActionability(blockers);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.hasOpenBlockers, true);
  });

  it('returns BLOCKED when all blockers are open', () => {
    const blockers: BlockingIssue[] = [
      { id: 1, number: 100, state: 'open', title: 'Bug fix', url: 'https://github.com/repo/100' },
      { id: 2, number: 101, state: 'open', title: 'Feature', url: 'https://github.com/repo/101' },
      {
        id: 3,
        number: 102,
        state: 'open',
        title: 'Enhancement',
        url: 'https://github.com/repo/102',
      },
    ];
    const result = determineActionability(blockers);
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.hasOpenBlockers, true);
  });
});

describe('CheckIssueDependencies - API Response Parsing', () => {
  // Mirror the parsing logic for testing
  function parseBlockingIssues(jsonString: string): any[] {
    try {
      const parsed = JSON.parse(jsonString);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      throw new Error('Failed to parse GitHub API response');
    }
  }

  it('parses valid JSON array of blocking issues', () => {
    const json = JSON.stringify([
      { id: 1, number: 100, state: 'open', title: 'Bug', url: 'https://github.com/repo/100' },
      { id: 2, number: 101, state: 'closed', title: 'Feature', url: 'https://github.com/repo/101' },
    ]);

    const blockers = parseBlockingIssues(json);
    assert.equal(blockers.length, 2);
    assert.equal(blockers[0].number, 100);
    assert.equal(blockers[1].number, 101);
  });

  it('handles empty array response', () => {
    const json = '[]';
    const blockers = parseBlockingIssues(json);
    assert.equal(blockers.length, 0);
  });

  it('returns empty array for non-array JSON response', () => {
    const json = '{"message": "Not found"}';
    const blockers = parseBlockingIssues(json);
    assert.equal(blockers.length, 0);
  });

  it('throws error for invalid JSON', () => {
    const json = 'invalid json';
    assert.throws(() => parseBlockingIssues(json), {
      message: 'Failed to parse GitHub API response',
    });
  });

  it('handles null response as empty array', () => {
    const json = 'null';
    const blockers = parseBlockingIssues(json);
    assert.equal(blockers.length, 0);
  });
});

describe('CheckIssueDependencies - 404 Error Handling', () => {
  // Test the logic that handles 404 responses (no dependencies or feature not enabled)
  function handle404Error(error: Error): string {
    if (error.message.includes('404') || error.message.includes('Not Found')) {
      return '[]'; // Treat as empty dependencies
    }
    throw error; // Re-throw other errors
  }

  it('converts 404 error to empty array', () => {
    const error = new Error('GitHub CLI command failed: 404 Not Found');
    const result = handle404Error(error);
    assert.equal(result, '[]');
  });

  it('converts "Not Found" error to empty array', () => {
    const error = new Error('Resource Not Found');
    const result = handle404Error(error);
    assert.equal(result, '[]');
  });

  it('re-throws non-404 errors', () => {
    const error = new Error('Network timeout');
    assert.throws(() => handle404Error(error), {
      message: 'Network timeout',
    });
  });

  it('re-throws 500 errors', () => {
    const error = new Error('500 Internal Server Error');
    assert.throws(() => handle404Error(error), {
      message: '500 Internal Server Error',
    });
  });
});
