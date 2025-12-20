/**
 * Tests for constants and type definitions
 *
 * Comprehensive test coverage for type-safe constants and validations.
 * Tests cover step validation, discriminated unions, and constant integrity.
 */
// TODO: See issue #313 - Convert to behavioral/integration tests

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  STEP_PHASE1_MONITOR_WORKFLOW,
  STEP_PHASE1_PR_REVIEW,
  STEP_PHASE1_SECURITY_REVIEW,
  STEP_PHASE1_CREATE_PR,
  STEP_PHASE2_MONITOR_WORKFLOW,
  STEP_PHASE2_MONITOR_CHECKS,
  STEP_PHASE2_CODE_QUALITY,
  STEP_PHASE2_PR_REVIEW,
  STEP_PHASE2_SECURITY_REVIEW,
  STEP_PHASE2_APPROVAL,
  STEP_NAMES,
  isValidStep,
  generateTriageInstructions,
  type WiggumStep,
} from './constants.js';
import { ValidationError } from './utils/errors.js';

describe('Step Constants', () => {
  it('should define all Phase 1 step constants with correct values', () => {
    assert.strictEqual(STEP_PHASE1_MONITOR_WORKFLOW, 'p1-1');
    assert.strictEqual(STEP_PHASE1_PR_REVIEW, 'p1-2');
    assert.strictEqual(STEP_PHASE1_SECURITY_REVIEW, 'p1-3');
    assert.strictEqual(STEP_PHASE1_CREATE_PR, 'p1-4');
  });

  it('should define all Phase 2 step constants with correct values', () => {
    assert.strictEqual(STEP_PHASE2_MONITOR_WORKFLOW, 'p2-1');
    assert.strictEqual(STEP_PHASE2_MONITOR_CHECKS, 'p2-2');
    assert.strictEqual(STEP_PHASE2_CODE_QUALITY, 'p2-3');
    assert.strictEqual(STEP_PHASE2_PR_REVIEW, 'p2-4');
    assert.strictEqual(STEP_PHASE2_SECURITY_REVIEW, 'p2-5');
    assert.strictEqual(STEP_PHASE2_APPROVAL, 'approval');
  });

  it('should have all steps defined in STEP_NAMES', () => {
    assert.strictEqual(STEP_NAMES[STEP_PHASE1_MONITOR_WORKFLOW], 'Phase 1: Monitor Workflow');
    assert.strictEqual(STEP_NAMES[STEP_PHASE1_PR_REVIEW], 'Phase 1: Code Review (Pre-PR)');
    assert.strictEqual(
      STEP_NAMES[STEP_PHASE1_SECURITY_REVIEW],
      'Phase 1: Security Review (Pre-PR)'
    );
    assert.strictEqual(STEP_NAMES[STEP_PHASE1_CREATE_PR], 'Phase 1: Create PR');
    assert.strictEqual(STEP_NAMES[STEP_PHASE2_MONITOR_WORKFLOW], 'Phase 2: Monitor Workflow');
    assert.strictEqual(STEP_NAMES[STEP_PHASE2_MONITOR_CHECKS], 'Phase 2: Monitor PR Checks');
    assert.strictEqual(
      STEP_NAMES[STEP_PHASE2_CODE_QUALITY],
      'Phase 2: Address Code Quality Comments'
    );
    assert.strictEqual(STEP_NAMES[STEP_PHASE2_PR_REVIEW], 'Phase 2: PR Review (Post-PR)');
    assert.strictEqual(
      STEP_NAMES[STEP_PHASE2_SECURITY_REVIEW],
      'Phase 2: Security Review (Post-PR)'
    );
    assert.strictEqual(STEP_NAMES[STEP_PHASE2_APPROVAL], 'Approval');
  });

  it('should have exactly 10 steps defined', () => {
    const steps = Object.keys(STEP_NAMES);
    assert.strictEqual(steps.length, 10);
  });
});

