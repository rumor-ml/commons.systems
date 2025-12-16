/**
 * Types for Test MCP server
 */

// Import shared types from mcp-common
export type { ToolResult, ToolSuccess, ToolError } from '@commons/mcp-common/types';

/**
 * Test execution status (discriminated union)
 *
 * Use type narrowing with status field to distinguish between states:
 * - not_started: Test hasn't been executed yet
 * - running: Test is currently executing (includes module and start time)
 * - passed: Test completed successfully (includes module and duration)
 * - failed: Test failed (includes module, duration, and error message)
 */
export type TestStatus =
  | { status: 'not_started' }
  | { status: 'running'; module: string; start_time: number }
  | { status: 'passed'; module: string; duration_ms: number }
  | { status: 'failed'; module: string; duration_ms: number; error_message: string };

export interface ModuleInfo {
  name: string;
  path: string;
  test_files: string[];
}

/**
 * Firebase emulator status (discriminated union)
 *
 * Use type narrowing with running field:
 * - running: false - No emulators are running
 * - running: true - Emulators are active (includes services array)
 */
export type EmulatorStatus =
  | { running: false }
  | {
      running: true;
      services: Array<{
        name: string;
        port: number;
        host: string;
      }>;
    };

/**
 * Development server status (discriminated union)
 *
 * Use type narrowing with running field:
 * - running: false - Dev server is not running
 * - running: true - Dev server is active (includes URL, port, and module)
 */
export type DevServerStatus =
  | { running: false }
  | { running: true; url: string; port: number; module: string };

export interface PortAllocation {
  service: string;
  port: number;
  in_use: boolean;
}
