/**
 * Tool: gh_find_duplicate_issues
 * Find duplicate issues using exact title match and Jaccard similarity
 */

import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { ghCliJson, resolveRepo } from '../utils/gh-cli.js';
import { createErrorResult } from '../utils/errors.js';

export const FindDuplicateIssuesInputSchema = z
  .object({
    reference_issue: z.number().int().positive(),
    candidate_issues: z.array(z.number().int().positive()),
    similarity_threshold: z.number().min(0).max(1).default(0.7),
    repo: z.string().optional(),
  })
  .strict();

export type FindDuplicateIssuesInput = z.infer<typeof FindDuplicateIssuesInputSchema>;

interface GitHubIssue {
  number: number;
  title: string;
  url: string;
  labels: Array<{ name: string }>;
}

interface DuplicateMatch {
  issue_number: number;
  title: string;
  url: string;
  match_type: 'exact' | 'similar';
  similarity_score?: number;
  has_in_progress_label: boolean;
}

/**
 * Normalize title for exact comparison
 *
 * Normalization steps:
 * 1. Convert to lowercase
 * 2. Remove all punctuation except spaces and hyphens
 * 3. Trim whitespace
 *
 * @param title - Issue title to normalize
 * @returns Normalized title string
 *
 * @example
 * normalizeTitle("Fix: Bug in Parser!") // "fix bug in parser"
 * normalizeTitle("Add error-handling support") // "add error-handling support"
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove punctuation except spaces and hyphens
    .trim();
}

/**
 * Tokenize title into word set for Jaccard similarity
 *
 * @param title - Issue title to tokenize
 * @returns Set of lowercase alphanumeric words
 *
 * @example
 * tokenizeTitle("Fix error-handling in parser") // Set{"fix", "error", "handling", "in", "parser"}
 */
function tokenizeTitle(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // Replace non-alphanumeric with spaces
    .split(/\s+/)
    .filter((w) => w.length > 0);

  return new Set(words);
}

/**
 * Calculate Jaccard similarity between two titles
 *
 * Jaccard similarity = |intersection| / |union|
 *
 * @param title1 - First title
 * @param title2 - Second title
 * @returns Similarity score between 0 and 1
 *
 * @example
 * calculateJaccardSimilarity("Add error handling", "Add error-handling support")
 * // Common: {add, error, handling} = 3
 * // Total unique: {add, error, handling, support} = 4
 * // Similarity: 3/4 = 0.75
 */
function calculateJaccardSimilarity(title1: string, title2: string): number {
  const tokens1 = tokenizeTitle(title1);
  const tokens2 = tokenizeTitle(title2);

  if (tokens1.size === 0 && tokens2.size === 0) {
    return 1.0; // Both empty = identical
  }

  if (tokens1.size === 0 || tokens2.size === 0) {
    return 0.0; // One empty = no similarity
  }

  // Calculate intersection
  const intersection = new Set([...tokens1].filter((token) => tokens2.has(token)));

  // Calculate union
  const union = new Set([...tokens1, ...tokens2]);

  return intersection.size / union.size;
}

/**
 * Check if an issue has the "in progress" label
 *
 * @param labels - Issue labels array
 * @returns True if "in progress" label is present (case insensitive)
 */
function hasInProgressLabel(labels: Array<{ name: string }>): boolean {
  return labels.some((label) => label.name.toLowerCase() === 'in progress');
}

/**
 * Find duplicate issues using exact title match and Jaccard similarity
 *
 * Detection layers:
 * 1. Exact Match: Normalized titles match exactly (auto-close recommended)
 * 2. High Similarity: Jaccard similarity ≥ threshold (user confirmation recommended)
 *
 * Safety: Issues with "in progress" label are flagged but never auto-closed
 *
 * @param input - Duplicate detection configuration
 * @param input.reference_issue - Issue number to compare against
 * @param input.candidate_issues - Array of issue numbers to check for duplicates
 * @param input.similarity_threshold - Minimum similarity for "similar" match (default: 0.7)
 * @param input.repo - Repository in format "owner/repo" (defaults to current)
 *
 * @returns List of duplicate matches categorized by match type
 *
 * @throws {ValidationError} If GitHub CLI fails or returns invalid data
 *
 * @example
 * // Find duplicates of issue #100 among candidates
 * await findDuplicateIssues({
 *   reference_issue: 100,
 *   candidate_issues: [101, 102, 103],
 *   similarity_threshold: 0.7
 * });
 */
