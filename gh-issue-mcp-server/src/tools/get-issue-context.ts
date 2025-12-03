/**
 * Tool: gh_get_issue_context
 * Get comprehensive hierarchical context for a GitHub issue
 */

import { z } from "zod";
import type { ToolResult } from "../types.js";
import { ghCliJson, resolveRepo } from "../utils/gh-cli.js";
import { createErrorResult } from "../utils/errors.js";

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
  id: string;          // Node ID for GraphQL
  number: number;
  title: string;
  url: string;
  body: string;
}

interface IssueContext {
  root: IssueData | null;
  ancestors: IssueData[];     // [root, ..., parent] (excluding current)
  current: IssueData;
  children: IssueData[];
  siblings: IssueData[];
}

export async function getIssueContext(
  input: GetIssueContextInput
): Promise<ToolResult> {
  try {
    const resolvedRepo = await resolveRepo(input.repo);

    // Step 1: Fetch current issue details
    const issue = await ghCliJson<IssueData>([
      "issue", "view", input.issue_number,
      "--json", "id,number,title,body,url"
    ], { repo: resolvedRepo });

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
            }
          }
        }
      }
    `;

    const parentResult = await ghCliJson<any>([
      "api", "graphql",
      "-H", "GraphQL-Features: sub_issues",
      "-f", `query=${parentQuery}`,
      "-f", `issueId=${issue.id}`
    ], {});

    const parent = parentResult.data?.node?.parent || null;

    // Step 3: Recursively traverse ancestors to root
    const ancestors: IssueData[] = [];
    let currentAncestor = parent;

    while (currentAncestor) {
      ancestors.unshift(currentAncestor); // Add to front

      // Get parent of current ancestor
      const ancestorParentResult = await ghCliJson<any>([
        "api", "graphql",
        "-H", "GraphQL-Features: sub_issues",
        "-f", `query=${parentQuery}`,
        "-f", `issueId=${currentAncestor.id}`
      ], {});

      currentAncestor = ancestorParentResult.data?.node?.parent || null;
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
              }
            }
          }
        }
      }
    `;

    const childrenResult = await ghCliJson<any>([
      "api", "graphql",
      "-H", "GraphQL-Features: sub_issues",
      "-f", `query=${childrenQuery}`,
      "-f", `issueId=${issue.id}`
    ], {});

    const children = childrenResult.data?.node?.subIssues?.nodes || [];

    // Step 5: Fetch siblings (if parent exists)
    let siblings: IssueData[] = [];

    if (parent) {
      const siblingsResult = await ghCliJson<any>([
        "api", "graphql",
        "-H", "GraphQL-Features: sub_issues",
        "-f", `query=${childrenQuery}`,
        "-f", `issueId=${parent.id}`
      ], {});

      const allSiblings = siblingsResult.data?.node?.subIssues?.nodes || [];
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
          type: "text",
          text: summary + "\n\n" + JSON.stringify(context, null, 2)
        }
      ],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}

function formatIssueContextSummary(context: IssueContext): string {
  const lines: string[] = [];

  lines.push(`Issue Context for #${context.current.number}: ${context.current.title}`);
  lines.push(`URL: ${context.current.url}`);
  lines.push("");

  if (context.root) {
    lines.push(`Root Issue: #${context.root.number} - ${context.root.title}`);
  }

  if (context.ancestors.length > 0) {
    lines.push(`Ancestor Chain: ${context.ancestors.map(a => `#${a.number}`).join(" → ")}`);
  }

  if (context.children.length > 0) {
    lines.push(`Children (${context.children.length}): ${context.children.map(c => `#${c.number}`).join(", ")}`);
  }

  if (context.siblings.length > 0) {
    lines.push(`Siblings (${context.siblings.length}): ${context.siblings.map(s => `#${s.number}`).join(", ")}`);
  }

  return lines.join("\n");
}