describe('Step Validation (isValidStep)', () => {
  it('should validate all valid step identifiers', () => {
    assert.strictEqual(isValidStep(STEP_PHASE1_MONITOR_WORKFLOW), true);
    assert.strictEqual(isValidStep(STEP_PHASE1_PR_REVIEW), true);
    assert.strictEqual(isValidStep(STEP_PHASE1_SECURITY_REVIEW), true);
    assert.strictEqual(isValidStep(STEP_PHASE1_CREATE_PR), true);
    assert.strictEqual(isValidStep(STEP_PHASE2_MONITOR_WORKFLOW), true);
    assert.strictEqual(isValidStep(STEP_PHASE2_MONITOR_CHECKS), true);
    assert.strictEqual(isValidStep(STEP_PHASE2_CODE_QUALITY), true);
    assert.strictEqual(isValidStep(STEP_PHASE2_PR_REVIEW), true);
    assert.strictEqual(isValidStep(STEP_PHASE2_SECURITY_REVIEW), true);
    assert.strictEqual(isValidStep(STEP_PHASE2_APPROVAL), true);
  });

  it('should validate string literals directly', () => {
    assert.strictEqual(isValidStep('p1-1'), true);
    assert.strictEqual(isValidStep('p1-2'), true);
    assert.strictEqual(isValidStep('p1-3'), true);
    assert.strictEqual(isValidStep('p1-4'), true);
    assert.strictEqual(isValidStep('p2-1'), true);
    assert.strictEqual(isValidStep('p2-2'), true);
    assert.strictEqual(isValidStep('p2-3'), true);
    assert.strictEqual(isValidStep('p2-4'), true);
    assert.strictEqual(isValidStep('p2-5'), true);
    assert.strictEqual(isValidStep('approval'), true);
  });

  it('should reject invalid step identifiers', () => {
    assert.strictEqual(isValidStep('0'), false);
    assert.strictEqual(isValidStep('1'), false);
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
    const value: unknown = STEP_PHASE2_APPROVAL;

    if (isValidStep(value)) {
      // TypeScript should narrow the type here
      const _step: WiggumStep = value;
      assert.strictEqual(_step, 'approval');
    }
  });
});

describe('Step Order and Progression', () => {
  it('should have steps in logical order', () => {
    const phase1Order = [
      STEP_PHASE1_MONITOR_WORKFLOW,
      STEP_PHASE1_PR_REVIEW,
      STEP_PHASE1_SECURITY_REVIEW,
      STEP_PHASE1_CREATE_PR,
    ];

    const phase2Order = [
      STEP_PHASE2_MONITOR_WORKFLOW,
      STEP_PHASE2_MONITOR_CHECKS,
      STEP_PHASE2_CODE_QUALITY,
      STEP_PHASE2_PR_REVIEW,
      STEP_PHASE2_SECURITY_REVIEW,
      STEP_PHASE2_APPROVAL,
    ];

    // Verify the order matches expected progression
    assert.deepEqual(phase1Order, ['p1-1', 'p1-2', 'p1-3', 'p1-4']);
    assert.deepEqual(phase2Order, ['p2-1', 'p2-2', 'p2-3', 'p2-4', 'p2-5', 'approval']);
  });

  it('should have all unique step identifiers', () => {
    const steps = [
      STEP_PHASE1_MONITOR_WORKFLOW,
      STEP_PHASE1_PR_REVIEW,
      STEP_PHASE1_SECURITY_REVIEW,
      STEP_PHASE1_CREATE_PR,
      STEP_PHASE2_MONITOR_WORKFLOW,
      STEP_PHASE2_MONITOR_CHECKS,
      STEP_PHASE2_CODE_QUALITY,
      STEP_PHASE2_PR_REVIEW,
      STEP_PHASE2_SECURITY_REVIEW,
      STEP_PHASE2_APPROVAL,
    ];

    const uniqueSteps = new Set(steps);
    assert.strictEqual(uniqueSteps.size, steps.length);
  });
});

