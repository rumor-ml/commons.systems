/**
 * Filesystem utility functions for test MCP server
 */

import path from 'path';

/**
 * Extract error code from an unknown error object
 *
 * @param error - Error object (may be Error, object with code property, or other)
 * @returns Error code string, or 'unknown' if not available
 */
export function getErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
}

/**
 * Get the Claude temporary directory path
 *
 * @returns Path to /tmp/claude directory
 */
export function getClaudeTmpDir(): string {
  return '/tmp/claude';
}

/**
 * Get a path within the Claude temporary directory
 *
 * @param segments - Path segments to join with /tmp/claude
 * @returns Full path to /tmp/claude/<segments>
 */
export function getClaudeTmpPath(...segments: string[]): string {
  return path.join('/tmp/claude', ...segments);
}
