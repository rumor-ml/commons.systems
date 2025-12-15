/**
 * Types for GitHub Workflow MCP server
 */

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  _meta?: {
    errorType?: string;
    errorCode?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown; // Required by MCP SDK, but isError and _meta are explicitly typed
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
}

export interface WorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string;
  completed_at?: string;
  html_url: string;
  steps?: WorkflowStep[];
}

export interface WorkflowStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
  started_at?: string;
  completed_at?: string;
}

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  started_at: string;
  completed_at?: string;
}

export interface PullRequest {
  number: number;
  title: string;
  state: string;
  html_url: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
}

export interface MergeQueueEntry {
  position: number;
  state: string;
  estimated_time_to_merge?: string;
}

export interface DeploymentUrl {
  url: string;
  job_name?: string;
  step_name?: string;
}

export interface FailureDetails {
  run_name: string;
  run_url: string;
  status: string;
  conclusion: string | null;
  failed_jobs: FailedJob[];
  summary: string;
}

export interface FailedJob {
  name: string;
  url: string;
  conclusion: string | null;
  failed_steps: FailedStep[];
}

export interface FailedStep {
  name: string;
  conclusion: string | null;
  error_summary: string;
}
