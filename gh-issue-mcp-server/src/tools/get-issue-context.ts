/**
 * Tool: gh_get_issue_context
 * Get comprehensive hierarchical context for a GitHub issue
 */

import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { ghCliJson, resolveRepo } from '../utils/gh-cli.js';
import { createErrorResult, ParsingError, ValidationError, NetworkError } from '../utils/errors.js';

/**
 * Validate GraphQL response has expected data field
 *
 * Validates that GraphQL response contains a 'data' field, indicating successful
 * query execution. Throws an appropriate error with GitHub error context if the
 * 'data' field is missing. Error types are chosen based on the GraphQL error type
 * to preserve error semantics for upstream handling.
 *
 * **Error type mapping:**
 * - FORBIDDEN -> ValidationError (permission issues, not retryable)
 * - NOT_FOUND -> ValidationError (issue/repo doesn't exist, not retryable)
 * - RATE_LIMITED -> NetworkError (transient, may be retryable after delay)
 * - Other/unknown -> ParsingError (server errors, unknown failures)
 *
 * **Logging behavior:**
 * - Production: Only logs GitHub API error messages (safe, no sensitive data)
 * - Debug mode: Also logs response structure (keys, size) but NOT content to avoid leaking issue data
 *
 * @param result - GraphQL response to validate
 * @param queryName - Name of the query for error context (e.g., 'parent', 'children')
 * @param issueNumber - Issue number for error context
 * @throws {ValidationError} If response contains FORBIDDEN or NOT_FOUND errors
 * @throws {NetworkError} If response contains RATE_LIMITED errors
 * @throws {ParsingError} If response is missing 'data' field with unknown error types
 */
function validateGraphQLResponse(
  result: { data?: any; errors?: Array<{ message: string; type?: string }> },
  queryName: string,
  issueNumber: string | number
): void {
  if (!result.data) {
    const responseJson = JSON.stringify(result);
    const errors = result.errors || [];

    // ALWAYS log GitHub API error messages - they're safe and critical for debugging
    // Logged via console.error() with WARN prefix to indicate warning severity
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

    // Extract error types to classify the failure appropriately
    const errorTypes = errors.map((e) => e.type || 'UNKNOWN');
    const hasPermissionError = errorTypes.some((t) => t === 'FORBIDDEN');
    const hasNotFoundError = errorTypes.some((t) => t === 'NOT_FOUND');
    const hasRateLimitError = errorTypes.some((t) => t === 'RATE_LIMITED');

    // Choose appropriate error type based on GraphQL error types
    // This preserves error semantics for proper handling upstream
    if (hasPermissionError) {
      throw new ValidationError(
        `GraphQL permission error when fetching ${queryName} for issue #${issueNumber}.\n` +
          `GitHub API Errors:\n${errorDetails}\n\n` +
          `Cause: Insufficient permissions to access issue or repository.\n` +
          `Action: Check GitHub token permissions (gh auth status)`
      );
    }

    if (hasNotFoundError) {
      throw new ValidationError(
        `GraphQL not found error when fetching ${queryName} for issue #${issueNumber}.\n` +
          `GitHub API Errors:\n${errorDetails}\n\n` +
          `Cause: Issue #${issueNumber} does not exist or repository not found.\n` +
          `Action: Verify issue number and repository access`
      );
    }

    if (hasRateLimitError) {
      throw new NetworkError(
        `GraphQL rate limit error when fetching ${queryName} for issue #${issueNumber}.\n` +
          `GitHub API Errors:\n${errorDetails}\n\n` +
          `Cause: API rate limit exceeded.\n` +
          `Action: Check rate limit status (gh api rate_limit) and wait before retrying`
      );
    }

    // Default to ParsingError for unknown/unclassified GraphQL errors
    throw new ParsingError(
      `GraphQL response missing 'data' field when fetching ${queryName} for issue #${issueNumber}.\n` +
        `GitHub API Errors:\n${errorDetails}\n\n` +
        `Possible causes:\n` +
        `  - GitHub API server error\n` +
        `  - Network/authentication issues (check: gh auth status)\n` +
        `  - Unknown GraphQL error types: ${errorTypes.join(', ')}`
    );
  }
}

