/**
 * Tests for constants and type definitions
 *
 * Current coverage focuses on schema validation and type safety.
 * Tests cover step validation, discriminated unions, and constant integrity.
 */
// TODO(#313): Add behavioral/integration tests for actual tool workflows

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
  generateWorkflowTriageInstructions,
  SKIP_MECHANISM_GUIDANCE,
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

  describe('reviewType validation', () => {
    it('should reject invalid reviewType', () => {
      assert.throws(
        // @ts-expect-error - Testing invalid reviewType
        () => generateTriageInstructions(123, 'Invalid', 5),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid reviewType'));
          assert(err.message.includes('Must be either'));
          return true;
        }
      );
    });

    it('should reject empty string reviewType', () => {
      assert.throws(
        // @ts-expect-error - Testing invalid reviewType
        () => generateTriageInstructions(123, '', 5),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid reviewType'));
          return true;
        }
      );
    });

    it('should reject lowercase reviewType', () => {
      assert.throws(
        // @ts-expect-error - Testing invalid reviewType
        () => generateTriageInstructions(123, 'pr', 5),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid reviewType'));
          return true;
        }
      );
    });

    it('should accept valid PR reviewType', () => {
      const result = generateTriageInstructions(123, 'PR', 5);
      assert(typeof result === 'string');
      assert(result.length > 0);
    });

    it('should accept valid Security reviewType', () => {
      const result = generateTriageInstructions(123, 'Security', 5);
      assert(typeof result === 'string');
      assert(result.length > 0);
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

    it('should generate valid markdown structure', () => {
      const result = generateTriageInstructions(123, 'PR', 5);

      // Check for proper markdown headers (## for main steps, ### for substeps)
      assert(result.match(/^## Step 1:/m), 'Missing Step 1 header');
      assert(result.match(/^## Step 2:/m), 'Missing Step 2 header');
      assert(result.match(/^## Step 3:/m), 'Missing Step 3 header');
      assert(result.match(/^### 2a\./m), 'Missing substep 2a');
      assert(result.match(/^### 2b\./m), 'Missing substep 2b');
      assert(result.match(/^### 2c\./m), 'Missing substep 2c');
      assert(result.match(/^### 2d\./m), 'Missing substep 2d');
      assert(result.match(/^### 2e\./m), 'Missing substep 2e');
      assert(result.match(/^### 2f\./m), 'Missing substep 2f');
    });

    it('should maintain correct step ordering', () => {
      const result = generateTriageInstructions(123, 'PR', 5);

      const step1Index = result.indexOf('## Step 1:');
      const step2Index = result.indexOf('## Step 2:');
      const step3Index = result.indexOf('## Step 3:');

      assert(step1Index !== -1, 'Step 1 not found');
      assert(step2Index !== -1, 'Step 2 not found');
      assert(step3Index !== -1, 'Step 3 not found');
      assert(step1Index < step2Index, 'Step 1 should come before Step 2');
      assert(step2Index < step3Index, 'Step 2 should come before Step 3');
    });

    it('should format different review types with correct casing', () => {
      const prResult = generateTriageInstructions(123, 'PR', 5);
      const secResult = generateTriageInstructions(456, 'Security', 3);

      // PR review should be lowercase in issue count
      assert(prResult.includes('pr review issue(s)'), 'PR review not lowercase');

      // Security review should be lowercase in issue count
      assert(secResult.includes('security review issue(s)'), 'Security review not lowercase');
    });

    it('should include all required tool references', () => {
      const result = generateTriageInstructions(123, 'PR', 5);

      assert(result.includes('EnterPlanMode'), 'Missing EnterPlanMode tool');
      assert(result.includes('ExitPlanMode'), 'Missing ExitPlanMode tool');
      assert(result.includes('Task tool'), 'Missing Task tool');
      assert(result.includes('AskUserQuestion'), 'Missing AskUserQuestion tool');
      assert(result.includes('gh issue list'), 'Missing gh issue list command');
      assert(result.includes('gh issue edit'), 'Missing gh issue edit command');
    });

    it('should include slash command reference', () => {
      const result = generateTriageInstructions(123, 'PR', 5);
      assert(result.includes('/commit-merge-push'), 'Missing /commit-merge-push command');
    });

    it('should specify required sections in plan', () => {
      const result = generateTriageInstructions(123, 'PR', 5);

      assert(result.includes('**A. In-Scope Fixes**'), 'Missing In-Scope Fixes section');
      assert(
        result.includes('**B. Out-of-Scope Tracking**'),
        'Missing Out-of-Scope Tracking section'
      );
    });
  });
});

describe('generateWorkflowTriageInstructions', () => {
  describe('issueNumber validation', () => {
    it('should reject non-finite issueNumber', () => {
      assert.throws(
        () => generateWorkflowTriageInstructions(Infinity, 'Workflow', 'test failure'),
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
        () => generateWorkflowTriageInstructions(0, 'Workflow', 'test failure'),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid issueNumber: 0'));
          return true;
        }
      );
    });

    it('should reject negative issueNumber', () => {
      assert.throws(
        () => generateWorkflowTriageInstructions(-1, 'PR checks', 'test failure'),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid issueNumber: -1'));
          return true;
        }
      );
    });

    it('should reject non-integer issueNumber', () => {
      assert.throws(
        () => generateWorkflowTriageInstructions(42.5, 'Workflow', 'test failure'),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid issueNumber: 42.5'));
          return true;
        }
      );
    });

    it('should reject NaN issueNumber', () => {
      assert.throws(
        () => generateWorkflowTriageInstructions(NaN, 'Workflow', 'test failure'),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid issueNumber'));
          return true;
        }
      );
    });
  });

  describe('failureType validation', () => {
    it('should reject invalid failureType', () => {
      assert.throws(
        // @ts-expect-error - Testing invalid failureType
        () => generateWorkflowTriageInstructions(123, 'Invalid', 'test failure'),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid failureType'));
          assert(err.message.includes('Must be either'));
          return true;
        }
      );
    });

    it('should reject empty string failureType', () => {
      assert.throws(
        // @ts-expect-error - Testing invalid failureType
        () => generateWorkflowTriageInstructions(123, '', 'test failure'),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid failureType'));
          return true;
        }
      );
    });

    it('should reject lowercase failureType', () => {
      assert.throws(
        // @ts-expect-error - Testing invalid failureType
        () => generateWorkflowTriageInstructions(123, 'workflow', 'test failure'),
        (err: Error) => {
          assert(err instanceof ValidationError);
          assert(err.message.includes('Invalid failureType'));
          return true;
        }
      );
    });

    it('should accept valid Workflow failureType', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure details');
      assert(typeof result === 'string');
      assert(result.length > 0);
    });

    it('should accept valid PR checks failureType', () => {
      const result = generateWorkflowTriageInstructions(123, 'PR checks', 'check failure details');
      assert(typeof result === 'string');
      assert(result.length > 0);
    });
  });

  describe('output format', () => {
    it('should include issue number in output', () => {
      const result = generateWorkflowTriageInstructions(456, 'Workflow', 'test failure');
      assert(result.includes('**Working on Issue:** #456'));
      assert(result.includes('for issue #456'));
    });

    it('should include failure type in output', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');
      assert(result.includes('Workflow failed'));
    });

    it('should include failure details in output', () => {
      const failureDetails = 'Test suite failed with 5 errors';
      const result = generateWorkflowTriageInstructions(123, 'Workflow', failureDetails);
      assert(result.includes('**Failure Details:**'));
      assert(result.includes(failureDetails));
    });

    it('should contain all required workflow steps', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');

      // Verify all major sections are present
      assert(result.includes('## Step 1: Enter Plan Mode'));
      assert(result.includes('## Step 2: In Plan Mode - Triage Failures'));
      assert(result.includes('### 2a. Fetch Issue Context'));
      assert(result.includes('### 2b. Triage Each Failure'));
      assert(result.includes('### 2c. Handle Ambiguous Scope'));
      assert(result.includes('### 2d. Check Existing Issues for Out-of-Scope Items'));
      assert(result.includes('### 2e. Write Plan with These Sections'));
      assert(result.includes('### 2f. Exit Plan Mode'));
      assert(result.includes('## Step 3: Execute Plan (After Exiting Plan Mode)'));
    });

    it('should contain workflow-specific scope criteria', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');

      assert(result.includes('**IN SCOPE criteria (must meet at least one):**'));
      assert(result.includes('Tests validating code changed in this PR/implementation'));
      assert(result.includes('Build failures in modified modules'));
      assert(result.includes('Linting/formatting errors in changed files'));
      assert(result.includes('Type checking errors in implementation'));

      assert(result.includes('**OUT OF SCOPE criteria:**'));
      assert(result.includes('Flaky tests with intermittent failures'));
      assert(result.includes('Tests in unrelated modules'));
      assert(result.includes('Pre-existing failing tests'));
      assert(result.includes('Infrastructure issues'));
    });

    it('should include skip mechanism guidance', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');

      // Skip mechanism guidance should be referenced
      assert(result.includes(SKIP_MECHANISM_GUIDANCE));

      // Verify key skip mechanisms are mentioned
      assert(result.includes('Test Framework Skipping'));
      assert(result.includes('CI Step Skipping'));
      assert(result.includes('it.skip'));
      assert(result.includes('t.Skip'));
      assert(result.includes('@pytest.mark.skip'));
      assert(result.includes('if: false'));
    });

    it('should include TODO comment format', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');
      assert(result.includes('// TODO(#NNN):'));
      assert(result.includes('[brief description]'));
    });

    it('should include mcp__gh-issue__gh_get_issue_context reference', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');
      assert(result.includes('mcp__gh-issue__gh_get_issue_context'));
    });

    it('should include wiggum_complete_fix call instructions', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');
      assert(result.includes('wiggum_complete_fix'));
      assert(result.includes('fix_description'));
      assert(result.includes('has_in_scope_fixes'));
      assert(result.includes('out_of_scope_issues'));
    });

    it('should generate valid markdown structure', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');

      // Check for proper markdown headers (## for main steps, ### for substeps)
      assert(result.match(/^## Step 1:/m), 'Missing Step 1 header');
      assert(result.match(/^## Step 2:/m), 'Missing Step 2 header');
      assert(result.match(/^## Step 3:/m), 'Missing Step 3 header');
      assert(result.match(/^### 2a\./m), 'Missing substep 2a');
      assert(result.match(/^### 2b\./m), 'Missing substep 2b');
      assert(result.match(/^### 2c\./m), 'Missing substep 2c');
      assert(result.match(/^### 2d\./m), 'Missing substep 2d');
      assert(result.match(/^### 2e\./m), 'Missing substep 2e');
      assert(result.match(/^### 2f\./m), 'Missing substep 2f');
    });

    it('should maintain correct step ordering', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');

      const step1Index = result.indexOf('## Step 1:');
      const step2Index = result.indexOf('## Step 2:');
      const step3Index = result.indexOf('## Step 3:');

      assert(step1Index !== -1, 'Step 1 not found');
      assert(step2Index !== -1, 'Step 2 not found');
      assert(step3Index !== -1, 'Step 3 not found');
      assert(step1Index < step2Index, 'Step 1 should come before Step 2');
      assert(step2Index < step3Index, 'Step 2 should come before Step 3');
    });

    it('should include all required tool references', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');

      assert(result.includes('EnterPlanMode'), 'Missing EnterPlanMode tool');
      assert(result.includes('ExitPlanMode'), 'Missing ExitPlanMode tool');
      assert(result.includes('Task tool'), 'Missing Task tool');
      assert(result.includes('AskUserQuestion'), 'Missing AskUserQuestion tool');
      assert(result.includes('gh issue list'), 'Missing gh issue list command');
      assert(result.includes('gh issue edit'), 'Missing gh issue edit command');
    });

    it('should include slash command reference', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');
      assert(result.includes('/commit-merge-push'), 'Missing /commit-merge-push command');
    });

    it('should specify required sections in plan', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');

      assert(result.includes('**A. In-Scope Fixes**'), 'Missing In-Scope Fixes section');
      assert(
        result.includes('**B. Out-of-Scope with Skip Mechanism**'),
        'Missing Out-of-Scope with Skip Mechanism section'
      );
    });

    it('should include search for existing issues guidance', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');

      assert(result.includes('gh issue list -S "flaky test name"'));
      assert(result.includes('gh issue list -S "infrastructure failure type"'));
      assert(result.includes('gh run list --branch main'));
    });

    it('should handle different failure types correctly', () => {
      const workflowResult = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');
      const prChecksResult = generateWorkflowTriageInstructions(456, 'PR checks', 'check failed');

      assert(workflowResult.includes('Workflow failed'));
      assert(prChecksResult.includes('PR checks failed'));
    });

    it('should include has_in_scope_fixes parameter documentation', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');

      assert(
        result.includes(
          'has_in_scope_fixes: true if any in-scope fixes made, false if all out-of-scope'
        )
      );
    });

    it('should include skip mechanism execution guidance', () => {
      const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');

      assert(result.includes('Skip tests/steps using planned mechanism'));
      assert(result.includes('Add skip annotations'));
      assert(result.includes('Add conditional'));
    });
  });
});

describe('SKIP_MECHANISM_GUIDANCE constant', () => {
  it('should be a non-empty string', () => {
    assert(typeof SKIP_MECHANISM_GUIDANCE === 'string');
    assert(SKIP_MECHANISM_GUIDANCE.length > 0);
  });

  it('should include test framework skip patterns', () => {
    assert(SKIP_MECHANISM_GUIDANCE.includes('it.skip'));
    assert(SKIP_MECHANISM_GUIDANCE.includes('t.Skip'));
    assert(SKIP_MECHANISM_GUIDANCE.includes('@pytest.mark.skip'));
  });

  it('should include CI step skip patterns', () => {
    assert(SKIP_MECHANISM_GUIDANCE.includes('if: false'));
    assert(
      SKIP_MECHANISM_GUIDANCE.includes(
        "contains(github.event.pull_request.labels.*.name, 'enable-flaky-tests')"
      )
    );
    assert(SKIP_MECHANISM_GUIDANCE.includes("if: github.ref == 'refs/heads/main'"));
  });

  it('should include TODO comment requirement', () => {
    assert(SKIP_MECHANISM_GUIDANCE.includes('// TODO(#NNN):'));
  });
});
