import { z } from 'zod';
import { ghCli, resolveRepo } from '../utils/gh-cli.js';
import type { ToolResult } from '../types.js';
import { GitHubCliError, createErrorResult } from '../utils/errors.js';

export const CheckTodoInMainInputSchema = z
  .object({
    file_path: z.string().describe('File path to check in the repository'),
    todo_pattern: z.string().describe("TODO pattern to search for (e.g., 'TODO(#123)')"),
    repo: z
      .string()
      .optional()
      .describe('Repository in format "owner/repo" (defaults to current repository)'),
  })
  .strict();

export type CheckTodoInMainInput = z.infer<typeof CheckTodoInMainInputSchema>;

export async function checkTodoInMain(input: CheckTodoInMainInput): Promise<ToolResult> {
  try {
    const resolvedRepo = await resolveRepo(input.repo);

    // Use GitHub API to read file from origin/main (no checkout needed)
    const fileContent = await ghCli(
      ['api', `repos/${resolvedRepo}/contents/${input.file_path}`, '--jq', '.content'],
      {}
    );

    // GitHub API returns base64-encoded content
    const decoded = Buffer.from(fileContent.trim(), 'base64').toString('utf-8');

    // Search for pattern
    const found = decoded.includes(input.todo_pattern);

    return {
      content: [
        {
          type: 'text' as const,
          text: found
            ? `Pattern "${input.todo_pattern}" found in ${input.file_path} on main branch`
            : `Pattern "${input.todo_pattern}" not found in ${input.file_path} on main branch`,
        },
      ],
      _meta: {
        found,
        file_path: input.file_path,
        pattern: input.todo_pattern,
      },
    };
  } catch (error) {
    // Handle file not found gracefully
    if (error instanceof GitHubCliError && error.message.includes('404')) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `File ${input.file_path} not found on main branch`,
          },
        ],
        _meta: {
          found: false,
          fileNotFound: true,
          file_path: input.file_path,
          pattern: input.todo_pattern,
        },
      };
    }
    return createErrorResult(error);
  }
}
