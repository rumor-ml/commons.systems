/**
 * Types for Test MCP server
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
