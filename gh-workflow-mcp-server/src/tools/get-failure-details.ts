/**
 * Tool: gh_get_failure_details
 * Get token-efficient summary of workflow failures
 */

import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { MAX_RESPONSE_LENGTH, FAILURE_CONCLUSIONS } from '../constants.js';
import {
  getWorkflowRun,
  getWorkflowRunsForBranch,
  getWorkflowRunsForPR,
  getWorkflowJobs,
  getJobLogs,
  resolveRepo,
  getFailedStepLogs,
  parseFailedStepLogs,
} from '../utils/gh-cli.js';
import { ValidationError, GitHubCliError, createErrorResult } from '../utils/errors.js';
import { extractErrors, formatExtractionResult } from '../extractors/index.js';

export const GetFailureDetailsInputSchema = z
  .object({
    run_id: z.number().int().positive().optional(),
    pr_number: z.number().int().positive().optional(),
    branch: z.string().optional(),
    repo: z.string().optional(),
    max_chars: z.number().int().positive().default(MAX_RESPONSE_LENGTH),
  })
  .strict();

export type GetFailureDetailsInput = z.infer<typeof GetFailureDetailsInputSchema>;

interface WorkflowRunData {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
}

interface JobData {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  steps?: StepData[];
}

interface StepData {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
}

interface FailedStepSummary {
  name: string;
  conclusion: string | null;
  error_lines: string[];
  test_summary?: string | null;
}

interface FailedJobSummary {
  name: string;
  url: string;
  conclusion: string | null;
  failed_steps: FailedStepSummary[];
}

/**
 * Format error message with context for logging
 *
 * Provides consistent error formatting with optional exit code information
 *
 * @param error - Error to format
 * @param context - Optional context string to include in message
 * @returns Formatted error message string
 */
function formatErrorMessage(error: unknown, context?: string): string {
  const contextPrefix = context ? `${context}: ` : '';

  if (error instanceof GitHubCliError) {
    const exitCodeInfo = error.exitCode ? ` (exit code: ${error.exitCode})` : '';
    const stderrInfo = error.stderr ? ` - ${error.stderr}` : '';
    return `${contextPrefix}GitHub CLI error: ${error.message}${stderrInfo}${exitCodeInfo}`;
  }

  if (error instanceof Error) {
    return `${contextPrefix}${error.message}`;
  }

  return `${contextPrefix}Unknown error: ${String(error)}`;
}

/**
 * Extract test summary from logs (e.g., "1 failed, 77 passed")
 * Playwright outputs these on separate lines, so we need to find and combine them
 */
function extractTestSummary(logText: string): string | null {
  const lines = logText.split('\n');

  // Patterns for individual summary lines
  const failedPattern = /(\d+)\s+failed/i;
  const passedPattern = /(\d+)\s+passed/i;

  let failed: string | null = null;
  let passed: string | null = null;

  // Search from end for the most recent summary lines
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];

    // Check for combined format first (e.g., "77 passed, 1 failed")
    if (failedPattern.test(line) && passedPattern.test(line)) {
      const failMatch = line.match(failedPattern);
      const passMatch = line.match(passedPattern);
      if (failMatch && passMatch) {
        return `${failMatch[1]} failed, ${passMatch[1]} passed`;
      }
    }

    // Otherwise collect separate lines
    if (!failed && failedPattern.test(line)) {
      const match = line.match(failedPattern);
      if (match) failed = match[1];
    }
    if (!passed && passedPattern.test(line)) {
      const match = line.match(passedPattern);
      if (match) passed = match[1];
    }

    // If we have both, return combined summary
    if (failed && passed) {
      return `${failed} failed, ${passed} passed`;
    }
  }

  // Return partial if we only found one
  if (failed) return `${failed} failed`;
  if (passed) return `${passed} passed`;

  return null;
}

/**
 * Format job summaries into the final output text
 */