describe('generateTriageInstructions', () => {
  describe('issueNumber validation', () => {
    it('should reject non-finite issueNumber', () => {
      assert.throws(
        () => generateTriageInstructions(Infinity, 'PR', 5),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid issueNumber'));
          assert(err.message.includes('Must be a positive integer'));
          return true;
        }
      );
    });

    it('should reject zero issueNumber', () => {
      assert.throws(
        () => generateTriageInstructions(0, 'PR', 5),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid issueNumber: 0'));
          return true;
        }
      );
    });

    it('should reject negative issueNumber', () => {
      assert.throws(
        () => generateTriageInstructions(-1, 'Security', 3),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid issueNumber: -1'));
          return true;
        }
      );
    });

    it('should reject non-integer issueNumber', () => {
      assert.throws(
        () => generateTriageInstructions(42.5, 'PR', 5),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid issueNumber: 42.5'));
          return true;
        }
      );
    });

    it('should reject NaN issueNumber', () => {
      assert.throws(
        () => generateTriageInstructions(NaN, 'PR', 5),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid issueNumber'));
          return true;
        }
      );
    });
  });

  describe('totalIssues validation', () => {
    it('should reject negative totalIssues', () => {
      assert.throws(
        () => generateTriageInstructions(123, 'PR', -1),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid totalIssues: -1'));
          assert(err.message.includes('Must be a non-negative integer'));
          return true;
        }
      );
    });

    it('should reject non-integer totalIssues', () => {
      assert.throws(
        () => generateTriageInstructions(123, 'PR', 5.5),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid totalIssues: 5.5'));
          return true;
        }
      );
    });

    it('should reject non-finite totalIssues', () => {
      assert.throws(
        () => generateTriageInstructions(123, 'PR', Infinity),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid totalIssues'));
          return true;
        }
      );
    });

    it('should accept zero totalIssues', () => {
      const result = generateTriageInstructions(123, 'PR', 0);
      assert(result.includes('0 pr review issue(s) found'));
    });
  });

  describe('output format', () => {
    it('should include issue number in output', () => {
      const result = generateTriageInstructions(456, 'PR', 10);
      assert(result.includes('**Working on Issue:** #456'));
      assert(result.includes('for issue #456'));
    });

    it('should include total issues count in output', () => {
      const result = generateTriageInstructions(123, 'PR', 15);
      assert(result.includes('15 pr review issue(s) found'));
    });

    it('should format PR review type correctly', () => {
      const result = generateTriageInstructions(123, 'PR', 5);
      assert(result.includes('5 pr review issue(s) found'));
      assert(!result.includes('5 PR review issue(s)'));
    });

    it('should format Security review type correctly', () => {
      const result = generateTriageInstructions(123, 'Security', 3);
      assert(result.includes('3 security review issue(s) found'));
      assert(!result.includes('3 Security review issue(s)'));
    });

    it('should contain all required workflow steps', () => {
      const result = generateTriageInstructions(123, 'PR', 5);

      // Verify all major sections are present
      assert(result.includes('## Step 1: Enter Plan Mode'));
      assert(result.includes('## Step 2: In Plan Mode - Triage Recommendations'));
      assert(result.includes('### 2a. Fetch Issue Context'));
      assert(result.includes('### 2b. Triage Each Recommendation'));
      assert(result.includes('### 2c. Handle Ambiguous Scope'));
      assert(result.includes('### 2d. Check Existing Issues for Out-of-Scope Items'));
      assert(result.includes('### 2e. Write Plan with These Sections'));
      assert(result.includes('### 2f. Exit Plan Mode'));
      assert(result.includes('## Step 3: Execute Plan (After Exiting Plan Mode)'));
    });

    it('should contain scope criteria', () => {
      const result = generateTriageInstructions(123, 'PR', 5);

      assert(result.includes('**IN SCOPE criteria (must meet at least one):**'));
      assert(result.includes('**OUT OF SCOPE criteria:**'));
    });

    it('should include mcp__gh-issue__gh_get_issue_context reference', () => {
      const result = generateTriageInstructions(123, 'PR', 5);
      assert(result.includes('mcp__gh-issue__gh_get_issue_context'));
    });

    it('should include wiggum_complete_fix call instructions', () => {
      const result = generateTriageInstructions(123, 'PR', 5);
      assert(result.includes('wiggum_complete_fix'));
      assert(result.includes('fix_description'));
      assert(result.includes('out_of_scope_issues'));
    });
  });
});
