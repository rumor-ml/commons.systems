import { z } from 'zod';
import { ghCli, ghCliJson, resolveRepo } from '../utils/gh-cli.js';
import type { ToolResult } from '../types.js';
import { GitHubCliError, createErrorResult } from '../utils/errors.js';

export const AddBlockerInputSchema = z
  .object({
    blocked_issue_number: z
      .union([z.string(), z.number()])
      .describe('Issue number that is blocked'),
    blocker_issue_number: z
      .union([z.string(), z.number()])
      .describe('Issue number that is blocking'),
    repo: z
      .string()
      .optional()
      .describe('Repository in format "owner/repo" (defaults to current repository)'),
  })
  .strict();

export type AddBlockerInput = z.infer<typeof AddBlockerInputSchema>;

export async function addBlocker(input: AddBlockerInput): Promise<ToolResult> {
  try {
    const resolvedRepo = await resolveRepo(input.repo);
    const blocked_issue_number =
      typeof input.blocked_issue_number === 'string'
        ? parseInt(input.blocked_issue_number, 10)
        : input.blocked_issue_number;
    const blocker_issue_number =
      typeof input.blocker_issue_number === 'string'
        ? parseInt(input.blocker_issue_number, 10)
        : input.blocker_issue_number;

    // Get blocker issue's internal ID (not issue number)
    const blockerIssue = await ghCliJson<{ id: string }>(
      ['issue', 'view', blocker_issue_number.toString(), '--json', 'id'],
      { repo: resolvedRepo }
    );

    // Add blocker relationship via GitHub API
    // Use --field for integer type (not -f which stringifies)
    await ghCli(
      [
        'api',
        `repos/${resolvedRepo}/issues/${blocked_issue_number}/dependencies/blocked_by`,
        '--method',
        'POST',
        '--field',
        `issue_id=${blockerIssue.id}`,
      ],
      {}
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: `Successfully added issue #${blocker_issue_number} as a blocker for issue #${blocked_issue_number}`,
        },
      ],
      _meta: {
        blocked_issue_number,
        blocker_issue_number,
        blocker_issue_id: blockerIssue.id,
      },
    };
  } catch (error) {
    // Handle "relationship already exists" gracefully
    if (error instanceof GitHubCliError && error.message.includes('422')) {
      const blocked_issue_number =
        typeof input.blocked_issue_number === 'string'
          ? parseInt(input.blocked_issue_number, 10)
          : input.blocked_issue_number;
      const blocker_issue_number =
        typeof input.blocker_issue_number === 'string'
          ? parseInt(input.blocker_issue_number, 10)
          : input.blocker_issue_number;

      return {
        content: [
          {
            type: 'text' as const,
            text: `Blocker relationship already exists between #${blocker_issue_number} and #${blocked_issue_number}`,
          },
        ],
        _meta: {
          alreadyExists: true,
          blocked_issue_number,
          blocker_issue_number,
        },
      };
    }
    return createErrorResult(error);
  }
}
