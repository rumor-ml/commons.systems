/**
 * Shell script execution utilities
 */

import { execaCommand } from 'execa';
import { ScriptExecutionError, TimeoutError } from './errors.js';

export interface ExecOptions {
  timeout?: number; // in milliseconds
  cwd?: string;
  env?: Record<string, string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface BackgroundProcess {
  pid: number;
  isRunning: () => Promise<boolean>;
  getError: () => Error | null;
}

/**
 * Validate that a shell argument doesn't contain unsafe metacharacters
 *
 * Rejects arguments containing shell metacharacters that could enable command injection:
 * - Backticks (`) for command substitution
 * - Pipes (|) for command chaining
 * - Semicolons (;) for command chaining
 * - Ampersands (&) for background execution
 * - Angle brackets (<, >) for redirects
 * - Parentheses ((), {}, []) for subshells/grouping
 * - Backslashes (\) for escaping (except in already-quoted strings)
 * - Exclamation marks (!) for history expansion
 *
 * @param arg - The argument to validate
 * @throws {Error} If argument contains unsafe shell metacharacters
 */
export function validateShellArg(arg: string): void {
  const unsafeChars = /[`|;&<>(){}[\]\\!]/;
  if (unsafeChars.test(arg)) {
    throw new Error(
      `Shell injection risk detected in argument: "${arg}"\n\n` +
      `Rejected characters: \` | ; & < > ( ) { } [ ] \\ !\n\n` +
      `These metacharacters can execute arbitrary commands when passed to shell:\n` +
      `  Example: "file.txt; rm -rf /" could delete your entire filesystem\n\n` +
      `Solutions:\n` +
      `  1. Use shell-quote library for complex escaping\n` +
      `  2. Pass data via stdin instead of command line arguments\n` +
      `  3. Use array-based execution without shell: true`
    );
  }
}

/**
 * Quote a shell argument for simple cases
 *
 * WARNING: This is NOT comprehensive shell escaping. Only handles:
 * - Spaces
 * - Dollar signs ($)
 * - Double quotes (")
 *
 * This function validates arguments before quoting to reject unsafe metacharacters.
 * For complex shell escaping needs, use the shell-quote library.
 *
 * @param arg - The argument to quote
 * @returns Properly quoted argument string
 * @throws {Error} If argument contains unsafe shell metacharacters
 */
export function quoteShellArg(arg: string): string {
  // Validate first - fail fast on unsafe characters
  validateShellArg(arg);

  // Quote arguments that contain spaces or special characters
  if (arg.includes(' ') || arg.includes('$') || arg.includes('"')) {
    return `"${arg.replace(/"/g, '\\"')}"`;
  }
  return arg;
}

/**
 * Build a shell command from script path and arguments
 * @param scriptPath - Full path to the script
 * @param args - Arguments to pass to the script
 * @returns Command string with properly quoted arguments
 */
export function buildCommand(scriptPath: string, args: string[] = []): string {
  const quotedArgs = args.map(quoteShellArg);
  return [scriptPath, ...quotedArgs].join(' ');
}

/**
 * Execute a shell script with arguments
 *
 * @param scriptPath - Full path to the script to execute
 * @param args - Arguments to pass to the script
 * @param options - Execution options (timeout, cwd, env)
 * @returns Promise resolving to execution result
 * @throws {ScriptExecutionError} If script exits with non-zero code
 * @throws {TimeoutError} If execution exceeds timeout
 */
