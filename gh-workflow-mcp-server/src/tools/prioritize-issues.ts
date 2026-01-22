/**
 * Tool: gh_prioritize_issues
 * Prioritize GitHub issues using three-tier system with priority scoring
 */

import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { ghCliJson, resolveRepo } from '../utils/gh-cli.js';
import { ValidationError, createErrorResult } from '../utils/errors.js';

export const PrioritizeIssuesInputSchema = z
  .object({
    label: z.string().default('enhancement'),
    state: z.enum(['open', 'closed', 'all']).default('open'),
    limit: z.number().int().positive().max(1000).default(1000),
    repo: z.string().optional(),
  })
  .strict();

export type PrioritizeIssuesInput = z.infer<typeof PrioritizeIssuesInputSchema>;

interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly labels: ReadonlyArray<{ readonly name: string }>;
  readonly url: string;
  readonly comments: number;
  readonly body: string | null;
}

interface PrioritizedIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly tier: 1 | 2 | 3;
  readonly priority_score: number;
  readonly comment_count: number;
  readonly found_while_working_count: number;
  readonly labels: ReadonlyArray<string>;
}

/**
 * Extract count of issues referenced in "Found while working on" line
 *
 * @param body - Issue body text
 * @returns Number of issue references found (0 if none or body is null)
 *
 * @example
 * extractFoundWhileWorkingCount("Found while working on #123") // 1
 * extractFoundWhileWorkingCount("Found while working on #123, #456") // 2
 * extractFoundWhileWorkingCount("No reference") // 0
 */
