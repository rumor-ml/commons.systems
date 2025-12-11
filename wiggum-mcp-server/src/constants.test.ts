/**
 * Tests for constants and type definitions
 *
 * Comprehensive test coverage for type-safe constants and validations.
 * Tests cover step validation, discriminated unions, and constant integrity.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  STEP_ENSURE_PR,
  STEP_MONITOR_WORKFLOW,
  STEP_MONITOR_PR_CHECKS,
  STEP_CODE_QUALITY,
  STEP_PR_REVIEW,
  STEP_SECURITY_REVIEW,
  STEP_VERIFY_REVIEWS,
  STEP_APPROVAL,
  STEP_NAMES,
  isValidStep,
  type WiggumStep,
} from './constants.js';

describe('Step Constants', () => {
  it('should define all step constants with correct values', () => {
    assert.strictEqual(STEP_ENSURE_PR, '0');
    assert.strictEqual(STEP_MONITOR_WORKFLOW, '1');
    assert.strictEqual(STEP_MONITOR_PR_CHECKS, '1b');
    assert.strictEqual(STEP_CODE_QUALITY, '2');
    assert.strictEqual(STEP_PR_REVIEW, '3');
    assert.strictEqual(STEP_SECURITY_REVIEW, '4');
    assert.strictEqual(STEP_VERIFY_REVIEWS, '4b');
    assert.strictEqual(STEP_APPROVAL, 'approval');
  });

  it('should have all steps defined in STEP_NAMES', () => {
    assert.strictEqual(STEP_NAMES[STEP_ENSURE_PR], 'Ensure PR Exists');
    assert.strictEqual(STEP_NAMES[STEP_MONITOR_WORKFLOW], 'Monitor Workflow');
    assert.strictEqual(STEP_NAMES[STEP_MONITOR_PR_CHECKS], 'Monitor PR Checks');
    assert.strictEqual(STEP_NAMES[STEP_CODE_QUALITY], 'Address Code Quality Comments');
    assert.strictEqual(STEP_NAMES[STEP_PR_REVIEW], 'PR Review');
    assert.strictEqual(STEP_NAMES[STEP_SECURITY_REVIEW], 'Security Review');
    assert.strictEqual(STEP_NAMES[STEP_VERIFY_REVIEWS], 'Verify Reviews');
    assert.strictEqual(STEP_NAMES[STEP_APPROVAL], 'Approval');
  });

  it('should have exactly 8 steps defined', () => {
    const steps = Object.keys(STEP_NAMES);
    assert.strictEqual(steps.length, 8);
  });
});

describe('Step Validation (isValidStep)', () => {
  it('should validate all valid step identifiers', () => {
    assert.strictEqual(isValidStep(STEP_ENSURE_PR), true);
    assert.strictEqual(isValidStep(STEP_MONITOR_WORKFLOW), true);
    assert.strictEqual(isValidStep(STEP_MONITOR_PR_CHECKS), true);
    assert.strictEqual(isValidStep(STEP_CODE_QUALITY), true);
    assert.strictEqual(isValidStep(STEP_PR_REVIEW), true);
    assert.strictEqual(isValidStep(STEP_SECURITY_REVIEW), true);
    assert.strictEqual(isValidStep(STEP_VERIFY_REVIEWS), true);
    assert.strictEqual(isValidStep(STEP_APPROVAL), true);
  });

  it('should validate string literals directly', () => {
    assert.strictEqual(isValidStep('0'), true);
    assert.strictEqual(isValidStep('1'), true);
    assert.strictEqual(isValidStep('1b'), true);
    assert.strictEqual(isValidStep('2'), true);
    assert.strictEqual(isValidStep('3'), true);
    assert.strictEqual(isValidStep('4'), true);
    assert.strictEqual(isValidStep('4b'), true);
    assert.strictEqual(isValidStep('approval'), true);
  });

  it('should reject invalid step identifiers', () => {
    assert.strictEqual(isValidStep('5'), false);
    assert.strictEqual(isValidStep('invalid'), false);
    assert.strictEqual(isValidStep(''), false);
    assert.strictEqual(isValidStep('step-0'), false);
  });

  it('should reject non-string values', () => {
    assert.strictEqual(isValidStep(0), false);
    assert.strictEqual(isValidStep(1), false);
    assert.strictEqual(isValidStep(null), false);
    assert.strictEqual(isValidStep(undefined), false);
    assert.strictEqual(isValidStep({}), false);
    assert.strictEqual(isValidStep([]), false);
  });

  it('should work as type guard', () => {
    const value: unknown = STEP_APPROVAL;

    if (isValidStep(value)) {
      // TypeScript should narrow the type here
      const _step: WiggumStep = value;
      assert.strictEqual(_step, 'approval');
    }
  });
});

describe('Step Order and Progression', () => {
  it('should have steps in logical order', () => {
    const stepOrder = [
      STEP_ENSURE_PR,
      STEP_MONITOR_WORKFLOW,
      STEP_MONITOR_PR_CHECKS,
      STEP_CODE_QUALITY,
      STEP_PR_REVIEW,
      STEP_SECURITY_REVIEW,
      STEP_VERIFY_REVIEWS,
      STEP_APPROVAL,
    ];

    // Verify the order matches expected progression
    assert.deepEqual(stepOrder, ['0', '1', '1b', '2', '3', '4', '4b', 'approval']);
  });

  it('should have all unique step identifiers', () => {
    const steps = [
      STEP_ENSURE_PR,
      STEP_MONITOR_WORKFLOW,
      STEP_MONITOR_PR_CHECKS,
      STEP_CODE_QUALITY,
      STEP_PR_REVIEW,
      STEP_SECURITY_REVIEW,
      STEP_VERIFY_REVIEWS,
      STEP_APPROVAL,
    ];

    const uniqueSteps = new Set(steps);
    assert.strictEqual(uniqueSteps.size, steps.length);
  });
});