function formatJobSummaries(
  run: WorkflowRunData,
  summaries: FailedJobSummary[],
  maxChars: number,
  parseWarnings?: string[]
): ToolResult {
  // TODO(#328): Consider extracting budget calculation pattern into helper function
  // Calculate warning text size FIRST to reserve space in budget
  let warningText = '';
  if (parseWarnings && parseWarnings.length > 0) {
    const warningLines = ['', '', '⚠️  EXTRACTION WARNING: Test output parsing encountered issues'];
    for (const warning of parseWarnings) {
      warningLines.push(`  - ${warning}`);
    }
    warningLines.push('Some test results may be incomplete. Check logs for details.');
    warningText = warningLines.join('\n');
  }

  const warningSize = warningText.length;
  const truncationMarker = '\n\n[... truncated due to length limit ...]';
  const truncationMarkerSize = truncationMarker.length;

  // Reserve space for warnings and truncation marker
  // Use Math.max to ensure we don't get negative budget
  const summaryBudget = Math.max(
    100, // Minimum budget to show at least some content
    maxChars - warningSize - truncationMarkerSize
  );

  // Build summary content
  const lines: string[] = [
    `Workflow Run Failed: ${run.name}`,
    `Overall Status: ${run.status} / ${run.conclusion || 'none'}`,
    `URL: ${run.url}`,
    '',
    `Failed Jobs (${summaries.length}):`,
  ];

  for (const job of summaries) {
    lines.push(``, `  Job: ${job.name} (${job.conclusion})`, `  URL: ${job.url}`);

    for (const step of job.failed_steps) {
      if (step.test_summary) {
        lines.push(`    Test Summary: ${step.test_summary}`);
      }
      lines.push(`    Step: ${step.name} (${step.conclusion})`);

      if (step.error_lines.length > 0) {
        const errorContent = step.error_lines.join('\n      ');
        lines.push(`      ${errorContent}`);
      }
    }
  }

  let output = lines.join('\n');

  // Truncate summary if it exceeds budget
  if (output.length > summaryBudget) {
    output = output.substring(0, summaryBudget) + truncationMarker;
  }

  // Append warnings (guaranteed to fit since we reserved space)
  if (warningText) {
    output += warningText;
  }

  // TODO(#345,#346): Track budget calculation bugs as tool errors, not silent warnings
  // Current: Returns success with [BUG] diagnostics when output exceeds max_chars
  // See PR review #273 for emergency truncation bug details
  // Final safety check - this should never trigger if our math is correct
  if (output.length > maxChars) {
    const overage = output.length - maxChars;

    const truncationNotice = [
      '',
      '⚠️  EMERGENCY TRUNCATION OCCURRED',
      '',
      `Content ${overage} chars over limit (${output.length} > ${maxChars})`,
      'This indicates a budget calculation bug.',
      '',
      'Budget Breakdown:',
      `  - Summary: ${summaryBudget} chars`,
      `  - Warnings: ${warningSize} chars`,
      `  - Expected: ${summaryBudget + warningSize + truncationMarkerSize}`,
      `  - Actual: ${output.length}`,
      '',
      'PLEASE FILE BUG REPORT with budget breakdown',
    ].join('\n');

    console.error(
      `[BUG] formatJobSummaries: output exceeded maxChars despite budget calculation. ` +
        `Expected: ${maxChars}, Actual: ${output.length}, Budget: ${summaryBudget}, WarningSize: ${warningSize}`
    );

    // Emergency truncation preserving as much context as possible
    const preserveAmount = Math.max(500, maxChars - truncationNotice.length - warningText.length);
    output =
      output.substring(0, preserveAmount) + truncationMarker + truncationNotice + warningText;
  }

  return { content: [{ type: 'text', text: output }] };
}

/**
 * Get failure details using `gh run view --log-failed`
 *
 * This approach provides cleaner, more focused error output by only
 * including logs from failed steps, filtered directly by GitHub CLI.
 *
 * Only works for completed workflow runs.
 */
async function getFailureDetailsFromLogFailed(
  runId: number,
  repo: string
): Promise<{ summaries: FailedJobSummary[]; parseWarnings: string[] }> {
  const output = await getFailedStepLogs(runId, repo);
  const parsedSteps = parseFailedStepLogs(output);

  const jobSummaries: Map<string, FailedJobSummary> = new Map();
  const parseWarnings: string[] = [];

  for (const step of parsedSteps) {
    // Create job summary if it doesn't exist
    if (!jobSummaries.has(step.jobName)) {
      jobSummaries.set(step.jobName, {
        name: step.jobName,
        url: `https://github.com/${repo}/actions/runs/${runId}`,
        conclusion: 'failure',
        failed_steps: [],
      });
    }

    const fullLog = step.lines.join('\n');

    // Try framework-specific extraction first, then generic
    const extraction = extractErrors(fullLog, 15);
    const errorLines = formatExtractionResult(extraction);

    // Collect parse warnings if present
    if (extraction.parseWarnings) {
      parseWarnings.push(`${step.jobName} / ${step.stepName}: ${extraction.parseWarnings}`);
    }

    // For unknown framework (generic extractor), use raw log lines instead of formatted output
    // This preserves formatting for diffs, build errors, etc.
    const finalLines = extraction.framework === 'unknown' ? step.lines.slice(-100) : errorLines;

    jobSummaries.get(step.jobName)!.failed_steps.push({
      name: step.stepName,
      conclusion: 'failure',
      error_lines: finalLines,
      test_summary: extraction.summary || extractTestSummary(fullLog),
    });
  }

  return {
    summaries: Array.from(jobSummaries.values()),
    parseWarnings,
  };
}

