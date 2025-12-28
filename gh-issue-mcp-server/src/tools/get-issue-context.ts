/**
 * Tool: gh_get_issue_context
 * Get comprehensive hierarchical context for a GitHub issue
 */

import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { ghCliJson, resolveRepo } from '../utils/gh-cli.js';
import { createErrorResult, ParsingError } from '../utils/errors.js';

/**
 * Validate GraphQL response has expected data field
 *
 * Validates response structure and throws a ParsingError with GitHub error
 * context if the response is missing the 'data' field.
 *
 * **Logging behavior:**
 * - Production: Only logs GitHub API error messages (safe, no sensitive data)
 * - Debug mode: Also logs response structure (keys, size) but NOT content to avoid leaking issue data
 *
 * @param result - GraphQL response to validate
 * @param queryName - Name of the query for error context (e.g., 'parent', 'children')
 * @param issueNumber - Issue number for error context
 * @throws {ParsingError} If response is missing 'data' field
 */
function validateGraphQLResponse(
  result: { data?: any; errors?: Array<{ message: string; type?: string }> },
  queryName: string,
  issueNumber: string | number
): void {
  if (!result.data) {
    const responseJson = JSON.stringify(result);
    const errors = result.errors || [];

    // ALWAYS log GitHub API error messages at WARN level - they're safe and critical for debugging
    // This ensures production users can diagnose authentication, permission, or rate limit issues
    if (errors.length > 0) {
      console.error(
        `[gh-issue] WARN GraphQL query failed (query: ${queryName}, issue: #${issueNumber}, errorCount: ${errors.length})`
      );
      errors.forEach((err, idx) => {
        console.error(
          `[gh-issue] WARN   Error ${idx + 1}: ${err.type || 'unknown'} - ${err.message || '(no message)'}`
        );
      });
    }

    // Log additional debug info in debug environments
    // Note: Only log response structure, not raw content, to avoid leaking sensitive issue data
    if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
      const safeStructure = {
        hasData: !!result.data,
        dataKeys: result.data ? Object.keys(result.data) : [],
        errorCount: errors.length,
        responseSize: responseJson.length,
      };
      console.error(
        `[gh-issue] DEBUG GraphQL response structure: ${JSON.stringify(safeStructure)}`
      );
    }

    // Build comprehensive error message with all errors
    const errorDetails =
      errors.length > 0
        ? errors
            .map((e, i) => `  ${i + 1}. [${e.type || 'unknown'}] ${e.message || '(no message)'}`)
            .join('\n')
        : '  (No error details available - check GitHub API status)';

    throw new ParsingError(
      `GraphQL response missing 'data' field when fetching ${queryName} for issue #${issueNumber}.\n` +
        `GitHub API Errors:\n${errorDetails}\n\n` +
        `Possible causes:\n` +
        `  - Issue #${issueNumber} does not exist\n` +
        `  - Insufficient permissions to access issue\n` +
        `  - GitHub API rate limit exceeded (check: gh api rate_limit)\n` +
        `  - Network/authentication issues (check: gh auth status)`
    );
  }
}

/**
 * Normalize issue data from GraphQL response
 *
 * Transforms GraphQL issue data to have comments as a flat array instead of
 * the nested { nodes: [...] } structure.
 *
 * RATIONALE: Simplifies downstream consumption. We fetch first 100 comments
 * (hard-coded in getCommentsFragment at `comments(first: 100)`) which is sufficient
 * for current use cases. If pagination becomes necessary, both getCommentsFragment
 * and this function will need updating.
 *
 * @param raw - Raw issue data from GraphQL with comments.nodes structure
 * @returns Normalized issue data with comments as flat array, or null if raw is null
 */
function normalizeIssueData<T extends { comments?: { nodes?: unknown[] } }>(
  raw: T | null
): (T & { comments: unknown[] }) | null {
  return raw ? { ...raw, comments: raw.comments?.nodes || [] } : null;
}

// Input schema
export const GetIssueContextInputSchema = z
  .object({
    issue_number: z.union([z.string(), z.number()]).transform(String),
    repo: z.string().optional(),
    include_comments: z.boolean().optional().default(true),
  })
  .strict();

export type GetIssueContextInput = z.infer<typeof GetIssueContextInputSchema>;

// Output types

/**
 * Issue data from GitHub GraphQL API
 *
 * @invariant When comments is undefined, it means comments were not requested
 *            (include_comments: false). When comments is an empty array, the
 *            issue has no comments. This distinction is important for callers.
 *
 * @remarks Comments are limited to first 100 per issue (hard-coded in GraphQL query).
 *          If an issue has more than 100 comments, only the first 100 are returned.
 */
