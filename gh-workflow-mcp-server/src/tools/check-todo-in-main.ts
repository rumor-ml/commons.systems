import { z } from 'zod';
import { ghCli, resolveRepo } from '../utils/gh-cli.js';
import type { ToolResult } from '../types.js';
import { GitHubCliError, ParsingError, createErrorResult } from '../utils/errors.js';

export const CheckTodoInMainInputSchema = z
  .object({
    file_path: z
      .string()
      .min(1, 'file_path cannot be empty')
      .describe('File path to check in the repository'),
    todo_pattern: z
      .string()
      .min(1, 'todo_pattern cannot be empty')
      .describe("TODO pattern to search for (e.g., 'TODO(#123)')"),
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

    // Use GitHub API to read file from main branch (no checkout needed)
    const fileContent = await ghCli(
      ['api', `repos/${resolvedRepo}/contents/${input.file_path}?ref=main`, '--jq', '.content'],
      {}
    );

    // GitHub API returns base64-encoded content - decode with error handling
    let decoded: string;
    try {
      decoded = Buffer.from(fileContent.trim(), 'base64').toString('utf-8');
    } catch (decodeError) {
      throw new ParsingError(
        `Failed to decode file content from GitHub API. The file may be binary or the API response may be malformed.\n` +
          `File: ${input.file_path}\n` +
          `Error: ${decodeError instanceof Error ? decodeError.message : String(decodeError)}`,
        decodeError instanceof Error ? decodeError : undefined
      );
    }

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
    // Handle file not found gracefully, but distinguish from repository errors
    if (error instanceof GitHubCliError && error.message.includes('404')) {
      // Use sequential verification to correctly classify the error
      const resolvedRepo = await resolveRepo(input.repo);

      // First, verify the repository exists
      try {
        await ghCli(['api', `repos/${resolvedRepo}`], {});

        // Repository exists, so this must be a file-not-found error
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
      } catch (repoError) {
        // Repository verification failed - this is a repository error
        throw new GitHubCliError(
          `Repository not found or access denied: ${resolvedRepo}. Check repository name and permissions.`,
          error.exitCode,
          error.stderr,
          undefined,
          error
        );
      }
    }
    return createErrorResult(error);
  }
}