export async function getFailureDetails(input: GetFailureDetailsInput): Promise<ToolResult> {
  try {
    // Validate input - must have exactly one of run_id, pr_number, or branch
    const identifierCount = [input.run_id, input.pr_number, input.branch].filter(
      (x) => x !== undefined
    ).length;

    if (identifierCount === 0) {
      throw new ValidationError('Must provide at least one of: run_id, pr_number, or branch');
    }

    const resolvedRepo = await resolveRepo(input.repo);
    let runId: number;

    // Resolve run_id from pr_number or branch if needed
    if (input.run_id) {
      runId = input.run_id;
    } else if (input.pr_number) {
      const checks = await getWorkflowRunsForPR(input.pr_number, resolvedRepo);
      if (!Array.isArray(checks) || checks.length === 0) {
        throw new ValidationError(`No workflow runs found for PR #${input.pr_number}`);
      }

      // Find first failed check instead of just taking first check
      const failedCheck = checks.find(
        (check) => check.conclusion && FAILURE_CONCLUSIONS.includes(check.conclusion)
      );

      if (!failedCheck) {
        // No failed checks yet - this is a timing issue
        throw new ValidationError(
          `No failed checks found for PR #${input.pr_number}. ` +
            `Total checks: ${checks.length}. ` +
            `This may be a timing issue - check states might not be updated yet.`
        );
      }

      const runIdMatch = failedCheck.detailsUrl?.match(/\/runs\/(\d+)/);
      if (!runIdMatch) {
        throw new ValidationError(
          `Could not extract run ID from failed check: ${failedCheck.name}`
        );
      }
      runId = parseInt(runIdMatch[1], 10);
    } else if (input.branch) {
      const runs = await getWorkflowRunsForBranch(input.branch, resolvedRepo, 1);
      if (!Array.isArray(runs) || runs.length === 0) {
        throw new ValidationError(`No workflow runs found for branch ${input.branch}`);
      }
      runId = runs[0].databaseId;
    } else {
      throw new ValidationError('Must provide at least one of: run_id, pr_number, or branch');
    }

    // Get run details
    const run = (await getWorkflowRun(runId, resolvedRepo)) as WorkflowRunData;

    // Check if run is completed and failed
    const runCompleted = run.status === 'completed';
    const runFailed = run.conclusion === 'failure' || run.conclusion === 'timed_out';

    // For completed failed runs, use --log-failed (best output)
    // This provides cleaner, step-filtered logs directly from GitHub CLI
    let fallbackWarningPrefix = '';
    let usingFallbackDueToLogFailedError = false;

    if (runCompleted && runFailed) {
      try {
        const result = await getFailureDetailsFromLogFailed(runId, resolvedRepo);

        // Validate we got meaningful results
        if (
          result.summaries.length === 0 ||
          result.summaries.every((s) => s.failed_steps.length === 0)
        ) {
          throw new Error('--log-failed returned no failure details despite run failing');
        }

        // Format and return results using the new helper
        return formatJobSummaries(run, result.summaries, input.max_chars, result.parseWarnings);
      } catch (error) {
        // Fall through to job-based approach if --log-failed fails
        // This can happen if:
        // - No failed steps in the run (edge case)
        // - GitHub CLI version doesn't support --log-failed
        // - Other GitHub API issues
        const errorDetails = formatErrorMessage(error);

        // Extract exit code for warning prefix
        let errorTypeInfo = '';
        if (error instanceof GitHubCliError) {
          errorTypeInfo = error.exitCode ? ` (exit code ${error.exitCode})` : '';
        }

        // Create comprehensive warning to prepend to output
        fallbackWarningPrefix = [
          '⚠️  WARNING: Unable to use preferred error extraction method',
          '',
          'Attempted: gh run view --log-failed (provides cleanest output)',
          `Error: ${errorDetails}${errorTypeInfo}`,
          '',
          'Falling back to: GitHub API jobs endpoint',
          `  - Returns raw step logs without framework-specific parsing`,
          `  - May include build output mixed with test failures`,
          '',
          'To fix:',
          '- Ensure latest gh CLI: gh upgrade',
          '- Check GitHub token has workflow read permissions',
          '',
          '---',
          '',
        ].join('\n');

        usingFallbackDueToLogFailedError = true;

        console.error(
          formatErrorMessage(
            error,
            `Failed to get --log-failed output for run ${runId}, falling back to API approach`
          )
        );
      }
    }

    // Fallback: Job-based approach using GitHub API
    // Used for:
    // - In-progress runs with fail-fast detection
    // - Cases where --log-failed failed
    // - Runs that haven't completed yet but have failed jobs

    // Get all jobs first - we need to check for failed jobs even if run is still in progress
    // (supports fail-fast monitoring where we detect failures before run completes)
    const jobsData = (await getWorkflowJobs(runId, resolvedRepo)) as { jobs: JobData[] };
    const jobs = jobsData.jobs || [];

    // Filter to failed jobs
    const failedJobs = jobs.filter(
      (job) => job.conclusion === 'failure' || job.conclusion === 'timed_out'
    );

    // Check if any jobs have failed (for fail-fast support)
    // Note: runFailed is already declared above
    const hasFailedJobs = failedJobs.length > 0;

    if (!runFailed && !hasFailedJobs) {
      // Provide different messages for in-progress vs completed runs
      const isInProgress = run.status === 'in_progress';

      if (isInProgress) {
        return {
          content: [
            {
              type: 'text',
              text: [
                `Workflow run is still in progress: ${run.name}`,
                `Status: ${run.status}`,
                `No failed jobs found yet (checked ${jobs.length} jobs)`,
                `URL: ${run.url}`,
                ``,
                `This may be a timing issue - the PR checks API may report failures`,
                `before the jobs API is updated. Consider waiting a few seconds and retrying.`,
              ].join('\n'),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: [
              `Workflow run did not fail: ${run.name}`,
              `Status: ${run.status}`,
              `Conclusion: ${run.conclusion || 'none'}`,
              `URL: ${run.url}`,
            ].join('\n'),
          },
        ],
      };
    }

    if (failedJobs.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: [
              `No failed jobs found in workflow run: ${run.name}`,
              `Overall conclusion: ${run.conclusion}`,
              `URL: ${run.url}`,
            ].join('\n'),
          },
        ],
      };
    }

    // Collect failure details for each failed job
    const failedJobSummaries: FailedJobSummary[] = [];
    const parseWarnings: string[] = [];
    let totalChars = 0;

    for (const job of failedJobs) {
      const failedSteps: FailedStepSummary[] = [];

      // Get job logs (use large limit to capture full context for error detection)
      try {
        const logs = await getJobLogs(runId, job.databaseId, resolvedRepo, 10000);
        const testSummary = extractTestSummary(logs);

        // Find failed steps (if step info is available)
        const failedStepNames =
          job.steps
            ?.filter((step) => step.conclusion === 'failure' || step.conclusion === 'timed_out')
            .map((step) => step.name) || [];

        // Job logs from GitHub API don't have step boundaries
        // They are just timestamp + content, so we analyze the whole log
        // The extractor will identify framework-specific patterns
        const extraction = extractErrors(logs, 15);
        const errorLines = formatExtractionResult(extraction);

        // Collect parse warnings if present
        if (extraction.parseWarnings) {
          parseWarnings.push(`${job.name}: ${extraction.parseWarnings}`);
        }

        if (failedStepNames.length > 0) {
          // We know which steps failed, include that info
          for (const stepName of failedStepNames) {
            failedSteps.push({
              name: stepName,
              conclusion: 'failure',
              error_lines: errorLines,
              test_summary: extraction.summary || testSummary,
            });

            totalChars += stepName.length + errorLines.join('\n').length;
            if (extraction.summary || testSummary) {
              totalChars += (extraction.summary || testSummary)!.length;
            }
          }
        } else {
          // No step info available
          const lines = logs.split('\n');
          const last100Lines = lines.slice(-100);
          failedSteps.push({
            name: 'No step information available',
            conclusion: job.conclusion,
            error_lines: last100Lines,
            test_summary: null,
          });
          totalChars += last100Lines.join('\n').length;
        }
      } catch (error) {
        const errorMessage = formatErrorMessage(
          error,
          `Failed to retrieve logs for job ${job.name} in run ${runId}`
        );
        console.error(errorMessage);

        // Extract just the error details for the failed step display
        const errorDetailsOnly = formatErrorMessage(error);

        failedSteps.push({
          name: 'Unable to retrieve logs',
          conclusion: job.conclusion,
          error_lines: [
            errorDetailsOnly,
            error instanceof GitHubCliError && error.exitCode ? `Exit code: ${error.exitCode}` : '',
          ].filter(Boolean),
        });
      }

      failedJobSummaries.push({
        name: job.name,
        url: job.url,
        conclusion: job.conclusion,
        failed_steps: failedSteps,
      });

      if (totalChars > input.max_chars) break;
    }

    // Format the summary
    const jobSummaries = failedJobSummaries.map((job) => {
      const stepSummaries = job.failed_steps.map((step) => {
        const parts: string[] = [];

        // Add test summary if available
        if (step.test_summary) {
          parts.push(`    Test Summary: ${step.test_summary}`);
        }

        // Add step name and conclusion
        parts.push(`    Step: ${step.name} (${step.conclusion})`);

        // Add all error lines - no artificial limits
        if (step.error_lines.length > 0) {
          const errorContent = step.error_lines.join('\n      ');
          parts.push(`      ${errorContent}`);
        }

        return parts.join('\n');
      });

      return [
        ``,
        `  Job: ${job.name} (${job.conclusion})`,
        `  URL: ${job.url}`,
        ...stepSummaries,
      ].join('\n');
    });

    // Indicate if run is still in progress (fail-fast scenario)
    const headerSuffix = run.status !== 'completed' ? ' (run still in progress)' : '';

    // Calculate warning text size FIRST to reserve space in budget
    let warningText = '';
    if (parseWarnings.length > 0) {
      const warningLines = [
        '',
        '',
        '⚠️  EXTRACTION WARNING: Test output parsing encountered issues',
      ];
      for (const warning of parseWarnings) {
        warningLines.push(`  - ${warning}`);
      }
      warningLines.push('Some test results may be incomplete. Check logs for details.');
      warningText = warningLines.join('\n');
    }

    const warningSize = warningText.length;
    const truncationMarker = '\n\n... (truncated due to length limit)';
    const truncationMarkerSize = truncationMarker.length;

    // Reserve space for warnings and truncation marker
    const summaryBudget = Math.max(
      100, // Minimum budget
      input.max_chars - warningSize - truncationMarkerSize
    );

    // Build summary content
    let summary = [
      // Prepend fallback warning if --log-failed failed
      ...(usingFallbackDueToLogFailedError ? [fallbackWarningPrefix] : []),
      `Workflow Run Failed${headerSuffix}: ${run.name}`,
      `Overall Status: ${run.status} / ${run.conclusion || 'none'}`,
      `URL: ${run.url}`,
      ``,
      `Failed Jobs (${failedJobSummaries.length}):`,
      ...jobSummaries,
    ].join('\n');

    // Truncate summary if needed
    if (summary.length > summaryBudget) {
      summary = summary.substring(0, summaryBudget) + truncationMarker;
    }

    // Append warnings (guaranteed to fit)
    const finalSummary = summary + warningText;

    // Final safety check
    let outputText = finalSummary;
    if (finalSummary.length > input.max_chars) {
      const overage = finalSummary.length - input.max_chars;

      const truncationNotice = [
        '',
        '⚠️  EMERGENCY TRUNCATION OCCURRED',
        '',
        `Content ${overage} chars over limit (${finalSummary.length} > ${input.max_chars})`,
        'This indicates a budget calculation bug.',
        '',
        'Budget Breakdown:',
        `  - Summary: ${summaryBudget} chars`,
        `  - Warnings: ${warningSize} chars`,
        `  - Expected: ${summaryBudget + warningSize + truncationMarkerSize}`,
        `  - Actual: ${finalSummary.length}`,
        '',
        'PLEASE FILE BUG REPORT with budget breakdown',
      ].join('\n');

      console.error(
        `[BUG] getFailureDetails: output exceeded max_chars despite budget calculation. ` +
          `Expected: ${input.max_chars}, Actual: ${finalSummary.length}, Budget: ${summaryBudget}, WarningSize: ${warningSize}`
      );

      // Emergency truncation
      const preserveAmount = Math.max(
        500,
        input.max_chars - truncationNotice.length - warningText.length
      );
      outputText =
        summary.substring(0, preserveAmount) + truncationMarker + truncationNotice + warningText;
    }

    return {
      content: [{ type: 'text', text: outputText }],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
