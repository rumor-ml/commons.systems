/**
 * Types for Test MCP server
 */

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  [key: string]: unknown;
}

export interface TestStatus {
  status: 'running' | 'passed' | 'failed' | 'not_started';
  module?: string;
  duration_ms?: number;
  error_message?: string;
}

export interface ModuleInfo {
  name: string;
  path: string;
  test_files: string[];
}

export interface EmulatorStatus {
  running: boolean;
  services?: Array<{
    name: string;
    port: number;
    host: string;
  }>;
  error_message?: string;
}

export interface DevServerStatus {
  running: boolean;
  url?: string;
  port?: number;
  error_message?: string;
}

export interface PortAllocation {
  service: string;
  port: number;
  in_use: boolean;
}
