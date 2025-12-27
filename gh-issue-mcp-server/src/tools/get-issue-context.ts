/**
 * Tool: gh_get_issue_context
 * Get comprehensive hierarchical context for a GitHub issue
 */

import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { ghCliJson, resolveRepo } from '../utils/gh-cli.js';
import { createErrorResult, ParsingError } from '../utils/errors.js';

// Input schema
export const GetIssueContextInputSchema = z
  .object({
    issue_number: z.union([z.string(), z.number()]).transform(String),
    repo: z.string().optional(),
  })
  .strict();

export type GetIssueContextInput = z.infer<typeof GetIssueContextInputSchema>;

// Output types
interface IssueData {
  id: string; // Node ID for GraphQL
  number: number;
  title: string;
  url: string;
  body: string;
  comments: Array<{
    author: { login: string };
    body: string;
    createdAt: string;
  }>;
}

interface IssueContext {
  root: IssueData | null;
  ancestors: IssueData[]; // [root, ..., parent] (excluding current)
  current: IssueData;
  children: IssueData[];
  siblings: IssueData[];
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

    // Step 1: Fetch current issue details
    const issue = await ghCliJson<IssueData>(
      ['issue', 'view', input.issue_number, '--json', 'id,number,title,body,url,comments'],
      { repo: resolvedRepo }
    );

    // Step 2: Check for parent
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
              comments(first: 100) {
                nodes {
                  author {
                    login
                  }
                  body
                  createdAt
                }
              }
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
    if (!parentResult.data) {
      // Log response preview for debugging (truncated to 1000 chars)
      const responseJson = JSON.stringify(parentResult);
      const responsePreview =
        responseJson.length > 1000 ? responseJson.substring(0, 1000) + '...' : responseJson;
      console.error(
        `[gh-issue] GraphQL validation failed (query: parent, issue: #${input.issue_number}, responseSize: ${responseJson.length}, preview: ${responsePreview})`
      );

      // Include GitHub error details if available for better debugging
      const githubErrors = (parentResult as { errors?: Array<{ message: string }> }).errors;
      const errorContext = githubErrors?.[0]?.message
        ? ` GitHub error: ${githubErrors[0].message}`
        : '';

      throw new ParsingError(
        `GraphQL response missing 'data' field when fetching parent for issue #${input.issue_number}.${errorContext} ` +
          `Response keys: [${Object.keys(parentResult).join(', ')}]`
      );
    }

    const parentRaw = parentResult.data?.node?.parent || null;
    const parent = parentRaw
      ? {
          ...parentRaw,
          comments: parentRaw.comments?.nodes || [],
        }
      : null;

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

      if (!ancestorParentResult.data) {
        // Log response preview for debugging (truncated to 1000 chars)
        const responseJson = JSON.stringify(ancestorParentResult);
        const responsePreview =
          responseJson.length > 1000 ? responseJson.substring(0, 1000) + '...' : responseJson;
        console.error(
          `[gh-issue] GraphQL validation failed (query: ancestor-parent, ancestorIssue: #${currentAncestor.number}, responseSize: ${responseJson.length}, preview: ${responsePreview})`
        );

        // Include GitHub error details if available for better debugging
        const githubErrors = (ancestorParentResult as { errors?: Array<{ message: string }> })
          .errors;
        const errorContext = githubErrors?.[0]?.message
          ? ` GitHub error: ${githubErrors[0].message}`
          : '';

        throw new ParsingError(
          `GraphQL response missing 'data' field when fetching ancestor parent for issue #${currentAncestor.number}.${errorContext} ` +
            `Response keys: [${Object.keys(ancestorParentResult).join(', ')}]`
        );
      }

      const ancestorParentRaw = ancestorParentResult.data?.node?.parent || null;
      currentAncestor = ancestorParentRaw
        ? {
            ...ancestorParentRaw,
            comments: ancestorParentRaw.comments?.nodes || [],
          }
        : null;
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
                comments(first: 100) {
                  nodes {
                    author {
                      login
                    }
                    body
                    createdAt
                  }
                }
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

    if (!childrenResult.data) {
      // Log response preview for debugging (truncated to 1000 chars)
      const responseJson = JSON.stringify(childrenResult);
      const responsePreview =
        responseJson.length > 1000 ? responseJson.substring(0, 1000) + '...' : responseJson;
      console.error(
        `[gh-issue] GraphQL validation failed (query: children, issue: #${input.issue_number}, responseSize: ${responseJson.length}, preview: ${responsePreview})`
      );

      // Include GitHub error details if available for better debugging
      const githubErrors = (childrenResult as { errors?: Array<{ message: string }> }).errors;
      const errorContext = githubErrors?.[0]?.message
        ? ` GitHub error: ${githubErrors[0].message}`
        : '';

      throw new ParsingError(
        `GraphQL response missing 'data' field when fetching children for issue #${input.issue_number}.${errorContext} ` +
          `Response keys: [${Object.keys(childrenResult).join(', ')}]`
      );
    }

    const childrenRaw = childrenResult.data?.node?.subIssues?.nodes || [];
    const children = childrenRaw.map((child: any) => ({
      ...child,
      comments: child.comments?.nodes || [],
    }));

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

      if (!siblingsResult.data) {
        // Log response preview for debugging (truncated to 1000 chars)
        const responseJson = JSON.stringify(siblingsResult);
        const responsePreview =
          responseJson.length > 1000 ? responseJson.substring(0, 1000) + '...' : responseJson;
        console.error(
          `[gh-issue] GraphQL validation failed (query: siblings, issue: #${input.issue_number}, responseSize: ${responseJson.length}, preview: ${responsePreview})`
        );

        // Include GitHub error details if available for better debugging
        const githubErrors = (siblingsResult as { errors?: Array<{ message: string }> }).errors;
        const errorContext = githubErrors?.[0]?.message
          ? ` GitHub error: ${githubErrors[0].message}`
          : '';

        throw new ParsingError(
          `GraphQL response missing 'data' field when fetching siblings for issue #${input.issue_number}.${errorContext} ` +
            `Response keys: [${Object.keys(siblingsResult).join(', ')}]`
        );
      }

      const allSiblingsRaw = siblingsResult.data?.node?.subIssues?.nodes || [];
      const allSiblings = allSiblingsRaw.map((sibling: any) => ({
        ...sibling,
        comments: sibling.comments?.nodes || [],
      }));
      siblings = allSiblings.filter((s: IssueData) => s.number !== issue.number);
    }

    // Build context object
    const context: IssueContext = {
      root: ancestors.length > 0 ? ancestors[0] : null,
      ancestors: ancestors.slice(0, -1), // Exclude parent (last item)
      current: issue,
      children,
      siblings,
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

  lines.push(
    `Issue Context for #${context.current.number}: ${context.current.title} (${context.current.comments.length} comments)`
  );
  lines.push(`URL: ${context.current.url}`);
  lines.push('');

  if (context.root) {
    lines.push(
      `Root Issue: #${context.root.number} - ${context.root.title} (${context.root.comments.length} comments)`
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

  return lines.join('\n');
}
