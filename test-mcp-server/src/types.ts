/**
 * Types for Test MCP server
 */

// Import shared types from mcp-common
export type { ToolResult, ToolSuccess, ToolError } from '@commons/mcp-common/types';

// Import branded types for type safety
import type { Port, URL } from '@commons/types/branded';
import { unwrap, createURL } from '@commons/types/branded';

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
  | { readonly status: 'running'; readonly module: string; readonly startTime: number }
  | { readonly status: 'passed'; readonly module: string; readonly durationMs: number }
  | {
      readonly status: 'failed';
      readonly module: string;
      readonly durationMs: number;
      readonly errorMessage: string;
    };

export interface ModuleInfo {
  readonly name: string;
  readonly path: string;
  readonly testFiles: ReadonlyArray<string>;
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
        readonly port: Port; // Service identity - branded type
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
  | { readonly running: true; readonly url: URL; readonly port: Port; readonly module: string }; // All are server identity - using branded types

export interface PortAllocation {
  readonly service: string; // Service identity
  readonly port: Port; // Port identity - branded type
  inUse: boolean; // Mutable status
}

// ============================================================================
// Factory Functions for Type-Safe Construction
// ============================================================================

/**
 * TestStatus Factory Functions
 *
 * These functions provide type-safe construction of TestStatus variants,
 * ensuring invariants are maintained (e.g., test end time must be after start time).
 */

/**
 * Create a running test status
 *
 * @param module - Module name being tested
 * @returns TestStatus in running state with current timestamp
 */
export function startTest(module: string): TestStatus {
  return { status: 'running', module, startTime: Date.now() };
}

/**
 * Create a passed test status from a running test
 *
 * @param running - Running test status to transition from
 * @param endTime - Test completion timestamp
 * @returns TestStatus in passed state with duration
 * @throws Error if end time is before start time
 */
export function passTest(
  running: Extract<TestStatus, { status: 'running' }>,
  endTime: number
): TestStatus {
  const durationMs = endTime - running.startTime;
  if (durationMs < 0) {
    throw new Error('Test end time cannot be before start time');
  }
  return { status: 'passed', module: running.module, durationMs };
}

/**
 * Create a failed test status from a running test
 *
 * @param running - Running test status to transition from
 * @param endTime - Test failure timestamp
 * @param errorMessage - Description of test failure
 * @returns TestStatus in failed state with duration and error
 * @throws Error if end time is before start time
 */
export function failTest(
  running: Extract<TestStatus, { status: 'running' }>,
  endTime: number,
  errorMessage: string
): TestStatus {
  const durationMs = endTime - running.startTime;
  if (durationMs < 0) {
    throw new Error('Test end time cannot be before start time');
  }
  return { status: 'failed', module: running.module, durationMs, errorMessage };
}

/**
 * DevServerStatus Factory Functions
 *
 * These functions provide type-safe construction of dev server status variants.
 */

/**
 * Create a running dev server status
 *
 * @param module - Module name the dev server is running for
 * @param port - Server port (branded Port type)
 * @param host - Server hostname (default: 'localhost')
 * @param protocol - Server protocol (default: 'http')
 * @returns DevServerStatus in running state with URL, port, and module
 */
export function createDevServerStatus(
  module: string,
  port: Port,
  host: string = 'localhost',
  protocol: 'http' | 'https' = 'http'
): DevServerStatus {
  return {
    running: true,
    url: createURL(`${protocol}://${host}:${unwrap(port)}`),
    port,
    module,
  };
}

/**
 * Create a stopped dev server status
 *
 * @returns DevServerStatus in not running state
 */
export function stopDevServer(): DevServerStatus {
  return { running: false };
}

/**
 * EmulatorStatus Factory Functions
 *
 * These functions provide type-safe construction of emulator status variants.
 */

/**
 * Emulator service configuration
 */
export interface EmulatorService {
  readonly name: string;
  readonly port: Port;
  readonly host: string;
}

/**
 * Create an emulator status from services
 *
 * @param services - Array of emulator services
 * @returns EmulatorStatus in running state if services provided, stopped otherwise
 */
export function createEmulatorStatus(services: EmulatorService[]): EmulatorStatus {
  if (services.length === 0) {
    return { running: false };
  }
  return { running: true, services };
}
