/**
 * Tests for find-duplicate-issues tool
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('FindDuplicateIssues - Title Normalization', () => {
  // Mirror the normalizeTitle function for testing
  function normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim();
  }

  it('converts to lowercase', () => {
    assert.equal(normalizeTitle('Fix Bug In Parser'), 'fix bug in parser');
  });

  it('removes punctuation except spaces and hyphens', () => {
    assert.equal(normalizeTitle('Fix: Bug in Parser!'), 'fix bug in parser');
    assert.equal(normalizeTitle('Add error-handling support'), 'add error-handling support');
  });

  it('preserves hyphens', () => {
    assert.equal(normalizeTitle('Add error-handling'), 'add error-handling');
  });

  it('trims leading and trailing whitespace', () => {
    assert.equal(normalizeTitle('  Fix bug  '), 'fix bug');
  });

  it('handles multiple spaces', () => {
    assert.equal(normalizeTitle('Fix    bug    here'), 'fix    bug    here');
  });

  it('handles empty string', () => {
    assert.equal(normalizeTitle(''), '');
  });

  it('removes special characters', () => {
    assert.equal(normalizeTitle('Fix @bug #123 (urgent)'), 'fix bug 123 urgent');
  });

  it('handles mixed case and punctuation', () => {
    assert.equal(normalizeTitle('ADD: Error-Handling Support!'), 'add error-handling support');
  });
});

describe('FindDuplicateIssues - Title Tokenization', () => {
  // Mirror the tokenizeTitle function for testing
  function tokenizeTitle(title: string): Set<string> {
    const words = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0);

    return new Set(words);
  }

  it('tokenizes simple title into words', () => {
    const tokens = tokenizeTitle('Fix bug in parser');
    assert.deepEqual([...tokens].sort(), ['bug', 'fix', 'in', 'parser']);
  });

  it('removes punctuation and splits on non-alphanumeric', () => {
    const tokens = tokenizeTitle('error-handling support');
    assert.deepEqual([...tokens].sort(), ['error', 'handling', 'support']);
  });

  it('converts to lowercase', () => {
    const tokens = tokenizeTitle('Fix Bug Parser');
    assert.deepEqual([...tokens].sort(), ['bug', 'fix', 'parser']);
  });

  it('removes duplicate words (Set behavior)', () => {
    const tokens = tokenizeTitle('fix fix bug bug');
    assert.deepEqual([...tokens].sort(), ['bug', 'fix']);
  });

  it('handles empty string', () => {
    const tokens = tokenizeTitle('');
    assert.equal(tokens.size, 0);
  });

  it('filters out empty tokens from multiple spaces', () => {
    const tokens = tokenizeTitle('fix    bug');
    assert.deepEqual([...tokens].sort(), ['bug', 'fix']);
  });

  it('preserves numbers as tokens', () => {
    const tokens = tokenizeTitle('Fix bug 123');
    assert.deepEqual([...tokens].sort(), ['123', 'bug', 'fix']);
  });

  it('handles special characters by replacing with spaces', () => {
    const tokens = tokenizeTitle('fix@bug#here');
    assert.deepEqual([...tokens].sort(), ['bug', 'fix', 'here']);
  });
});

describe('FindDuplicateIssues - Jaccard Similarity Calculation', () => {
  // Mirror the calculateJaccardSimilarity function for testing
  function tokenizeTitle(title: string): Set<string> {
    const words = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0);
    return new Set(words);
  }

  function calculateJaccardSimilarity(title1: string, title2: string): number {
    const tokens1 = tokenizeTitle(title1);
    const tokens2 = tokenizeTitle(title2);

    if (tokens1.size === 0 && tokens2.size === 0) {
      return 1.0;
    }

    if (tokens1.size === 0 || tokens2.size === 0) {
      return 0.0;
    }

    const intersection = new Set([...tokens1].filter((token) => tokens2.has(token)));
    const union = new Set([...tokens1, ...tokens2]);

    return intersection.size / union.size;
  }

  it('returns 1.0 for identical titles', () => {
    const similarity = calculateJaccardSimilarity('Fix bug in parser', 'Fix bug in parser');
    assert.equal(similarity, 1.0);
  });

  it('returns 0.0 for completely different titles', () => {
    const similarity = calculateJaccardSimilarity('Fix bug', 'Add feature');
    assert.equal(similarity, 0.0);
  });

  it('calculates correct similarity for partial overlap', () => {
    // "Add error handling" vs "Add error-handling support"
    // Tokens1: {add, error, handling} = 3
    // Tokens2: {add, error, handling, support} = 4
    // Intersection: {add, error, handling} = 3
    // Union: {add, error, handling, support} = 4
    // Similarity: 3/4 = 0.75
    const similarity = calculateJaccardSimilarity(
      'Add error handling',
      'Add error-handling support'
    );
    assert.equal(similarity, 0.75);
  });

  it('handles case insensitivity', () => {
    const similarity = calculateJaccardSimilarity('Fix Bug', 'fix bug');
    assert.equal(similarity, 1.0);
  });

  it('returns 1.0 for both empty titles', () => {
    const similarity = calculateJaccardSimilarity('', '');
    assert.equal(similarity, 1.0);
  });

  it('returns 0.0 when one title is empty', () => {
    const similarity = calculateJaccardSimilarity('Fix bug', '');
    assert.equal(similarity, 0.0);
  });

  it('calculates correct similarity for single word overlap', () => {
    // "Fix parser" vs "Fix bug"
    // Tokens1: {fix, parser} = 2
    // Tokens2: {fix, bug} = 2
    // Intersection: {fix} = 1
    // Union: {fix, parser, bug} = 3
    // Similarity: 1/3 ≈ 0.333
    const similarity = calculateJaccardSimilarity('Fix parser', 'Fix bug');
    assert.ok(Math.abs(similarity - 0.333) < 0.01);
  });

  it('handles titles with duplicate words correctly', () => {
    // "fix fix bug" vs "fix bug bug"
    // After tokenization (Sets):
    // Tokens1: {fix, bug} = 2
    // Tokens2: {fix, bug} = 2
    // Intersection: {fix, bug} = 2
    // Union: {fix, bug} = 2
    // Similarity: 2/2 = 1.0
    const similarity = calculateJaccardSimilarity('fix fix bug', 'fix bug bug');
    assert.equal(similarity, 1.0);
  });

  it('calculates similarity with punctuation removed', () => {
    const similarity = calculateJaccardSimilarity('Fix: bug in parser!', 'Fix bug in parser');
    assert.equal(similarity, 1.0);
  });

  it('returns high similarity for titles with extra words', () => {
    // "Add feature" vs "Add feature to system"
    // Tokens1: {add, feature} = 2
    // Tokens2: {add, feature, to, system} = 4
    // Intersection: {add, feature} = 2
    // Union: {add, feature, to, system} = 4
    // Similarity: 2/4 = 0.5
    const similarity = calculateJaccardSimilarity('Add feature', 'Add feature to system');
    assert.equal(similarity, 0.5);
  });
});

describe('FindDuplicateIssues - In Progress Label Detection', () => {
  // Mirror the hasInProgressLabel function for testing
  function hasInProgressLabel(labels: Array<{ name: string }>): boolean {
    return labels.some((label) => label.name.toLowerCase() === 'in progress');
  }

  it('detects "in progress" label', () => {
    const labels = [{ name: 'in progress' }];
    assert.equal(hasInProgressLabel(labels), true);
  });

  it('handles case insensitive matching', () => {
    const labels = [{ name: 'In Progress' }];
    assert.equal(hasInProgressLabel(labels), true);
  });

  it('returns false when "in progress" label not present', () => {
    const labels = [{ name: 'bug' }, { name: 'enhancement' }];
    assert.equal(hasInProgressLabel(labels), false);
  });

  it('returns false for empty label array', () => {
    const labels: Array<{ name: string }> = [];
    assert.equal(hasInProgressLabel(labels), false);
  });

  it('detects label among multiple labels', () => {
    const labels = [{ name: 'bug' }, { name: 'in progress' }, { name: 'high priority' }];
    assert.equal(hasInProgressLabel(labels), true);
  });

  it('handles uppercase variant', () => {
    const labels = [{ name: 'IN PROGRESS' }];
    assert.equal(hasInProgressLabel(labels), true);
  });

  it('handles mixed case variant', () => {
    const labels = [{ name: 'In PrOgReSs' }];
    assert.equal(hasInProgressLabel(labels), true);
  });

  it('does not match partial strings', () => {
    const labels = [{ name: 'progress' }, { name: 'in-progress' }];
    assert.equal(hasInProgressLabel(labels), false);
  });
});

describe('FindDuplicateIssues - Exact Match Detection', () => {
  function normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim();
  }

  it('matches identical titles exactly', () => {
    const title1 = 'Fix bug in parser';
    const title2 = 'Fix bug in parser';
    assert.equal(normalizeTitle(title1), normalizeTitle(title2));
  });

  it('matches titles with different punctuation', () => {
    const title1 = 'Fix: bug in parser!';
    const title2 = 'Fix bug in parser';
    assert.equal(normalizeTitle(title1), normalizeTitle(title2));
  });

  it('matches titles with different case', () => {
    const title1 = 'Fix Bug In Parser';
    const title2 = 'fix bug in parser';
    assert.equal(normalizeTitle(title1), normalizeTitle(title2));
  });

  it('does not match titles with different words', () => {
    const title1 = 'Fix bug in parser';
    const title2 = 'Fix bug in lexer';
    assert.notEqual(normalizeTitle(title1), normalizeTitle(title2));
  });

  it('matches titles with extra spaces', () => {
    const title1 = 'Fix   bug   in   parser';
    const title2 = 'Fix bug in parser';
    // Note: normalizeTitle preserves internal spaces, so this won't match exactly
    // unless we collapse multiple spaces. Current implementation preserves them.
    assert.notEqual(normalizeTitle(title1), normalizeTitle(title2));
  });
});

describe('FindDuplicateIssues - Similarity Threshold Logic', () => {
  function tokenizeTitle(title: string): Set<string> {
    const words = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0);
    return new Set(words);
  }

  function calculateJaccardSimilarity(title1: string, title2: string): number {
    const tokens1 = tokenizeTitle(title1);
    const tokens2 = tokenizeTitle(title2);
    if (tokens1.size === 0 && tokens2.size === 0) return 1.0;
    if (tokens1.size === 0 || tokens2.size === 0) return 0.0;
    const intersection = new Set([...tokens1].filter((token) => tokens2.has(token)));
    const union = new Set([...tokens1, ...tokens2]);
    return intersection.size / union.size;
  }

  it('identifies match when similarity >= 0.7 threshold', () => {
    const similarity = calculateJaccardSimilarity(
      'Add error handling',
      'Add error-handling support'
    );
    assert.equal(similarity, 0.75);
    assert.ok(similarity >= 0.7);
  });

  it('rejects match when similarity < 0.7 threshold', () => {
    const similarity = calculateJaccardSimilarity('Fix parser', 'Fix bug');
    assert.ok(similarity < 0.7);
  });

  it('matches at exactly 0.7 threshold', () => {
    // Need titles with exactly 70% overlap
    // "a b c d e f g" (7 words) vs "a b c d e h i" (7 words)
    // Intersection: {a, b, c, d, e} = 5
    // Union: {a, b, c, d, e, f, g, h, i} = 9
    // Similarity: 5/9 ≈ 0.555 (not 0.7)
    // Let's try: "a b c d e f g" vs "a b c d e f h"
    // Intersection: {a, b, c, d, e, f} = 6
    // Union: {a, b, c, d, e, f, g, h} = 8
    // Similarity: 6/8 = 0.75
    // Try: "a b c d e f g h i j" (10) vs "a b c d e f g k l m" (10)
    // Intersection: {a, b, c, d, e, f, g} = 7
    // Union: {a, b, c, d, e, f, g, h, i, j, k, l, m} = 13
    // Similarity: 7/13 ≈ 0.538
    // Better: "a b c" (3) vs "a b c d e f g" (7)
    // Intersection: {a, b, c} = 3
    // Union: {a, b, c, d, e, f, g} = 7
    // Similarity: 3/7 ≈ 0.428
    // Try: "a b c d" (4) vs "a b c d e f" (6)
    // Intersection: 4, Union: 6, Similarity: 4/6 ≈ 0.667
    // Try: "a b c d e f g" (7) vs "a b c d e f g h i j" (10)
    // Intersection: 7, Union: 10, Similarity: 7/10 = 0.7 ✓

    const similarity = calculateJaccardSimilarity('a b c d e f g', 'a b c d e f g h i j');
    assert.equal(similarity, 0.7);
  });
});