interface IssueData {
  id: string; // Node ID for GraphQL
  number: number;
  title: string;
  url: string;
  body: string;
  /**
   * Comments on this issue (limited to first 100).
   * Undefined when comments not requested via include_comments parameter.
   */
  comments?: Array<{
    author: { login: string };
    body: string;
    createdAt: string;
  }>;
}

/**
 * Hierarchical context for a GitHub issue
 *
 * @invariant When comments_included is false, all IssueData objects in root,
 *            ancestors, current, children, and siblings will have undefined
 *            comments fields. When comments_included is true, comments may
 *            be populated (or empty arrays if no comments exist on an issue).
 *
 * @remarks The comments_included flag is set based on the include_comments
 *          input parameter and accurately reflects whether comments were fetched.
 */
interface IssueContext {
  root: IssueData | null;
  ancestors: IssueData[]; // [root, ..., parent] (excluding current)
  current: IssueData;
  children: IssueData[];
  siblings: IssueData[];
  /** Whether comments were included in the response (reflects include_comments input) */
  comments_included: boolean;
}

/**
 * Get GraphQL fragment for comments field
 *
 * Returns the comments GraphQL fragment if includeComments is true, otherwise
 * returns an empty string. This allows conditional inclusion of comments in
 * GraphQL queries for performance optimization.
 *
 * @param includeComments - Whether to include comments in the query
 * @returns GraphQL fragment string or empty string
 */
function getCommentsFragment(includeComments: boolean): string {
  if (!includeComments) {
    return '';
  }
  return `
    comments(first: 100) {
      nodes {
        author {
          login
        }
        body
        createdAt
      }
    }`;
}

/**
 * Get comprehensive hierarchical context for a GitHub issue
 *
 * Fetches complete issue hierarchy including ancestors (parent chain to root),
 * children (sub-issues), and siblings. Supports GitHub's sub-issues feature
 * for understanding issue relationships in large projects.
 *
 * @param input - Query configuration
 * @param input.issue_number - Issue number to fetch context for
 * @param input.repo - Repository in format "owner/repo" (defaults to current)
 *
 * @returns Hierarchical issue context with root, ancestors, current, children, siblings
 *
 * @throws {ParsingError} If GraphQL response is invalid or missing required fields
 *
 * @example
 * // Get full context for issue #123
 * await getIssueContext({ issue_number: 123 });
 *
 * @example
 * // Get context for issue in specific repo
 * await getIssueContext({ issue_number: "456", repo: "owner/repo" });
 */
