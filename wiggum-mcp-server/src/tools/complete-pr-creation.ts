/**
 * Tool: wiggum_complete_pr_creation
 *
 * Called when Step 0 (Ensure PR) instructs creation of PR
 * Codifies the entire PR creation process following completion tool pattern
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import { postWiggumStateComment } from '../state/comments.js';
import { getNextStepInstructions } from '../state/router.js';
import { logger } from '../utils/logger.js';
import { STEP_ENSURE_PR, STEP_NAMES, NEEDS_REVIEW_LABEL } from '../constants.js';
import { ValidationError } from '../utils/errors.js';
import { getCurrentBranch } from '../utils/git.js';
import { ghCli, getPR } from '../utils/gh-cli.js';
import type { ToolResult } from '../types.js';

export const CompletePRCreationInputSchema = z.object({
  pr_description: z.string().describe("Agent's description of PR contents and changes"),
});

export type CompletePRCreationInput = z.infer<typeof CompletePRCreationInputSchema>;

/**
 * Extract issue number from branch name
 * Expected format: "123-feature-name" -> "123"
 */
function extractIssueNumber(branchName: string): string {
  const parts = branchName.split('-');
  if (parts.length === 0) {
    throw new ValidationError(
      `Cannot extract issue number from branch name: "${branchName}". Expected format: "123-feature-name"`
    );
  }

  const issueNum = parts[0];
  if (!/^\d+$/.test(issueNum)) {
    throw new ValidationError(
      `First segment of branch name must be numeric issue number. Got: "${issueNum}" from branch: "${branchName}"`
    );
  }

  return issueNum;
}

/**
 * Create PR and complete Step 0
 */
export async function completePRCreation(input: CompletePRCreationInput): Promise<ToolResult> {
  const state = await detectCurrentState();

  logger.info('wiggum_complete_pr_creation', {
    branch: state.git.currentBranch,
    iteration: state.wiggum.iteration,
  });

  // Validate PR doesn't already exist (or is closed/merged)
  if (state.pr.exists && state.pr.state === 'OPEN') {
    throw new ValidationError(
      `An open PR #${state.pr.number} already exists for this branch: "${state.pr.title}". ` +
        `Cannot create a duplicate PR while an open PR exists. ` +
        `If you just created this PR manually with gh pr create, you should NOT call this tool. ` +
        `This tool handles PR creation automatically. The PR already exists, so workflow can continue. ` +
        `Call wiggum_init to get next step instructions instead.`
    );
  }

  // If a closed/merged PR exists, we can create a new one
  // Log this for transparency
  if (state.pr.exists && state.pr.state !== 'OPEN') {
    console.log(
      `Note: A ${state.pr.state.toLowerCase()} PR #${state.pr.number} exists for this branch. Creating a new PR.`
    );
  }

  // Get current branch
  const branchName = await getCurrentBranch();

  // Extract and validate issue number from branch name
  const issueNum = extractIssueNumber(branchName);

  // Get commit messages for PR body
  let commits: string;
  try {
    commits = await ghCli([
      'api',
      'repos/{owner}/{repo}/compare/main...HEAD',
      '--jq',
      '.commits | map("- " + .commit.message) | join("\\n")',
    ]);
    commits = commits.trim();
  } catch (error) {
    // Fallback to empty if we can't get commits
    console.warn(
      `completePRCreation: failed to get commits from GitHub API: ${error instanceof Error ? error.message : String(error)}`
    );
    commits = '';
  }

  // Build PR body
  const prBody = `closes #${issueNum}

${input.pr_description}

## Commits

${commits}`;

  // Create PR using gh CLI
  try {
    const createOutput = await ghCli([
      'pr',
      'create',
      '--base',
      'main',
      '--label',
      NEEDS_REVIEW_LABEL,
      '--title',
      branchName,
      '--body',
      prBody,
    ]);

    // Parse PR URL from output (gh pr create outputs the PR URL)
    const prUrl = createOutput.trim();

    // Extract PR number from URL (format: https://github.com/owner/repo/pull/123)
    const urlMatch = prUrl.match(/\/pull\/(\d+)$/);
    if (!urlMatch) {
      throw new ValidationError(`Failed to parse PR number from gh pr create output: "${prUrl}"`);
    }
    const prNumber = parseInt(urlMatch[1], 10);

    // Verify PR was created by fetching it
    const pr = await getPR(prNumber);

    // Mark Step 0 complete
    const newState = {
      iteration: state.wiggum.iteration,
      step: STEP_ENSURE_PR,
      completedSteps: [...state.wiggum.completedSteps, STEP_ENSURE_PR],
    };

    await postWiggumStateComment(
      prNumber,
      newState,
      `${STEP_NAMES[STEP_ENSURE_PR]} - Complete`,
      `PR created successfully!

**PR:** #${prNumber}
**Title:** ${pr.title}
**Base:** ${pr.baseRefName}
**Closes:** #${issueNum}

**Next Action:** Proceeding to workflow monitoring.`
    );

    // Get updated state with PR now existing
    const updatedState = await detectCurrentState();

    // Get next step instructions from router
    const nextStepResult = await getNextStepInstructions(updatedState);

    return nextStepResult;
  } catch (error) {
    // Check if error indicates PR already exists
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('already exists')) {
      throw new ValidationError(
        `PR already exists for branch "${branchName}". Cannot create duplicate PR.`
      );
    }
    // Re-throw other errors
    throw error;
  }
}
