import { z } from 'zod';
import { ghCli, ghCliJson, resolveRepo } from '../utils/gh-cli.js';
import type { ToolResult } from '../types.js';
import { createErrorResult, ValidationError } from '../utils/errors.js';

export const RemoveLabelIfExistsInputSchema = z
  .object({
    issue_number: z
      .union([z.string(), z.number()])
      .refine(
        (val) => {
          const parsed = typeof val === 'string' ? parseInt(val, 10) : val;
          return Number.isInteger(parsed) && parsed > 0;
        },
        { message: 'must be a positive integer' }
      )
      .describe('Issue or PR number'),
    label: z.string().describe('Label name to remove'),
    repo: z
      .string()
      .optional()
      .describe('Repository in format "owner/repo" (defaults to current repository)'),
  })
  .strict();

export type RemoveLabelIfExistsInput = z.infer<typeof RemoveLabelIfExistsInputSchema>;

export async function removeLabelIfExists(input: RemoveLabelIfExistsInput): Promise<ToolResult> {
  try {
    const resolvedRepo = await resolveRepo(input.repo);
    const issue_number =
      typeof input.issue_number === 'string'
        ? parseInt(input.issue_number, 10)
        : input.issue_number;

    // Validate parsed number
    if (!Number.isInteger(issue_number) || issue_number <= 0) {
      throw new ValidationError(
        `Invalid issue_number: must be a positive integer, got ${input.issue_number}`
      );
    }

    // Get current labels on issue
    const labels = await ghCliJson<{ name: string }[]>(
      ['issue', 'view', issue_number.toString(), '--json', 'labels', '--jq', '.labels'],
      { repo: resolvedRepo }
    );

    // Check if target label exists
    const hasLabel = labels.some((l) => l.name === input.label);

    // Only remove if present
    if (hasLabel) {
      await ghCli(['issue', 'edit', issue_number.toString(), '--remove-label', input.label], {
        repo: resolvedRepo,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Successfully removed label "${input.label}" from issue #${issue_number}`,
          },
        ],
        _meta: {
          labelRemoved: true,
          issue_number,
          label: input.label,
        },
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Label "${input.label}" not found on issue #${issue_number} (no action taken)`,
        },
      ],
      _meta: {
        labelRemoved: false,
        issue_number,
        label: input.label,
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
