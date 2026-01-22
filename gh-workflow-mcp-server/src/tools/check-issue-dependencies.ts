/**
 * Tool: gh_check_issue_dependencies
 * Check if an issue has open blocking dependencies
 */

import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { ghCli, resolveRepo } from '../utils/gh-cli.js';
import { ValidationError, createErrorResult } from '../utils/errors.js';

export const CheckIssueDependenciesInputSchema = z
  .object({
    issue_number: z.number().int().positive(),
    repo: z.string().optional(),
  })
  .strict();

export type CheckIssueDependenciesInput = z.infer<typeof CheckIssueDependenciesInputSchema>;

interface BlockingIssue {
  id: number;
  number: number;
  state: 'open' | 'closed';
  title: string;
  url: string;
}

/**
 * Check if an issue has open blocking dependencies
 *
 * Uses GitHub API to fetch issues that block the specified issue.
 * An issue is considered "blocked" if it has one or more dependencies
 * that are still open.
 *
 * API Endpoint: GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by
 *
 * @param input - Dependency check configuration
 * @param input.issue_number - Issue number to check for blocking dependencies
 * @param input.repo - Repository in format "owner/repo" (defaults to current)
 *
 * @returns Summary of blocking dependencies with actionability status
 *
 * @throws {ValidationError} If GitHub CLI fails or returns invalid data
 *
 * @example
 * // Check if issue #100 has open blockers
 * await checkIssueDependencies({ issue_number: 100 });
 *
 * @example
 * // Check in specific repo
 * await checkIssueDependencies({ issue_number: 100, repo: 'owner/repo' });
 */
export async function checkIssueDependencies(
  input: CheckIssueDependenciesInput
): Promise<ToolResult> {
  try {
    const resolvedRepo = await resolveRepo(input.repo);

    // Verify issue exists first to provide better error messages
    try {
      await ghCli(['issue', 'view', input.issue_number.toString(), '--json', 'number'], {
        repo: resolvedRepo,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('404') || error.message.includes('Not Found'))
      ) {
        throw new ValidationError(
          `Issue #${input.issue_number} does not exist in repository ${resolvedRepo}. ` +
            `Please verify the issue number is correct.`
        );
      }
      throw error;
    }

    // Fetch blocking dependencies via GitHub API
    // Note: This endpoint returns an array of issues that block the specified issue
    let blockingIssuesJson: string;
    try {
      blockingIssuesJson = await ghCli([
        'api',
        `repos/${resolvedRepo}/issues/${input.issue_number}/dependencies/blocked_by`,
        '--jq',
        '.',
      ]);
    } catch (error) {
      // If the dependencies endpoint returns 404, treat as empty array
      // GitHub returns 404 if the dependencies feature is not enabled for this repository
      // (Note: If the issue exists but has no dependencies, GitHub returns [] not 404)
      if (
        error instanceof Error &&
        (error.message.includes('404') || error.message.includes('Not Found'))
      ) {
        blockingIssuesJson = '[]';
      } else {
        throw error;
      }
    }

    // Parse the response
    let blockingIssues: BlockingIssue[];
    try {
      const parsed = JSON.parse(blockingIssuesJson);
      blockingIssues = Array.isArray(parsed) ? parsed : [];
    } catch (parseError) {
      throw new ValidationError(
        `Failed to parse GitHub API response for issue dependencies: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
    }

    // Filter to only open blocking issues
    const openBlockers = blockingIssues.filter((issue) => issue.state === 'open');

    // Format output
    const lines: string[] = [
      `Dependency check for issue #${input.issue_number}`,
      `Repository: ${resolvedRepo}`,
      '',
    ];

    if (blockingIssues.length === 0) {
      lines.push('No blocking dependencies found.');
      lines.push('Status: ACTIONABLE (ready to work on)');
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    }

    lines.push(`Total blocking dependencies: ${blockingIssues.length}`);
    lines.push(`Open blockers: ${openBlockers.length}`);
    lines.push('');

    if (openBlockers.length > 0) {
      lines.push('Open Blocking Issues:');
      openBlockers.forEach((blocker) => {
        lines.push(`  - #${blocker.number}: ${blocker.title}`);
        lines.push(`    ${blocker.url}`);
      });
      lines.push('');
      lines.push('Status: BLOCKED (not ready to work on)');
      lines.push('Recommendation: Resolve open blockers before working on this issue');
    } else {
      lines.push('All blocking issues are closed.');
      lines.push('Status: ACTIONABLE (ready to work on)');
    }

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