/**
 * Normalize issue data from GraphQL response
 *
 * Transforms GraphQL issue data to the proper discriminated union type based on
 * whether comments were requested. This enforces type-level semantics for the
 * distinction between "comments not fetched" and "no comments".
 *
 * RATIONALE: Simplifies downstream consumption by flattening GraphQL's nested structure
 * and provides type-safe access to comments based on the includeComments flag.
 *
 * When includeComments is true, transforms:
 *   { comments: { nodes: [{author: {...}, body: '...'}] } }
 * Into:
 *   { comments_included: true, comments: [{author: {...}, body: '...'}] }
 *
 * When includeComments is false:
 *   { id, number, title, url, body }
 * Into:
 *   { comments_included: false, id, number, title, url, body }
 *
 * We fetch first 100 comments (hard-coded in getCommentsFragment at `comments(first: 100)`)
 * which is sufficient for current use cases. If pagination becomes necessary, both
 * getCommentsFragment and this function will need updating.
 *
 * @param raw - Raw issue data from GraphQL with comments.nodes structure
 * @param includeComments - Whether comments were requested in the query
 * @returns Normalized issue data as discriminated union, or null if raw is null
 */
function normalizeIssueData(
  raw: {
    id: string;
    number: number;
    title: string;
    url: string;
    body: string;
    comments?: { nodes?: IssueComment[] };
  } | null,
  includeComments: boolean
): IssueData | null {
  if (!raw) return null;

  const { comments: rawComments, ...baseFields } = raw;

  if (includeComments) {
    return {
      ...baseFields,
      comments_included: true as const,
      comments: rawComments?.nodes || [],
    };
  } else {
    return {
      ...baseFields,
      comments_included: false as const,
    };
  }
}

/**
 * Normalize issue data from gh CLI REST response
 *
 * The gh CLI `issue view --json` returns comments as a flat array, not nested
 * in `nodes` like GraphQL responses. This function handles that format.
 *
 * @param raw - Raw issue data from gh CLI with flat comments array
 * @param includeComments - Whether comments were requested
 * @returns Normalized issue data as discriminated union
 */
