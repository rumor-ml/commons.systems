/**
 * Tool: gh_get_deployment_urls
 * Extract deployment URLs from workflow run logs
 */

import { z } from 'zod';
import type { ToolResult } from '../types.js';
import { URL_PATTERN, DEPLOYMENT_URL_KEYWORDS } from '../constants.js';
import {
  getWorkflowRun,
  getWorkflowRunsForBranch,
  getWorkflowRunsForPR,
  getWorkflowJobs,
  getJobLogs,
  resolveRepo,
} from '../utils/gh-cli.js';
import { ValidationError, createErrorResult } from '../utils/errors.js';

export const GetDeploymentUrlsInputSchema = z
  .object({
    run_id: z.number().int().positive().optional(),
    pr_number: z.number().int().positive().optional(),
    branch: z.string().optional(),
    repo: z.string().optional(),
  })
  .strict();

export type GetDeploymentUrlsInput = z.infer<typeof GetDeploymentUrlsInputSchema>;

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
}

interface DeploymentUrl {
  url: string;
  job_name: string;
  context: string;
}

function extractDeploymentUrls(logText: string, jobName: string): DeploymentUrl[] {
  const urls: DeploymentUrl[] = [];
  const lines = logText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();

    // Check if line contains deployment keywords
    const hasDeploymentKeyword = DEPLOYMENT_URL_KEYWORDS.some((keyword) =>
      line.includes(keyword.toLowerCase())
    );

    if (hasDeploymentKeyword) {
      // Extract URLs from this line and nearby lines
      const contextLines = lines.slice(Math.max(0, i - 1), i + 2).join(' ');
      const urlMatches = contextLines.match(URL_PATTERN);

      if (urlMatches) {
        for (const url of urlMatches) {
          // Filter out common non-deployment URLs
          if (
            !url.includes('github.com') &&
            !url.includes('githubusercontent.com') &&
            !url.includes('npmjs.com') &&
            !url.includes('nodejs.org')
          ) {
            urls.push({
              url: url,
              job_name: jobName,
              context: lines[i].substring(0, 200), // Keep first 200 chars of context
            });
          }
        }
      }
    }
  }

  return urls;
}

export async function getDeploymentUrls(input: GetDeploymentUrlsInput): Promise<ToolResult> {
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
      const firstCheck = checks[0];
      const runIdMatch = firstCheck.detailsUrl?.match(/\/runs\/(\d+)/);
      if (!runIdMatch) {
        throw new ValidationError(`Could not extract run ID from PR #${input.pr_number} checks`);
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

    // Get all jobs for this run
    const jobsData = (await getWorkflowJobs(runId, resolvedRepo)) as { jobs: JobData[] };
    const jobs = jobsData.jobs || [];

    // Collect deployment URLs from all jobs
    const allDeploymentUrls: DeploymentUrl[] = [];

    for (const job of jobs) {
      try {
        const logs = await getJobLogs(runId, job.databaseId, resolvedRepo);
        const urls = extractDeploymentUrls(logs, job.name);
        allDeploymentUrls.push(...urls);
      } catch (error) {
        // Skip jobs where we can't get logs (might still be running or failed early)
        continue;
      }
    }

    // Deduplicate URLs
    const uniqueUrls = Array.from(
      new Map(allDeploymentUrls.map((item) => [item.url, item])).values()
    );

    if (uniqueUrls.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: [
              `No deployment URLs found in workflow run: ${run.name}`,
              `Run URL: ${run.url}`,
              `Status: ${run.status} / ${run.conclusion || 'none'}`,
            ].join('\n'),
          },
        ],
      };
    }

    const urlSummaries = uniqueUrls.map((item) => {
      return `  - ${item.url}\n    Job: ${item.job_name}\n    Context: ${item.context.trim()}`;
    });

    const summary = [
      `Found ${uniqueUrls.length} deployment URL(s) in workflow run: ${run.name}`,
      `Run URL: ${run.url}`,
      ``,
      `Deployment URLs:`,
      ...urlSummaries,
    ].join('\n');

    return {
      content: [{ type: 'text', text: summary }],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