export async function execScript(
  scriptPath: string,
  args: string[] = [],
  options: ExecOptions = {}
): Promise<ExecResult> {
  const { timeout, cwd, env } = options;

  // Build command with proper quoting for arguments
  const command = buildCommand(scriptPath, args);

  try {
    const result = await execaCommand(command, {
      timeout,
      cwd,
      env: { ...process.env, ...env },
      shell: true,
      reject: false, // Don't reject on non-zero exit codes
    });

    if (result.exitCode !== 0) {
      // Provide context-specific error messages for common exit codes
      let contextMessage = '';
      switch (result.exitCode) {
        case 126:
          contextMessage = 'Permission denied or script is not executable. Try: chmod +x <script>';
          break;
        case 127:
          contextMessage = 'Command not found. Check that the script exists and is in PATH.';
          break;
        case 130:
          contextMessage = 'Script interrupted by Ctrl+C (SIGINT).';
          break;
        case 137:
          contextMessage = 'Script killed by SIGKILL (possible OOM or manual kill -9).';
          break;
        case 143:
          contextMessage = 'Script terminated by SIGTERM.';
          break;
      }

      const errorOutput = result.stderr || result.stdout;
      const message = contextMessage
        ? `Script failed with exit code ${result.exitCode}: ${contextMessage}\n\nOutput: ${errorOutput}`
        : `Script failed with exit code ${result.exitCode}: ${errorOutput}`;

      throw new ScriptExecutionError(message, result.exitCode, result.stderr);
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  } catch (error: unknown) {
    // Check for timeout using execa's timedOut property
    if (error && typeof error === 'object' && 'timedOut' in error && error.timedOut === true) {
      throw new TimeoutError(
        `Script execution timed out after ${timeout}ms\n` +
        `Script: ${scriptPath}\n` +
        `Arguments: ${args.join(' ') || '(none)'}\n` +
        `Working directory: ${cwd || process.cwd()}\n\n` +
        `Troubleshooting:\n` +
        `  - Increase timeout with timeout_seconds parameter\n` +
        `  - Check if script is hanging on input\n` +
        `  - Verify script doesn't have infinite loops or deadlocks`
      );
    }

    // Re-throw ScriptExecutionError as-is
    if (error instanceof ScriptExecutionError) {
      throw error;
    }

    // Wrap other errors
    throw new ScriptExecutionError(
      `Failed to execute script: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Execute a script and capture only stdout
 *
 * @param scriptPath - Full path to the script to execute
 * @param args - Arguments to pass to the script
 * @param options - Execution options
 * @returns Promise resolving to stdout content
 */
export async function captureOutput(
  scriptPath: string,
  args: string[] = [],
  options: ExecOptions = {}
): Promise<string> {
  const result = await execScript(scriptPath, args, options);
  return result.stdout.trim();
}

/**
 * Execute a script in the background (non-blocking)
 *
 * @param scriptPath - Full path to the script to execute
 * @param args - Arguments to pass to the script
 * @param options - Execution options
 * @returns Promise resolving to BackgroundProcess when script is started
 */
export async function execScriptBackground(
  scriptPath: string,
  args: string[] = [],
  options: ExecOptions = {}
): Promise<BackgroundProcess> {
  const { cwd, env } = options;

  // Build command with proper quoting
  const command = buildCommand(scriptPath, args);

  try {
    // Start the process
    const subprocess = execaCommand(command, {
      cwd,
      env: { ...process.env, ...env },
      shell: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr temporarily
    });

    // Track process error
    let processError: Error | null = null;

    // Create promise for background process startup
    const startupPromise = new Promise<void>((resolve) => {
      let startupCompleted = false;

      // Background processes are fire-and-forget - resolve even on immediate exit
      subprocess.on('exit', () => {
        if (!startupCompleted) {
          startupCompleted = true;
          resolve();
        }
      });

      // If process survives 100ms, consider it started
      setTimeout(() => {
        startupCompleted = true;
        resolve();
      }, 100);
    });

    // Catch any subprocess errors to prevent unhandled rejections and track them
    subprocess.catch((error) => {
      processError = error instanceof Error ? error : new Error(String(error));
      // Log background process failures for diagnostics
      const errorDetails = {
        script: scriptPath,
        args,
        timestamp: new Date().toISOString(),
        error: processError.message,
        exitCode: error && typeof error === 'object' && 'exitCode' in error ? error.exitCode : undefined,
      };
      console.error('[exec] Background subprocess failed:', JSON.stringify(errorDetails));
    });

    await startupPromise;

    // Check if process errored during startup
    if (processError !== null) {
      const errorExitCode = 'exitCode' in processError ? (processError as any).exitCode as number | undefined : undefined;
      throw new ScriptExecutionError(
        `Background script failed during startup: ${(processError as Error).message}`,
        errorExitCode,
        (processError as Error).message
      );
    }

    // Verify process is still running
    try {
      const checkResult = await execaCommand(`ps -p ${subprocess.pid}`, { reject: false });
      if (checkResult.exitCode !== 0) {
        throw new ScriptExecutionError(
          `Background script exited immediately after startup. Check logs for details.`,
          undefined,
          'Process terminated during startup'
        );
      }
    } catch {
      throw new ScriptExecutionError(
        `Background script exited immediately after startup. Check logs for details.`,
        undefined,
        'Process terminated during startup'
      );
    }

    // Unref the subprocess so it doesn't keep Node.js alive
    subprocess.unref();

    // Return BackgroundProcess interface with error tracking
    return {
      pid: subprocess.pid!,
      isRunning: async () => {
        try {
          const result = await execaCommand(`ps -p ${subprocess.pid}`, { reject: false });
          return result.exitCode === 0;
        } catch {
          return false;
        }
      },
      getError: () => processError,
    };
  } catch (error: unknown) {
    // Re-throw ScriptExecutionError
    if (error instanceof ScriptExecutionError) {
      throw error;
    }

    // Wrap other errors
    throw new ScriptExecutionError(
      `Failed to start background script: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
