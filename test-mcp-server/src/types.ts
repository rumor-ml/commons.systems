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
  | { readonly status: 'not_started' } // Discriminant
  | { readonly status: 'running'; readonly module: string; start_time: number }
  | { readonly status: 'passed'; readonly module: string; duration_ms: number }
  | { readonly status: 'failed'; readonly module: string; duration_ms: number; error_message: string };

export interface ModuleInfo {
  readonly name: string;
  readonly path: string;
  readonly test_files: ReadonlyArray<string>;
}

/**
 * Firebase emulator status (discriminated union)
 *
 * Use type narrowing with running field:
 * - running: false - No emulators are running
 * - running: true - Emulators are active (includes services array)
 */
export type EmulatorStatus =
  | { readonly running: false } // Discriminant
  | {
      readonly running: true; // Discriminant
      services: Array<{
        readonly name: string; // Service identity
        readonly port: number; // Service identity
        readonly host: string; // Service identity
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
  | { readonly running: false } // Discriminant
  | { readonly running: true; readonly url: string; readonly port: number; readonly module: string }; // All are server identity

export interface PortAllocation {
  readonly service: string; // Service identity
  readonly port: number; // Port identity
  in_use: boolean; // Mutable status
}