function normalizeCliIssueData(
  raw: {
    id: string;
    number: number;
    title: string;
    url: string;
    body: string;
    comments?: IssueComment[];
  },
  includeComments: boolean
): IssueData {
  const { comments: rawComments, ...baseFields } = raw;

  if (includeComments) {
    return {
      ...baseFields,
      comments_included: true as const,
      comments: rawComments || [],
    };
  } else {
    return {
      ...baseFields,
      comments_included: false as const,
    };
  }
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
 * Comment structure from GitHub GraphQL API
 */
interface IssueComment {
  readonly author: { readonly login: string };
  readonly body: string;
  readonly createdAt: string;
}

/**
 * Base fields shared by all issue data variants
 */
interface IssueDataBase {
  readonly id: string; // Node ID for GraphQL
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly body: string;
}

/**
 * Issue data with comments included (include_comments: true)
 *
 * @remarks Comments are limited to first 100 per issue (hard-coded in GraphQL query).
 *          If an issue has more than 100 comments, only the first 100 are returned.
 */
interface IssueDataWithComments extends IssueDataBase {
  readonly comments_included: true;
  readonly comments: ReadonlyArray<IssueComment>;
}

/**
 * Issue data without comments (include_comments: false)
 *
 * Comments field is omitted when not requested, providing clear type-level
 * distinction from empty comments array.
 */
interface IssueDataWithoutComments extends IssueDataBase {
  readonly comments_included: false;
}

/**
 * Discriminated union for issue data from GitHub GraphQL API
 *
 * Uses a discriminated union to enforce correct semantics at the type level:
 * - When comments_included is true: comments is guaranteed to be an array (may be empty)
 * - When comments_included is false: comments field is not present
 *
 * This eliminates the ambiguity between "comments not fetched" and "no comments"
 * that existed with the optional comments field approach.
 *
 * @example
 * // Type-safe comment access
 * if (issue.comments_included) {
 *   // TypeScript knows comments exists and is an array
 *   console.log(issue.comments.length);
 * }
 */
type IssueData = IssueDataWithComments | IssueDataWithoutComments;

/**
 * Hierarchical context for a GitHub issue
 *
 * @invariant All IssueData objects in this context share the same comments_included
 *            value, determined by the include_comments input parameter. The top-level
 *            comments_included field expresses this invariant at the type level.
 *
 * @remarks When comments_included is true, all IssueData objects have comments as
 *          an array (may be empty). When false, no IssueData has comments field.
 *          The individual IssueData.comments_included discriminants are redundant
 *          but preserved for backwards compatibility and direct issue access patterns.
 */
interface IssueContext {
  readonly root: IssueData | null;
  readonly ancestors: readonly IssueData[]; // [root, ..., parent] (excluding current)
  readonly current: IssueData;
  readonly children: readonly IssueData[];
  readonly siblings: readonly IssueData[];
  /** Whether comments were included in the query - applies to ALL issues in context */
  readonly comments_included: boolean;
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
    // Note: gh CLI returns comments as flat array, not nested in nodes
    const issueRaw = await ghCliJson<{
      id: string;
      number: number;
      title: string;
      url: string;
      body: string;
      comments?: IssueComment[];
    }>(['issue', 'view', input.issue_number, '--json', fields.join(',')], { repo: resolvedRepo });
    const issue = normalizeCliIssueData(issueRaw, input.include_comments);

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

    // TODO(#1020): GraphQL errors in gh-issue get-issue-context.ts logged but query continues - potential partial data returned
    // TODO: See issue #284 - Add integration tests for GraphQL validation error paths
    validateGraphQLResponse(parentResult, 'parent', input.issue_number);

    const parentRaw = parentResult.data?.node?.parent || null;
    const parent = normalizeIssueData(parentRaw, input.include_comments);

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
      currentAncestor = normalizeIssueData(ancestorParentRaw, input.include_comments);
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
    const children = childrenRaw
      .map((child: any) => normalizeIssueData(child, input.include_comments)!)
      .filter(Boolean);

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
        .map((sibling: any) => normalizeIssueData(sibling, input.include_comments)!)
        .filter(Boolean);
      siblings = allSiblings.filter((s: IssueData) => s.number !== issue.number);
    }

    // Build context object
    // Top-level comments_included expresses the invariant that all issues share the same value
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
    // Create error result with retryability metadata
    // This preserves error type semantics for callers to implement appropriate retry logic
    const result = createErrorResult(error);

    // Add retryable flag based on error type
    // - ValidationError: Not retryable (issue doesn't exist, no permissions)
    // - NetworkError: Retryable after delay (rate limits, transient failures)
    // - ParsingError: Potentially retryable (server errors, unknown failures)
    // - Other errors: Assume retryable (conservative default)
    let retryable = true;
    if (error instanceof ValidationError) {
      retryable = false;
    } else if (error instanceof NetworkError) {
      retryable = true;
    } else if (error instanceof ParsingError) {
      retryable = true; // Might be transient server error
    }

    return {
      ...result,
      _meta: {
        ...result._meta,
        retryable,
      },
    };
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
  // Uses discriminated union to determine if comments were included
  const formatCommentInfo = (issue: IssueData) => {
    if (issue.comments_included) {
      return `(${issue.comments.length} comments)`;
    }
    return '(body only)';
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

  // Use discriminated union on current issue to check if comments were included
  if (!context.current.comments_included) {
    lines.push('');
    lines.push('Note: Comments not included (body-only mode)');
  }

  return lines.join('\n');
}
