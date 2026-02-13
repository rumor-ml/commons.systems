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
  STEP_PHASE1_CREATE_PR,
  STEP_PHASE2_MONITOR_WORKFLOW,
  STEP_PHASE2_MONITOR_CHECKS,
  STEP_PHASE2_CODE_QUALITY,
  STEP_PHASE2_PR_REVIEW,
  STEP_PHASE2_SECURITY_REVIEW,
  STEP_PHASE2_APPROVAL,
  STEP_MAX,
  STEP_NAMES,
  isValidStep,
  generateTriageInstructions,
  generateWorkflowTriageInstructions,
  generateOutOfScopeTrackingInstructions,
  generateScopeSeparatedFixInstructions,
  SKIP_MECHANISM_GUIDANCE,
  type WiggumStep,
} from './constants.js';
import { ValidationError } from './utils/errors.js';

describe('Step Constants', () => {
  it('should define all Phase 1 step constants with correct values', () => {
    assert.strictEqual(STEP_PHASE1_MONITOR_WORKFLOW, 'p1-1');
    assert.strictEqual(STEP_PHASE1_PR_REVIEW, 'p1-2');
    assert.strictEqual(STEP_PHASE1_CREATE_PR, 'p1-3');
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
    assert.strictEqual(isValidStep(STEP_PHASE1_CREATE_PR), true);
    assert.strictEqual(isValidStep(STEP_PHASE2_MONITOR_WORKFLOW), true);
    assert.strictEqual(isValidStep(STEP_PHASE2_MONITOR_CHECKS), true);
    assert.strictEqual(isValidStep(STEP_PHASE2_CODE_QUALITY), true);
    assert.strictEqual(isValidStep(STEP_PHASE2_PR_REVIEW), true);
    assert.strictEqual(isValidStep(STEP_PHASE2_SECURITY_REVIEW), true);
    assert.strictEqual(isValidStep(STEP_PHASE2_APPROVAL), true);
    assert.strictEqual(isValidStep(STEP_MAX), true);
  });

  it('should validate string literals directly', () => {
    assert.strictEqual(isValidStep('p1-1'), true);
    assert.strictEqual(isValidStep('p1-2'), true);
    assert.strictEqual(isValidStep('p1-3'), true);
    assert.strictEqual(isValidStep('p2-1'), true);
    assert.strictEqual(isValidStep('p2-2'), true);
    assert.strictEqual(isValidStep('p2-3'), true);
    assert.strictEqual(isValidStep('p2-4'), true);
    assert.strictEqual(isValidStep('p2-5'), true);
    assert.strictEqual(isValidStep('approval'), true);
    assert.strictEqual(isValidStep('max'), true);
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

    // STEP_ORDER defines workflow progression and is used for validation in formatWiggumResponse
    assert.deepEqual(phase1Order, ['p1-1', 'p1-2', 'p1-3']);
    assert.deepEqual(phase2Order, ['p2-1', 'p2-2', 'p2-3', 'p2-4', 'p2-5', 'approval']);
  });

  it('should have all unique step identifiers', () => {
    const steps = [
      STEP_PHASE1_MONITOR_WORKFLOW,
      STEP_PHASE1_PR_REVIEW,
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

describe('Phase-Specific Review Commands', () => {
  describe('command constant integrity', () => {
    it('should define PHASE1_PR_REVIEW_COMMAND as /all-hands-review', () => {
      const { PHASE1_PR_REVIEW_COMMAND } = require('./constants.js');
      assert.strictEqual(PHASE1_PR_REVIEW_COMMAND, '/all-hands-review');
    });

    it('should define PHASE2_PR_REVIEW_COMMAND as /review', () => {
      const { PHASE2_PR_REVIEW_COMMAND } = require('./constants.js');
      assert.strictEqual(PHASE2_PR_REVIEW_COMMAND, '/review');
    });

    it('should have distinct phase1 and phase2 commands', () => {
      const { PHASE1_PR_REVIEW_COMMAND, PHASE2_PR_REVIEW_COMMAND } = require('./constants.js');
      assert.notStrictEqual(
        PHASE1_PR_REVIEW_COMMAND,
        PHASE2_PR_REVIEW_COMMAND,
        'Phase 1 and Phase 2 commands must be different'
      );
    });

    it('should follow slash command format for phase1', () => {
      const { PHASE1_PR_REVIEW_COMMAND } = require('./constants.js');
      assert.ok(PHASE1_PR_REVIEW_COMMAND.startsWith('/'), 'Phase 1 command should start with /');
      assert.ok(PHASE1_PR_REVIEW_COMMAND.length > 1, 'Phase 1 command should have content after /');
    });

    it('should follow slash command format for phase2', () => {
      const { PHASE2_PR_REVIEW_COMMAND } = require('./constants.js');
      assert.ok(PHASE2_PR_REVIEW_COMMAND.startsWith('/'), 'Phase 2 command should start with /');
      assert.ok(PHASE2_PR_REVIEW_COMMAND.length > 1, 'Phase 2 command should have content after /');
    });

    it('should define SECURITY_REVIEW_COMMAND as /security-review', () => {
      const { SECURITY_REVIEW_COMMAND } = require('./constants.js');
      assert.strictEqual(SECURITY_REVIEW_COMMAND, '/security-review');
    });

    it('should use same security review command for both phases', () => {
      const { SECURITY_REVIEW_COMMAND } = require('./constants.js');
      // Security review uses the same command in both phases
      // This test documents that behavior
      assert.strictEqual(SECURITY_REVIEW_COMMAND, '/security-review');
    });
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

describe('generateOutOfScopeTrackingInstructions', () => {
  it('should include file list in output', () => {
    const result = generateOutOfScopeTrackingInstructions(123, 'PR', 3, [
      '/tmp/claude/file1.md',
      '/tmp/claude/file2.md',
    ]);
    assert(result.includes('/tmp/claude/file1.md'));
    assert(result.includes('/tmp/claude/file2.md'));
  });

  it('should include issue number when provided', () => {
    const result = generateOutOfScopeTrackingInstructions(456, 'Security', 2, [
      '/tmp/claude/file.md',
    ]);
    assert(result.includes('issue #456'));
  });

  it('should handle undefined issue number', () => {
    const result = generateOutOfScopeTrackingInstructions(undefined, 'PR', 1, [
      '/tmp/claude/file.md',
    ]);
    assert(result.includes('this work'));
    assert(!result.includes('issue #undefined'));
  });

  it('should include review type in lowercase', () => {
    const prResult = generateOutOfScopeTrackingInstructions(123, 'PR', 5, ['/tmp/f.md']);
    const secResult = generateOutOfScopeTrackingInstructions(123, 'Security', 3, ['/tmp/f.md']);

    assert(prResult.includes('pr review'));
    assert(secResult.includes('security review'));
  });

  it('should include out-of-scope count in header', () => {
    const result = generateOutOfScopeTrackingInstructions(123, 'PR', 7, ['/tmp/f.md']);
    assert(result.includes('7 out-of-scope'));
  });

  it('should mention step is complete', () => {
    const result = generateOutOfScopeTrackingInstructions(123, 'PR', 3, ['/tmp/f.md']);
    assert(result.includes('**complete**'));
  });

  it('should include issue creation template guidance', () => {
    const result = generateOutOfScopeTrackingInstructions(123, 'PR', 2, ['/tmp/f.md']);
    assert(result.includes('**Issue Creation Template:**'));
    assert(result.includes('Title:'));
    assert(result.includes('Body:'));
    assert(result.includes('Labels:'));
  });

  it('should include gh issue list search command', () => {
    const result = generateOutOfScopeTrackingInstructions(123, 'PR', 1, ['/tmp/f.md']);
    assert(result.includes('gh issue list -S'));
    assert(result.includes('--json number,title,body'));
  });

  it('should include Task tool example', () => {
    const result = generateOutOfScopeTrackingInstructions(123, 'PR', 1, ['/tmp/f.md']);
    assert(result.includes('Task({'));
    assert(result.includes('subagent_type: "general-purpose"'));
    assert(result.includes('model: "sonnet"'));
  });

  it('should include label suggestions', () => {
    const result = generateOutOfScopeTrackingInstructions(123, 'PR', 1, ['/tmp/f.md']);
    assert(result.includes('"enhancement"'));
    assert(result.includes('"from-review"'));
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

describe('All-hands review scope separation', () => {
  it('should not include wiggum_list_issues in single-issue triage instructions', () => {
    const result = generateTriageInstructions(123, 'PR', 5);
    assert(
      !result.includes('wiggum_list_issues'),
      'Single-issue triage should not reference wiggum_list_issues'
    );
  });

  it('should not include wiggum_list_issues in workflow triage instructions', () => {
    const result = generateWorkflowTriageInstructions(123, 'Workflow', 'test failure');
    assert(
      !result.includes('wiggum_list_issues'),
      'Workflow triage should not reference wiggum_list_issues'
    );
  });

  it('should not include scope filter in single-issue triage instructions', () => {
    const result = generateTriageInstructions(123, 'PR', 5);
    assert(
      !result.includes('scope:') && !result.includes("scope: 'in-scope'"),
      'Single-issue triage should not reference scope filter'
    );
  });
});

describe('generateScopeSeparatedFixInstructions', () => {
  // TODO(#2026): Add validation tests once input validation is implemented
  describe('output format', () => {
    it('should include issue number in output', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 5, ['/tmp/in.md'], 2, [
        '/tmp/out.md',
      ]);
      assert(result.includes('#123'));
      assert(result.includes('issue #123'));
    });

    it('should include in-scope file list', () => {
      const result = generateScopeSeparatedFixInstructions(
        123,
        'PR',
        3,
        ['/tmp/in1.md', '/tmp/in2.md'],
        0,
        []
      );
      assert(result.includes('/tmp/in1.md'));
      assert(result.includes('/tmp/in2.md'));
    });

    it('should include out-of-scope file list when provided', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 3, ['/tmp/in.md'], 2, [
        '/tmp/out1.md',
        '/tmp/out2.md',
      ]);
      assert(result.includes('/tmp/out1.md'));
      assert(result.includes('/tmp/out2.md'));
    });

    it('should include Agent 1 and Agent 2 sections when both counts > 0', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 5, ['/tmp/in.md'], 3, [
        '/tmp/out.md',
      ]);
      assert(result.includes('### Agent 1:'));
      assert(result.includes('### Agent 2:'));
    });

    it('should omit Agent 2 section when outOfScopeCount is 0', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 5, ['/tmp/in.md'], 0, []);
      assert(result.includes('### Agent 1:'));
      assert(!result.includes('### Agent 2:'));
    });

    it('should use correct model for each agent', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 1, ['/tmp/in.md'], 1, [
        '/tmp/out.md',
      ]);
      assert(result.includes('model: "sonnet"')); // All agents use sonnet model
    });

    it('should include in-scope count in header', () => {
      const result = generateScopeSeparatedFixInstructions(456, 'PR', 7, ['/tmp/in.md'], 0, []);
      assert(result.includes('7 in-scope pr review issue(s) found'));
    });

    it('should include both counts in header when out-of-scope exists', () => {
      const result = generateScopeSeparatedFixInstructions(456, 'PR', 5, ['/tmp/in.md'], 3, [
        '/tmp/out.md',
      ]);
      assert(result.includes('5 in-scope pr review issue(s) found'));
      assert(result.includes('3 out-of-scope recommendation(s)'));
    });

    it('should include parallel agent instructions', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 1, ['/tmp/in.md'], 1, [
        '/tmp/out.md',
      ]);
      assert(result.includes('Launch TWO Agents in PARALLEL'));
      assert(result.includes('Task({'));
      assert(result.includes('subagent_type: "general-purpose"'));
    });

    it('should include wiggum_complete_fix instructions', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 1, ['/tmp/in.md'], 0, []);
      assert(result.includes('wiggum_complete_fix'));
      assert(result.includes('fix_description'));
      assert(result.includes('has_in_scope_fixes'));
      assert(result.includes('out_of_scope_issues'));
    });

    it('should include /commit-merge-push instruction', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 1, ['/tmp/in.md'], 0, []);
      assert(result.includes('/commit-merge-push'));
    });

    it('should format review type in lowercase', () => {
      const prResult = generateScopeSeparatedFixInstructions(123, 'PR', 3, ['/tmp/in.md'], 0, []);
      const secResult = generateScopeSeparatedFixInstructions(
        456,
        'Security',
        2,
        ['/tmp/in.md'],
        0,
        []
      );
      assert(prResult.includes('pr review'));
      assert(secResult.includes('security review'));
    });

    it('should include EnterPlanMode reference for Agent 1', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 1, ['/tmp/in.md'], 0, []);
      assert(result.includes('EnterPlanMode'));
      assert(result.includes('ExitPlanMode'));
    });

    it('should include test validation step for Agent 1', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 1, ['/tmp/in.md'], 0, []);
      assert(result.includes('Run tests to validate fixes'));
      assert(result.includes('make test'));
    });
  });

  describe('review type handling', () => {
    it('should handle PR review type', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 5, ['/tmp/in.md'], 0, []);
      assert(typeof result === 'string');
      assert(result.length > 0);
    });

    it('should handle Security review type', () => {
      const result = generateScopeSeparatedFixInstructions(
        456,
        'Security',
        3,
        ['/tmp/in.md'],
        0,
        []
      );
      assert(typeof result === 'string');
      assert(result.length > 0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty in-scope files array with non-zero count', () => {
      // Edge case: count says there are issues, but no files provided
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 5, [], 0, []);
      assert(typeof result === 'string');
      assert(result.includes('5 in-scope'));
    });

    it('should handle multiple in-scope files correctly', () => {
      const files = [
        '/tmp/claude/code-reviewer-in-scope-1.md',
        '/tmp/claude/silent-failure-hunter-in-scope-2.md',
        '/tmp/claude/comment-analyzer-in-scope-3.md',
      ];
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 10, files, 0, []);
      // All files should be listed
      files.forEach((file) => {
        assert(result.includes(file), `Missing file: ${file}`);
      });
    });

    it('should handle large issue counts', () => {
      const result = generateScopeSeparatedFixInstructions(
        999,
        'Security',
        1000,
        ['/tmp/in.md'],
        500,
        ['/tmp/out.md']
      );
      assert(result.includes('1000 in-scope'));
      assert(result.includes('500 out-of-scope'));
    });

    it('should handle single in-scope issue with no out-of-scope', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 1, ['/tmp/in.md'], 0, []);
      assert(result.includes('1 in-scope'));
      assert(!result.includes('Agent 2'));
    });

    it('should handle zero in-scope but non-zero out-of-scope gracefully', () => {
      // This is an edge case - normally if in-scope is 0, this function wouldn't be called
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 0, [], 5, ['/tmp/out.md']);
      assert(typeof result === 'string');
    });

    it('should include issue number in Agent 1 prompt', () => {
      const result = generateScopeSeparatedFixInstructions(456, 'PR', 3, ['/tmp/in.md'], 0, []);
      // Issue number should appear in Agent 1's instructions
      assert(result.includes('#456') || result.includes('issue #456'));
    });
  });

  describe('step sequence and context clear warning', () => {
    it('should have correct step sequence with renumbered steps', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 1, ['/tmp/in.md'], 0, []);

      const expectedSteps = [
        { number: 1, title: 'Get Issue References' },
        { number: 2, title: 'Enter Plan Mode' },
        { number: 3, title: 'Execute Plan (After Context Clear)' },
        { number: 4, title: 'Create TODO List' },
        { number: 5, title: 'Launch Agents' },
      ];

      const stepIndices: number[] = [];

      for (const step of expectedSteps) {
        const headerPattern = new RegExp(`^\\*\\*Step ${step.number}:`, 'm');
        const expectedTitle = `**Step ${step.number}: ${step.title}**`;

        assert(result.match(headerPattern), `Missing Step ${step.number} header`);
        assert(result.includes(expectedTitle), `Missing Step ${step.number} title`);

        const index = result.indexOf(`**Step ${step.number}:`);
        assert(index !== -1, `Step ${step.number} not found`);
        stepIndices.push(index);
      }

      for (let i = 1; i < stepIndices.length; i++) {
        assert(stepIndices[i - 1] < stepIndices[i], `Step ${i} should come before Step ${i + 1}`);
      }
    });

    // TODO(#2028): Add behavioral tests for context clearing
    it('should have context clear warning in Step 3', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 1, ['/tmp/in.md'], 0, []);

      const step3Index = result.indexOf('**Step 3:');
      const step4Index = result.indexOf('**Step 4:');
      const warningIndex = result.indexOf('CRITICAL: After exiting plan mode, context will be cleared');
      const listIssuesIndex = result.indexOf('Call `wiggum_list_issues({ scope: \'all\' })` again');

      assert(warningIndex !== -1, 'Missing context clear warning');
      assert(listIssuesIndex !== -1, 'Missing wiggum_list_issues instruction');
      assert(warningIndex > step3Index, 'Warning should appear after Step 3 header');
      assert(warningIndex < step4Index, 'Warning should appear before Step 4 header');
      assert(listIssuesIndex > warningIndex, 'wiggum_list_issues instruction should follow warning');
    });

    it('should have only one context clear warning (no redundancy)', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 1, ['/tmp/in.md'], 0, []);

      const warningText = 'CRITICAL: After exiting plan mode, context will be cleared';
      const listIssuesText = 'Call `wiggum_list_issues({ scope: \'all\' })` again';

      assert(result.indexOf(warningText) !== -1, 'Warning text not found');
      assert.strictEqual(
        result.indexOf(warningText),
        result.lastIndexOf(warningText),
        'Warning should appear exactly once'
      );
      assert(result.indexOf(listIssuesText) !== -1, 'List issues instruction not found');
      assert.strictEqual(
        result.indexOf(listIssuesText),
        result.lastIndexOf(listIssuesText),
        'List issues instruction should appear exactly once'
      );
    });

    it('should include plan file path template with timestamp placeholder', () => {
      const result = generateScopeSeparatedFixInstructions(123, 'PR', 1, ['/tmp/in.md'], 0, []);
      assert(
        result.includes('tmp/wiggum/plan-'),
        'Missing plan file path template with tmp/wiggum/plan- prefix'
      );
      assert(
        result.includes('{timestamp}'),
        'Missing {timestamp} placeholder in plan file path'
      );
      assert(
        result.includes('.md'),
        'Plan file path should include .md extension'
      );
    });
  });
});

// TODO(#2027): Missing cross-workflow consistency tests
