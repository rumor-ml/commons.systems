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
  const quotedArgs = args.map((arg) => {
    // Quote arguments that contain spaces or special characters
    if (arg.includes(' ') || arg.includes('$') || arg.includes('"')) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  });
  const command = [scriptPath, ...quotedArgs].join(' ');

  try {
    const result = await execaCommand(command, {
      timeout,
      cwd,
      env: { ...process.env, ...env },
      shell: true,
      reject: false, // Don't reject on non-zero exit codes
    });

    if (result.exitCode !== 0) {
      throw new ScriptExecutionError(
        `Script failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`,
        result.exitCode,
        result.stderr
      );
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  } catch (error: unknown) {
    // Check for timeout specifically
    if (error instanceof Error && error.message.includes('timed out')) {
      throw new TimeoutError(`Script execution timed out after ${timeout}ms`);
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
 * @returns Promise resolving when script is started (not completed)
 */
export async function execScriptBackground(
  scriptPath: string,
  args: string[] = [],
  options: ExecOptions = {}
): Promise<void> {
  const { cwd, env } = options;

  // Build command with proper quoting
  const quotedArgs = args.map((arg) => {
    if (arg.includes(' ') || arg.includes('$') || arg.includes('"')) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  });
  const command = [scriptPath, ...quotedArgs].join(' ');

  try {
    // Start the process
    const subprocess = execaCommand(command, {
      cwd,
      env: { ...process.env, ...env },
      shell: true,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr temporarily
    });

    // Create promise that rejects on immediate failure
    const startupPromise = new Promise<void>((resolve, reject) => {
      let startupCompleted = false;

      // If process exits immediately, reject
      subprocess.on('exit', (code, signal) => {
        if (!startupCompleted) {
          reject(
            new ScriptExecutionError(
              `Background process exited immediately with code ${code ?? 'unknown'} (signal: ${signal ?? 'none'})`
            )
          );
        }
      });

      // If process survives 1 second, consider it started
      setTimeout(() => {
        startupCompleted = true;
        resolve();
      }, 1000);
    });

    await startupPromise;

    // Unref the subprocess so it doesn't keep Node.js alive
    subprocess.unref();
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