export async function findDuplicateIssues(input: FindDuplicateIssuesInput): Promise<ToolResult> {
  try {
    const resolvedRepo = await resolveRepo(input.repo);

    // Fetch all issues (reference + candidates) in one batch
    const issueNumbers = [input.reference_issue, ...input.candidate_issues];
    const issuePromises = issueNumbers.map((num) =>
      ghCliJson<GitHubIssue>(
        ['issue', 'view', num.toString(), '--json', 'number,title,url,labels'],
        { repo: resolvedRepo }
      )
    );

    const issues = await Promise.all(issuePromises);

    // Extract reference issue
    const referenceIssue = issues[0];
    const candidateIssueData = issues.slice(1);

    const normalizedReferenceTitle = normalizeTitle(referenceIssue.title);

    // Find duplicates
    const exactMatches: DuplicateMatch[] = [];
    const similarMatches: DuplicateMatch[] = [];

    for (const candidate of candidateIssueData) {
      const normalizedCandidateTitle = normalizeTitle(candidate.title);
      const hasInProgress = hasInProgressLabel(candidate.labels);

      // Layer 1: Exact title match
      if (normalizedCandidateTitle === normalizedReferenceTitle) {
        exactMatches.push({
          issue_number: candidate.number,
          title: candidate.title,
          url: candidate.url,
          match_type: 'exact',
          has_in_progress_label: hasInProgress,
        });
        continue; // Skip similarity check if exact match found
      }

      // Layer 2: High similarity match
      const similarity = calculateJaccardSimilarity(referenceIssue.title, candidate.title);
      if (similarity >= input.similarity_threshold) {
        similarMatches.push({
          issue_number: candidate.number,
          title: candidate.title,
          url: candidate.url,
          match_type: 'similar',
          similarity_score: Math.round(similarity * 100) / 100, // Round to 2 decimals
          has_in_progress_label: hasInProgress,
        });
      }
    }

    // Format output
    const lines: string[] = [
      `Duplicate detection for issue #${input.reference_issue}: "${referenceIssue.title}"`,
      `Repository: ${resolvedRepo}`,
      `Checked ${input.candidate_issues.length} candidate issues`,
      '',
    ];

    if (exactMatches.length === 0 && similarMatches.length === 0) {
      lines.push('No duplicates found.');
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    }

    if (exactMatches.length > 0) {
      lines.push(`Exact Matches (${exactMatches.length}):`);
      exactMatches.forEach((match) => {
        const inProgressFlag = match.has_in_progress_label ? ' [IN PROGRESS - DO NOT CLOSE]' : '';
        lines.push(`  - #${match.issue_number}: ${match.title}${inProgressFlag}`);
        lines.push(`    ${match.url}`);
      });
      lines.push('');
    }

    if (similarMatches.length > 0) {
      lines.push(
        `Similar Matches (≥${input.similarity_threshold * 100}% similarity, ${similarMatches.length}):`
      );
      similarMatches.forEach((match) => {
        const inProgressFlag = match.has_in_progress_label ? ' [IN PROGRESS - DO NOT CLOSE]' : '';
        const similarityPercent = Math.round((match.similarity_score || 0) * 100);
        lines.push(
          `  - #${match.issue_number}: ${match.title} (${similarityPercent}% similar)${inProgressFlag}`
        );
        lines.push(`    ${match.url}`);
      });
      lines.push('');
    }

    lines.push('Recommendations:');
    lines.push('- Exact matches: Safe to auto-close (unless marked IN PROGRESS)');
    lines.push('- Similar matches: Request user confirmation before closing');
    lines.push('- NEVER close issues with "in progress" label');

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
