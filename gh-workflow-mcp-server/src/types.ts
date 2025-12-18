/**
 * Types for GitHub Workflow MCP server
 */

// Import shared types from mcp-common
import type { ToolResult, ToolSuccess, ToolError } from '@commons/mcp-common/types';

export type { ToolResult, ToolSuccess, ToolError };

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