export async function getIssueContext(input: GetIssueContextInput): Promise<ToolResult> {
  try {
    const resolvedRepo = await resolveRepo(input.repo);

    // Build fields list conditionally based on include_comments
    const fields = ['id', 'number', 'title', 'body', 'url'];
    if (input.include_comments) {
      fields.push('comments');
    }

    // Step 1: Fetch current issue details
    const issue = await ghCliJson<IssueData>(
      ['issue', 'view', input.issue_number, '--json', fields.join(',')],
      { repo: resolvedRepo }
    );

    // Step 2: Check for parent
    const commentsFragment = getCommentsFragment(input.include_comments);
    const parentQuery = `
      query($issueId: ID!) {
        node(id: $issueId) {
          ... on Issue {
            parent {
              id
              number
              title
              url
              body
              ${commentsFragment}
            }
          }
        }
      }
    `;

    const parentResult = await ghCliJson<any>(
      [
        'api',
        'graphql',
        '-H',
        'GraphQL-Features: sub_issues',
        '-f',
        `query=${parentQuery}`,
        '-f',
        `issueId=${issue.id}`,
      ],
      {}
    );

    // TODO: See issue #284 - Add integration tests for GraphQL validation error paths
    validateGraphQLResponse(parentResult, 'parent', input.issue_number);

    const parentRaw = parentResult.data?.node?.parent || null;
    const parent = normalizeIssueData(parentRaw);

    // Step 3: Recursively traverse ancestors to root
    const ancestors: IssueData[] = [];
    let currentAncestor = parent;

    while (currentAncestor) {
      ancestors.unshift(currentAncestor); // Add to front

      // Get parent of current ancestor
      const ancestorParentResult = await ghCliJson<any>(
        [
          'api',
          'graphql',
          '-H',
          'GraphQL-Features: sub_issues',
          '-f',
          `query=${parentQuery}`,
          '-f',
          `issueId=${currentAncestor.id}`,
        ],
        {}
      );

      validateGraphQLResponse(ancestorParentResult, 'ancestor-parent', currentAncestor.number);

      const ancestorParentRaw = ancestorParentResult.data?.node?.parent || null;
      currentAncestor = normalizeIssueData(ancestorParentRaw);
    }

    // Step 4: Fetch children
    const childrenQuery = `
      query($issueId: ID!) {
        node(id: $issueId) {
          ... on Issue {
            subIssues(first: 100) {
              nodes {
                id
                number
                title
                url
                body
                ${commentsFragment}
              }
            }
          }
        }
      }
    `;

    const childrenResult = await ghCliJson<any>(
      [
        'api',
        'graphql',
        '-H',
        'GraphQL-Features: sub_issues',
        '-f',
        `query=${childrenQuery}`,
        '-f',
        `issueId=${issue.id}`,
      ],
      {}
    );

    validateGraphQLResponse(childrenResult, 'children', input.issue_number);

    const childrenRaw = childrenResult.data?.node?.subIssues?.nodes || [];
    const children = childrenRaw.map((child: any) => normalizeIssueData(child)!).filter(Boolean);

    // Step 5: Fetch siblings (if parent exists)
    let siblings: IssueData[] = [];

    if (parent) {
      const siblingsResult = await ghCliJson<any>(
        [
          'api',
          'graphql',
          '-H',
          'GraphQL-Features: sub_issues',
          '-f',
          `query=${childrenQuery}`,
          '-f',
          `issueId=${parent.id}`,
        ],
        {}
      );

      validateGraphQLResponse(siblingsResult, 'siblings', input.issue_number);

      const allSiblingsRaw = siblingsResult.data?.node?.subIssues?.nodes || [];
      const allSiblings = allSiblingsRaw
        .map((sibling: any) => normalizeIssueData(sibling)!)
        .filter(Boolean);
      siblings = allSiblings.filter((s: IssueData) => s.number !== issue.number);
    }

    // Build context object
    const context: IssueContext = {
      root: ancestors.length > 0 ? ancestors[0] : null,
      ancestors: ancestors.slice(0, -1), // Exclude parent (last item)
      current: issue,
      children,
      siblings,
      comments_included: input.include_comments,
    };

    // Format as readable text with structured data
    const summary = formatIssueContextSummary(context);

    return {
      content: [
        {
          type: 'text',
          text: summary + '\n\n' + JSON.stringify(context, null, 2),
        },
      ],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}

/**
 * Format issue context into human-readable summary text
 *
 * Converts structured issue hierarchy into concise text representation showing
 * relationships at a glance. Includes root issue, ancestor chain, children, and
 * siblings with issue numbers and titles.
 *
 * @param context - Issue context object with hierarchy relationships
 * @returns Multi-line summary string with issue relationships
 *
 * @example
 * // Format context for issue with parent and children
 * const summary = formatIssueContextSummary({
 *   root: { number: 1, title: "Epic" },
 *   ancestors: [{ number: 10, title: "Feature" }],
 *   current: { number: 42, title: "Bug fix" },
 *   children: [{ number: 43 }, { number: 44 }],
 *   siblings: [{ number: 45 }]
 * });
 * // Returns:
 * // "Issue Context for #42: Bug fix
 * //  Root Issue: #1 - Epic
 * //  Ancestor Chain: #10
 * //  Children (2): #43, #44
 * //  Siblings (1): #45"
 */
function formatIssueContextSummary(context: IssueContext): string {
  const lines: string[] = [];

  // Helper to format comment count or body-only indicator
  const formatCommentInfo = (issue: IssueData) => {
    if (!context.comments_included) {
      return '(body only)';
    }
    return `(${issue.comments?.length || 0} comments)`;
  };

  lines.push(
    `Issue Context for #${context.current.number}: ${context.current.title} ${formatCommentInfo(context.current)}`
  );
  lines.push(`URL: ${context.current.url}`);
  lines.push('');

  if (context.root) {
    lines.push(
      `Root Issue: #${context.root.number} - ${context.root.title} ${formatCommentInfo(context.root)}`
    );
  }

  if (context.ancestors.length > 0) {
    lines.push(`Ancestor Chain: ${context.ancestors.map((a) => `#${a.number}`).join(' → ')}`);
  }

  if (context.children.length > 0) {
    lines.push(
      `Children (${context.children.length}): ${context.children.map((c) => `#${c.number}`).join(', ')}`
    );
  }

  if (context.siblings.length > 0) {
    lines.push(
      `Siblings (${context.siblings.length}): ${context.siblings.map((s) => `#${s.number}`).join(', ')}`
    );
  }

  if (!context.comments_included) {
    lines.push('');
    lines.push('Note: Comments not included (body-only mode)');
  }

  return lines.join('\n');
}
