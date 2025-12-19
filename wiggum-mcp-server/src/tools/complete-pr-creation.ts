/**
 * Tool: wiggum_complete_pr_creation
 *
 * Called when Step 0 (Ensure PR) instructs creation of PR
 * Codifies the entire PR creation process following completion tool pattern
 *
 * ERROR HANDLING STRATEGY:
 *
 * This handler implements defensive error handling with explicit ValidationError throws
 * for all user-facing error conditions. Error handling is split into three categories:
 *
 * 1. VALIDATION ERRORS (throw ValidationError - user must intervene):
 *    - PR already exists for branch (handleStepEnsurePR validation)
 *    - Invalid branch name format (extractIssueNumber function)
 *    - Failed to parse PR number from gh output (after gh pr create)
 *    - Failed to verify PR after creation (getPR verification)
 *    - Failed to post wiggum state comment (postWiggumStateComment call)
 *    - GitHub API errors during PR creation (gh pr create errors)
 *
 * 2. LOGGED ERRORS (logged but execution continues with fallback):
 *    - Failed to fetch commits from GitHub API (commits fetch try/catch)
 *      Fallback: Include error message in PR body with manual workaround
 *
 * 3. STRUCTURED LOGGING (info/error logging for observability):
 *    - PR creation start (wiggum_complete_pr_creation entry)
 *    - Closed/merged PR exists (state validation)
 *    - Commit fetch failure (commits fetch catch block)
 *    - PR creation success (after gh pr create)
 *    - PR verification success (after getPR call)
 *    - State comment failure (postWiggumStateComment catch)
 *    - PR creation failure (outer catch block)
 *
 * All ValidationErrors include actionable context for the user.
 * All errors are logged with structured metadata (prNumber, branch, error message).
 */

import { z } from 'zod';
import { detectCurrentState } from '../state/detector.js';
import { postWiggumStateComment } from '../state/comments.js';
import { getNextStepInstructions } from '../state/router.js';
import { logger } from '../utils/logger.js';
import { STEP_PHASE1_CREATE_PR, STEP_NAMES, NEEDS_REVIEW_LABEL } from '../constants.js';
import { ValidationError } from '../utils/errors.js';
import { getCurrentBranch } from '../utils/git.js';
import { ghCli, getPR } from '../utils/gh-cli.js';
import { sanitizeErrorMessage } from '../utils/security.js';
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
    logger.info(
      `A ${state.pr.state.toLowerCase()} PR #${state.pr.number} exists for branch "${state.git.currentBranch}". Creating a new PR as the previous one is not open.`,
      {
        previousPrNumber: state.pr.number,
        previousPrState: state.pr.state,
        branch: state.git.currentBranch,
      }
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
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Failed to fetch commits from GitHub API for PR body', {
      error: errorMsg,
      branch: branchName,
    });

    // Sanitize error message for PR body using security utility
    // Full error is already logged above for debugging
    const sanitizedError = sanitizeErrorMessage(errorMsg, 200);

    commits = `⚠️ **Unable to fetch commits from GitHub API**

Error: ${sanitizedError}

**Manual workaround:** Run \`git log main..HEAD --oneline\` to see commits.`;
  }

  // Build PR body
  const prBody = `closes #${issueNum}

${input.pr_description}

## Commits

${commits}`;

  // Create PR using gh CLI
  let prNumber: number;
  let createOutput: string;

  try {
    createOutput = await ghCli([
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

    logger.info('PR creation command executed successfully', {
      outputLength: createOutput.length,
      branch: branchName,
    });

    // Parse PR URL from output (gh pr create outputs the PR URL)
    const prUrl = createOutput.trim();

    // Extract PR number from URL (format: https://github.com/owner/repo/pull/123)
    const urlMatch = prUrl.match(/\/pull\/(\d+)$/);
    if (!urlMatch) {
      logger.error('Failed to parse PR number from gh pr create output', {
        output: prUrl,
        branch: branchName,
      });
      throw new ValidationError(
        `Failed to parse PR number from gh pr create output. ` +
          `Expected URL format: "https://github.com/owner/repo/pull/123". ` +
          `Got: "${prUrl}"`
      );
    }
    prNumber = parseInt(urlMatch[1], 10);

    // Verify PR was created by fetching it
    let pr;
    try {
      pr = await getPR(prNumber);
      logger.info('PR verified successfully', {
        prNumber,
        title: pr.title,
        state: pr.state,
      });
    } catch (verifyError) {
      logger.error('Failed to verify PR after creation', {
        prNumber,
        error: verifyError instanceof Error ? verifyError.message : String(verifyError),
      });
      throw new ValidationError(
        `PR #${prNumber} was created but could not be verified. ` +
          `This may indicate a timing issue with GitHub API. ` +
          `Error: ${verifyError instanceof Error ? verifyError.message : String(verifyError)}`
      );
    }

    // Mark Phase 1 Step 4 complete and transition to Phase 2
    const newState = {
      iteration: state.wiggum.iteration,
      step: STEP_PHASE1_CREATE_PR,
      completedSteps: [...state.wiggum.completedSteps, STEP_PHASE1_CREATE_PR],
      phase: 'phase2' as const,
    };

    try {
      await postWiggumStateComment(
        prNumber,
        newState,
        `${STEP_NAMES[STEP_PHASE1_CREATE_PR]} - Complete`,
        `PR created successfully! Phase 1 complete. Transitioning to Phase 2 (PR workflow).

**PR:** #${prNumber}
**Title:** ${pr.title}
**Base:** ${pr.baseRefName}
**Closes:** #${issueNum}

**Next Action:** Beginning Phase 2 workflow monitoring.`
      );
    } catch (commentError) {
      // Classify GitHub API errors for better diagnostics
      const errorMsg = commentError instanceof Error ? commentError.message : String(commentError);
      const isPermissionError = /permission|forbidden|401|403/i.test(errorMsg);
      const isRateLimitError = /rate limit|429/i.test(errorMsg);
      const isNetworkError = /ECONNREFUSED|ETIMEDOUT|network|fetch/i.test(errorMsg);

      let errorClassification = 'Unknown error';
      if (isPermissionError) {
        errorClassification = 'Permission denied (check gh auth token scopes)';
      } else if (isRateLimitError) {
        errorClassification = 'GitHub API rate limit exceeded';
      } else if (isNetworkError) {
        errorClassification = 'Network connectivity issue';
      }

      logger.error('Failed to post wiggum state comment after PR creation', {
        prNumber,
        error: errorMsg,
        errorClassification,
        isPermissionError,
        isRateLimitError,
        isNetworkError,
      });
      throw new ValidationError(
        `PR #${prNumber} was created successfully but failed to post state comment. ` +
          `Error: ${errorClassification} - ${errorMsg}. ` +
          `The PR exists and can be viewed, but wiggum state tracking failed. ` +
          `You may need to manually add a wiggum state comment or restart the workflow.`
      );
    }

    // Get updated state with PR now existing
    const updatedState = await detectCurrentState();

    // Get next step instructions from router
    const nextStepResult = await getNextStepInstructions(updatedState);

    return nextStepResult;
  } catch (error) {
    // Check if error indicates PR already exists
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('PR creation failed', {
      error: errorMsg,
      branch: branchName,
      issueNum,
    });

    if (errorMsg.includes('already exists')) {
      throw new ValidationError(
        `PR already exists for branch "${branchName}". Cannot create duplicate PR. ` +
          `If you just created this PR manually, call wiggum_init instead to continue.`
      );
    }
    // Re-throw other errors (including ValidationError from parsing/verification)
    throw error;
  }
}
