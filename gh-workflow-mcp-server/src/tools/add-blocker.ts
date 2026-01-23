import { z } from 'zod';
import { ghCli, ghCliJson, resolveRepo } from '../utils/gh-cli.js';
import type { ToolResult } from '../types.js';
import { GitHubCliError, ValidationError, createErrorResult } from '../utils/errors.js';

/**
 * Parse and validate issue number from string or number input
 * @throws ValidationError if the value is not a positive integer
 */
function parseIssueNumber(value: string | number, paramName: string): number {
  const parsed = typeof value === 'string' ? parseInt(value, 10) : value;

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`Invalid ${paramName}: must be a positive integer, got ${value}`);
  }

  return parsed;
}

export const AddBlockerInputSchema = z
  .object({
    blocked_issue_number: z
      .union([z.string(), z.number()])
      .refine(
        (val) => {
          const parsed = typeof val === 'string' ? parseInt(val, 10) : val;
          return Number.isInteger(parsed) && parsed > 0;
        },
        { message: 'must be a positive integer' }
      )
      .describe('Issue number that is blocked'),
    blocker_issue_number: z
      .union([z.string(), z.number()])
      .refine(
        (val) => {
          const parsed = typeof val === 'string' ? parseInt(val, 10) : val;
          return Number.isInteger(parsed) && parsed > 0;
        },
        { message: 'must be a positive integer' }
      )
      .describe('Issue number that is blocking'),
    repo: z
      .string()
      .optional()
      .describe('Repository in format "owner/repo" (defaults to current repository)'),
  })
  .strict();

export type AddBlockerInput = z.infer<typeof AddBlockerInputSchema>;

export async function addBlocker(input: AddBlockerInput): Promise<ToolResult> {
  // Parse and validate issue numbers early
  const blocked_issue_number = parseIssueNumber(input.blocked_issue_number, 'blocked_issue_number');
  const blocker_issue_number = parseIssueNumber(input.blocker_issue_number, 'blocker_issue_number');

  const resolvedRepo = await resolveRepo(input.repo);

  // Get blocker issue's internal ID (not issue number)
  const blockerIssue = await ghCliJson<{ id: string }>(
    ['issue', 'view', blocker_issue_number.toString(), '--json', 'id'],
    { repo: resolvedRepo }
  );

  try {
    // Add blocker relationship via GitHub API
    // Use --field to pass issue_id as a JSON integer
    // The -f flag would stringify it, causing a 422 error from this endpoint
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
      // Verify the relationship actually exists by querying dependencies
      try {
        const dependencies = await ghCliJson<Array<{ id: string }>>(
          ['api', `repos/${resolvedRepo}/issues/${blocked_issue_number}/dependencies/blocked_by`],
          {}
        );

        const relationshipExists = dependencies.some((dep) => dep.id === blockerIssue.id);

        if (relationshipExists) {
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
      } catch (verifyError) {
        // If verification fails, fall through to re-throw original error
      }

      // Not a duplicate - this is a different validation error, re-throw to expose it
      throw error;
    }
    return createErrorResult(error);
  }
}
