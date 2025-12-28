/**
 * Shared utility functions for state management
 *
 * This module contains reusable utilities for state validation,
 * JSON parsing, and security checks used across state management modules.
 *
 * TODO(#302): Implement comprehensive tests for security utils
 * Security-critical code needs thorough testing for edge cases and attack scenarios.
 */

import { logger } from '../utils/logger.js';
import { isValidStep, STEP_PHASE1_MONITOR_WORKFLOW } from '../constants.js';
import type { WiggumState } from './types.js';
import type { WiggumStep } from '../constants.js';

// Module-level validation: Ensure STEP_PHASE1_MONITOR_WORKFLOW is a valid step at import time
// This acts as a compile-time guard to catch inconsistencies in constants.ts
// If STEP_PHASE1_MONITOR_WORKFLOW is used as the default step in validateWiggumState, it must be valid
// Throwing at module initialization ensures the error is caught immediately on server start
// rather than during runtime when invalid state is encountered
if (!isValidStep(STEP_PHASE1_MONITOR_WORKFLOW)) {
  throw new Error(
    `CRITICAL: STEP_PHASE1_MONITOR_WORKFLOW constant "${STEP_PHASE1_MONITOR_WORKFLOW}" is not a valid step. ` +
      `This indicates the step enum was changed without updating STEP_PHASE1_MONITOR_WORKFLOW. ` +
      `Check constants.ts for consistency.`
  );
}

/**
 * Check for prototype pollution in parsed JSON object
 *
 * Recursively checks for dangerous property names that can be used for
 * prototype pollution attacks: __proto__, constructor, prototype.
 *
 * @param obj - Object to check for prototype pollution
 * @param depth - Current recursion depth (max 10 levels)
 * @returns true if pollution detected, false otherwise
 */
export function hasPrototypePollution(obj: unknown, depth: number = 0): boolean {
  // Limit recursion depth to prevent stack overflow
  if (depth > 10) return false;

  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const keys = Object.keys(obj);
  const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

  // Check for dangerous keys at this level
  for (const key of keys) {
    if (dangerousKeys.includes(key)) {
      return true;
    }

    // Recursively check nested objects
    const value = (obj as Record<string, unknown>)[key];
    if (hasPrototypePollution(value, depth + 1)) {
      return true;
    }
  }

  return false;
}

/**
 * Safely parse JSON with prototype pollution detection
 *
 * Wraps JSON.parse with validation to detect and reject objects
 * containing dangerous properties that could lead to prototype pollution.
 *
 * @param json - JSON string to parse
 * @returns Parsed object if safe
 * @throws Error if JSON is invalid or contains prototype pollution
 */
export function safeJsonParse(json: string): unknown {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch (parseError) {
    const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
    throw new Error(`JSON parse error: ${errorMsg}`);
  }

  if (hasPrototypePollution(parsed)) {
    throw new Error('Prototype pollution detected in JSON');
  }

  return parsed;
}

/**
 * Validate and sanitize wiggum state from untrusted JSON
 *
 * Converts unknown data into a valid WiggumState object, applying defaults
 * and filtering invalid values. Logs validation failures for debugging.
 *
 * @param data - Unknown data to validate (typically from JSON.parse)
 * @param source - Source identifier for logging (e.g., "PR comment", "issue comment")
 * @returns Validated WiggumState with safe defaults for invalid fields
 * @throws Error if data is not an object or is null
 */
export function validateWiggumState(data: unknown, source = 'unknown'): WiggumState {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid state: not an object');
  }

  const obj = data as Record<string, unknown>;

  const iteration = typeof obj.iteration === 'number' ? obj.iteration : 0;
  let step: WiggumStep;
  if (isValidStep(obj.step)) {
    step = obj.step;
  } else {
    // STEP_PHASE1_MONITOR_WORKFLOW validity is guaranteed by module-level validation at import time
    // Log at ERROR level since this indicates state corruption in comments
    // that may require investigation. The workflow recovers by restarting from
    // Phase 1 Step 1, but the corrupted comment should be investigated.
    logger.error(
      `validateWiggumState: invalid step value in ${source} state - possible corruption`,
      {
        source,
        invalidStep: obj.step,
        invalidStepType: typeof obj.step,
        defaultingTo: STEP_PHASE1_MONITOR_WORKFLOW,
        fullStateObject: JSON.stringify(obj).substring(0, 500),
        recoveryAction: 'Workflow will restart from Phase 1 Step 1 (Monitor Workflow)',
      }
    );
    step = STEP_PHASE1_MONITOR_WORKFLOW;
  }
  const completedSteps = Array.isArray(obj.completedSteps)
    ? obj.completedSteps.filter(isValidStep)
    : [];

  // Validate phase - default to 'phase1' if invalid
  let phase: 'phase1' | 'phase2' = 'phase1';
  if (obj.phase === 'phase1' || obj.phase === 'phase2') {
    phase = obj.phase;
  } else if (obj.phase !== undefined) {
    logger.warn('validateWiggumState: invalid phase value, defaulting to phase1', {
      source,
      invalidPhase: obj.phase,
      defaultingTo: 'phase1',
    });
  }

  // Extract maxIterations (optional field)
  let maxIterations: number | undefined = undefined;
  if ('maxIterations' in obj && obj.maxIterations !== undefined) {
    if (
      typeof obj.maxIterations === 'number' &&
      Number.isInteger(obj.maxIterations) &&
      obj.maxIterations > 0
    ) {
      maxIterations = obj.maxIterations;
    } else {
      logger.warn('validateWiggumState: invalid maxIterations value', {
        source,
        invalidValue: obj.maxIterations,
        invalidType: typeof obj.maxIterations,
        defaultingTo: 'undefined',
      });
    }
  }

  return { iteration, step, completedSteps, phase, maxIterations };
}
