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
      const trimmedContent = fileContent.trim();

      // Validate content is a string and not null/undefined
      if (typeof fileContent !== 'string' || !fileContent) {
        throw new ParsingError(
          `GitHub API returned invalid content type. Expected base64 string.\n` +
            `File: ${input.file_path}\n` +
            `Content type: ${typeof fileContent}\n` +
            `Content: ${String(fileContent).substring(0, 100)}`
        );
      }

      // Validate content looks like base64 (contains only valid base64 characters)
      const base64Regex = /^[A-Za-z0-9+/=\n\r\s]+$/;
      if (!base64Regex.test(trimmedContent)) {
        throw new ParsingError(
          `GitHub API response is not valid base64. The file may be binary or the API response may be malformed.\n` +
            `File: ${input.file_path}\n` +
            `Response preview: ${trimmedContent.substring(0, 200)}...`
        );
      }

      decoded = Buffer.from(trimmedContent, 'base64').toString('utf-8');

      // Validate decoded content is valid UTF-8 (no replacement characters)
      if (decoded.includes('\ufffd')) {
        throw new ParsingError(
          `Decoded content contains invalid UTF-8 sequences. File may be binary: ${input.file_path}\n` +
            `This usually indicates the file is not a text file or the API response is corrupted.`
        );
      }
    } catch (decodeError) {
      // If it's already a ParsingError, re-throw it
      if (decodeError instanceof ParsingError) {
        throw decodeError;
      }

      // Otherwise, wrap in ParsingError
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
        // Log the verification failure for debugging
        console.error('[gh_check_todo_in_main] Repository verification failed:', {
          repo: resolvedRepo,
          file_path: input.file_path,
          verifyError: repoError instanceof Error ? repoError.message : String(repoError),
          originalError: error.message,
        });

        // Only treat as repo not found if verification also got 404
        if (repoError instanceof GitHubCliError && repoError.message.includes('404')) {
          throw new GitHubCliError(
            `Repository not found or access denied: ${resolvedRepo}. Check repository name and permissions.`,
            error.exitCode,
            error.stderr,
            undefined,
            error
          );
        }

        // Otherwise, re-throw original error - it might be rate limiting or network issue
        throw error;
      }
    }
    return createErrorResult(error);
  }
}