function extractFoundWhileWorkingCount(body: string | null): number {
  if (!body) return 0;

  // Match "Found while working on" followed by issue references
  const foundWhilePattern = /Found while working on\s+([#\d,\s]+)/i;
  const match = body.match(foundWhilePattern);

  if (!match) return 0;

  // Count issue number references (#123, #456, etc.)
  const issueRefs = match[1].match(/#\d+/g);

  // Log warning if "Found while working on" exists but no issue references found
  if (!issueRefs || issueRefs.length === 0) {
    console.warn(
      `[gh-workflow] WARN extractFoundWhileWorkingCount found "Found while working on" pattern but no issue references. ` +
        `Issue body may have malformed references (missing # symbols). ` +
        `Pattern match: "${match[1]}" ` +
        `Expected format: "Found while working on #123, #456"`
    );
  }

  return issueRefs ? issueRefs.length : 0;
}

/**
 * Calculate priority score for an issue
 *
 * Priority score = max(comment_count, found_while_working_count)
 *
 * Rationale:
 * - Comment count indicates community engagement and clearer requirements
 * - "Found while working on" count indicates blocking or cross-cutting concerns
 * - Using maximum ensures issues are prioritized by either metric
 */
function calculatePriorityScore(issue: GitHubIssue): {
  priority_score: number;
  comment_count: number;
  found_while_working_count: number;
} {
  const comment_count = issue.comments;
  const found_while_working_count = extractFoundWhileWorkingCount(issue.body);

  return {
    priority_score: Math.max(comment_count, found_while_working_count),
    comment_count,
    found_while_working_count,
  };
}

/**
 * Determine which tier an issue belongs to
 *
 * Tier 1: Has both 'enhancement' AND 'bug' labels
 * Tier 2: Has 'enhancement' AND 'high priority' labels (but not 'bug')
 * Tier 3: Has 'enhancement' label only (without 'bug' or 'high priority')
 *
 * Note: This function is typically called on issues pre-filtered by the enhancement label,
 * so all inputs are expected to have the enhancement label.
 */
function determineTier(labels: ReadonlyArray<{ readonly name: string }>): 1 | 2 | 3 {
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

/**
 * Prioritize GitHub issues using three-tier system with priority scoring
 *
 * Categorizes issues into three tiers:
 * - Tier 1 (Highest): Enhancement + Bug (fixes bugs via enhancements)
 * - Tier 2 (High): Enhancement + High Priority (important enhancements)
 * - Tier 3 (Remaining): All other enhancement issues
 *
 * Within each tier, issues are sorted by priority score (descending):
 * priority_score = max(comment_count, found_while_working_count)
 *
 * This balances community engagement with blocking/cross-cutting concerns.
 *
 * @param input - Prioritization configuration
 * @param input.label - Issue label to filter by (default: 'enhancement')
 * @param input.state - Issue state filter (default: 'open')
 * @param input.limit - Maximum number of issues to fetch (default: 1000, max: 1000)
 * @param input.repo - Repository in format "owner/repo" (defaults to current)
 *
 * @returns Categorized and prioritized issues by tier
 *
 * @throws {ValidationError} If GitHub CLI fails or returns invalid data
 *
 * @example
 * // Prioritize open enhancement issues in current repo
 * await prioritizeIssues({ label: 'enhancement', state: 'open' });
 *
 * @example
 * // Prioritize feature requests in specific repo
 * await prioritizeIssues({ label: 'feature-request', state: 'open', repo: 'owner/repo' });
 */
export async function prioritizeIssues(input: PrioritizeIssuesInput): Promise<ToolResult> {
  try {
    const resolvedRepo = await resolveRepo(input.repo);

    // Fetch issues from GitHub (use any[] initially since we'll validate and normalize)
    const rawIssues = await ghCliJson<any[]>(
      [
        'issue',
        'list',
        '--label',
        input.label,
        '--state',
        input.state,
        '--json',
        'number,title,labels,url,comments,body',
        '--limit',
        input.limit.toString(),
      ],
      { repo: resolvedRepo }
    );

    if (!Array.isArray(rawIssues)) {
      throw new ValidationError('GitHub CLI returned invalid issue data (not an array)');
    }

    // Validate and normalize each issue
    const issues: GitHubIssue[] = rawIssues.map((issue) => {
      if (typeof issue.number !== 'number') {
        throw new ValidationError(
          `GitHub CLI returned issue without valid 'number' field. Issue data: ${JSON.stringify(issue).substring(0, 200)}`
        );
      }
      if (!Array.isArray(issue.labels)) {
        throw new ValidationError(
          `GitHub CLI returned issue #${issue.number} without valid 'labels' array. This may indicate a GitHub API schema change.`
        );
      }
      if (typeof issue.comments !== 'number') {
        console.warn(
          `[gh-workflow] WARN Issue #${issue.number} missing 'comments' field, defaulting to 0`
        );
        issue.comments = 0;
      }
      if (typeof issue.title !== 'string') {
        throw new ValidationError(
          `GitHub CLI returned issue #${issue.number} without valid 'title' field`
        );
      }
      if (typeof issue.url !== 'string') {
        throw new ValidationError(
          `GitHub CLI returned issue #${issue.number} without valid 'url' field`
        );
      }
      return issue as GitHubIssue;
    });

    if (issues.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `No ${input.state} issues found with label "${input.label}" in ${resolvedRepo}`,
          },
        ],
      };
    }

    // Categorize and score all issues
    const prioritizedIssues: PrioritizedIssue[] = issues.map((issue) => {
      const tier = determineTier(issue.labels);
      const { priority_score, comment_count, found_while_working_count } =
        calculatePriorityScore(issue);

      return {
        number: issue.number,
        title: issue.title,
        url: issue.url,
        tier,
        priority_score,
        comment_count,
        found_while_working_count,
        labels: issue.labels.map((l) => l.name),
      };
    });

    // Sort by tier (ascending: 1, 2, 3) then by priority_score (descending)
    prioritizedIssues.sort((a, b) => {
      if (a.tier !== b.tier) {
        return a.tier - b.tier; // Lower tier number = higher priority
      }
      return b.priority_score - a.priority_score; // Higher score = higher priority
    });

    // Group by tier for output
    const tier1 = prioritizedIssues.filter((i) => i.tier === 1);
    const tier2 = prioritizedIssues.filter((i) => i.tier === 2);
    const tier3 = prioritizedIssues.filter((i) => i.tier === 3);

    // Format output
    const lines: string[] = [
      `Prioritized ${issues.length} issues from ${resolvedRepo}`,
      `Label: "${input.label}" | State: ${input.state}`,
      '',
    ];

    const formatIssueList = (tierIssues: PrioritizedIssue[], tierName: string) => {
      if (tierIssues.length === 0) return;

      lines.push(`${tierName} (${tierIssues.length} issues):`);
      tierIssues.forEach((issue, idx) => {
        const scoreDetails = [];
        if (issue.comment_count > 0) {
          scoreDetails.push(`${issue.comment_count} comments`);
        }
        if (issue.found_while_working_count > 0) {
          scoreDetails.push(`found in ${issue.found_while_working_count} issues`);
        }
        const scoreStr = scoreDetails.length > 0 ? ` [${scoreDetails.join(', ')}]` : '';

        lines.push(`  ${idx + 1}. #${issue.number}: ${issue.title}${scoreStr}`);
        lines.push(`     Score: ${issue.priority_score} | ${issue.url}`);
      });
      lines.push('');
    };

    formatIssueList(tier1, 'Tier 1: Enhancement + Bug (Highest Priority)');
    formatIssueList(tier2, 'Tier 2: Enhancement + High Priority');
    formatIssueList(tier3, 'Tier 3: Other Enhancements');

    lines.push('Priority Score Formula: max(comment_count, found_while_working_count)');

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
