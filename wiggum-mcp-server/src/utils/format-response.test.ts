/**
 * Tests for response formatting utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatWiggumResponse } from './format-response.js';
import { FormattingError } from './errors.js';

describe('formatWiggumResponse', () => {
  describe('Valid Input', () => {
    it('should format complete response with all fields', () => {
      const input = {
        current_step: 'PR Review',
        step_number: '3',
        iteration_count: 1,
        instructions: 'Execute /pr-review-toolkit:review-pr',
        steps_completed_by_tool: ['Created PR', 'Monitored checks'],
        context: {
          pr_number: 252,
          current_branch: 'feature-branch',
        },
      };

      const result = formatWiggumResponse(input);

      // Verify header
      assert.match(result, /## PR Review \(Step 3\)/);
      assert.match(result, /\*\*Iteration:\*\* 1/);

      // Verify instructions section
      assert.match(result, /### BINDING INSTRUCTIONS - EXECUTE IMMEDIATELY/);
      assert.match(result, /Execute \/pr-review-toolkit:review-pr/);

      // Verify checklist
      assert.match(result, /\*\*Workflow Continuation Checklist:\*\*/);

      // Verify steps completed
      assert.match(result, /### Steps Completed by Tool/);
      assert.match(result, /- Created PR/);
      assert.match(result, /- Monitored checks/);

      // Verify context
      assert.match(result, /### Context/);
      assert.match(result, /- \*\*Pr Number:\*\* 252/);
      assert.match(result, /- \*\*Current Branch:\*\* feature-branch/);
    });

    it('should format response with empty steps_completed_by_tool', () => {
      const input = {
        current_step: 'Start',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Begin workflow',
        steps_completed_by_tool: [],
        context: { pr_number: 100 },
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /### Steps Completed by Tool\n_\(none\)_/);
    });

    it('should format response with minimal context', () => {
      const input = {
        current_step: 'Init',
        step_number: '0',
        iteration_count: 1,
        instructions: 'Initialize',
        steps_completed_by_tool: [],
        context: {},
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /### Context\n$/m); // Context section exists but is empty
    });

    it('should handle multiline instructions', () => {
      const input = {
        current_step: 'Complex Step',
        step_number: '2',
        iteration_count: 1,
        instructions: 'Step 1: Do this\nStep 2: Do that\nStep 3: Complete',
        steps_completed_by_tool: [],
        context: {},
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /Step 1: Do this\nStep 2: Do that\nStep 3: Complete/);
    });
  });

  describe('Context Value Formatting', () => {
    it('should format string values', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: { branch_name: 'main' },
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /- \*\*Branch Name:\*\* main/);
    });

    it('should format number values', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: { pr_number: 42, iteration: 0 },
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /- \*\*Pr Number:\*\* 42/);
      assert.match(result, /- \*\*Iteration:\*\* 0/);
    });

    it('should format boolean values', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: { is_draft: true, auto_merge: false },
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /- \*\*Is Draft:\*\* true/);
      assert.match(result, /- \*\*Auto Merge:\*\* false/);
    });

    it('should format null and undefined values', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: { null_field: null, undefined_field: undefined },
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /- \*\*Null Field:\*\* _\(none\)_/);
      assert.match(result, /- \*\*Undefined Field:\*\* _\(none\)_/);
    });

    it('should format string arrays', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: { tags: ['bug', 'urgent', 'frontend'] },
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /- \*\*Tags:\*\* bug, urgent, frontend/);
    });

    it('should format number arrays', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: { related_prs: [100, 101, 102] },
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /- \*\*Related Prs:\*\* 100, 101, 102/);
    });

    it('should format empty arrays', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: { labels: [] },
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /- \*\*Labels:\*\* _\(empty\)_/);
    });

    it('should convert snake_case to Title Case', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: { very_long_field_name: 'value' },
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /- \*\*Very Long Field Name:\*\* value/);
    });
  });

  describe('Input Validation', () => {
    it('should throw FormattingError for null input', () => {
      assert.throws(
        () => formatWiggumResponse(null),
        (error: Error) => {
          assert(error instanceof FormattingError);
          assert.strictEqual(error.message, 'Response data must be an object');
          return true;
        }
      );
    });

    it('should throw FormattingError for undefined input', () => {
      assert.throws(
        () => formatWiggumResponse(undefined),
        (error: Error) => {
          assert(error instanceof FormattingError);
          assert.strictEqual(error.message, 'Response data must be an object');
          return true;
        }
      );
    });

    it('should throw FormattingError for non-object input', () => {
      assert.throws(
        () => formatWiggumResponse('string'),
        (error: Error) => {
          assert(error instanceof FormattingError);
          assert.strictEqual(error.message, 'Response data must be an object');
          return true;
        }
      );

      assert.throws(() => formatWiggumResponse(123), FormattingError);

      assert.throws(() => formatWiggumResponse(true), FormattingError);
    });

    it('should throw FormattingError for missing current_step', () => {
      const input = {
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: {},
      };

      assert.throws(
        () => formatWiggumResponse(input),
        (error: Error) => {
          assert(error instanceof FormattingError);
          assert.match(error.message, /Missing or invalid current_step/);
          return true;
        }
      );
    });

    it('should throw FormattingError for non-string current_step', () => {
      const input = {
        current_step: 123,
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: {},
      };

      assert.throws(
        () => formatWiggumResponse(input),
        (error: Error) => {
          assert(error instanceof FormattingError);
          assert.match(
            error.message,
            /Missing or invalid current_step.*expected string, got number/
          );
          return true;
        }
      );
    });

    it('should throw FormattingError for missing step_number', () => {
      const input = {
        current_step: 'Test',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: {},
      };

      assert.throws(
        () => formatWiggumResponse(input),
        (error: Error) => {
          assert(error instanceof FormattingError);
          assert.match(error.message, /Missing or invalid step_number/);
          return true;
        }
      );
    });

    it('should throw FormattingError for missing instructions', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        steps_completed_by_tool: [],
        context: {},
      };

      assert.throws(
        () => formatWiggumResponse(input),
        (error: Error) => {
          assert(error instanceof FormattingError);
          assert.match(error.message, /Missing or invalid instructions/);
          return true;
        }
      );
    });

    it('should throw FormattingError for non-number iteration_count', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: '1',
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: {},
      };

      assert.throws(
        () => formatWiggumResponse(input),
        (error: Error) => {
          assert(error instanceof FormattingError);
          assert.match(error.message, /Invalid iteration_count.*expected number, got string/);
          return true;
        }
      );
    });

    it('should throw FormattingError for missing steps_completed_by_tool', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        context: {},
      };

      assert.throws(
        () => formatWiggumResponse(input),
        (error: Error) => {
          assert(error instanceof FormattingError);
          assert.match(error.message, /Invalid steps_completed_by_tool.*expected array/);
          return true;
        }
      );
    });

    it('should throw FormattingError for non-array steps_completed_by_tool', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: 'not an array',
        context: {},
      };

      assert.throws(
        () => formatWiggumResponse(input),
        (error: Error) => {
          assert(error instanceof FormattingError);
          assert.match(
            error.message,
            /Invalid steps_completed_by_tool.*expected array, got string/
          );
          return true;
        }
      );
    });

    it('should throw FormattingError for steps_completed_by_tool with non-string items', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: ['valid', 123, 'also valid'],
        context: {},
      };

      assert.throws(
        () => formatWiggumResponse(input),
        (error: Error) => {
          assert(error instanceof FormattingError);
          assert.match(error.message, /All items in steps_completed_by_tool must be strings/);
          return true;
        }
      );
    });

    it('should throw FormattingError for missing context', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
      };

      assert.throws(
        () => formatWiggumResponse(input),
        (error: Error) => {
          assert(error instanceof FormattingError);
          assert.match(error.message, /Invalid context.*expected object/);
          return true;
        }
      );
    });

    it('should throw FormattingError for non-object context', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: 'not an object',
      };

      assert.throws(
        () => formatWiggumResponse(input),
        (error: Error) => {
          assert(error instanceof FormattingError);
          assert.match(error.message, /Invalid context.*expected object, got string/);
          return true;
        }
      );
    });
  });

  describe('Context Field Handling', () => {
    it('should preserve context field order and include all fields', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: {
          pr_number: 252,
          current_branch: 'feature-branch',
          iteration: 2,
          base_branch: 'main',
        },
      };

      const result = formatWiggumResponse(input);

      // Verify all context fields are present
      assert.match(result, /- \*\*Pr Number:\*\* 252/);
      assert.match(result, /- \*\*Current Branch:\*\* feature-branch/);
      assert.match(result, /- \*\*Iteration:\*\* 2/);
      assert.match(result, /- \*\*Base Branch:\*\* main/);

      // Verify context section exists and is properly formatted
      const contextSection = result.split('### Context\n')[1];
      assert.ok(contextSection, 'Context section should exist');

      // Count context entries
      const contextLines = contextSection.split('\n').filter((line) => line.startsWith('- **'));
      assert.strictEqual(
        contextLines.length,
        4,
        'Should have exactly 4 context entries (all fields present)'
      );
    });

    it('should preserve context field insertion order', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: {
          zebra: 'last',
          alpha: 'first',
          middle: 'center',
        },
      };

      const result = formatWiggumResponse(input);

      // Extract context lines to verify order
      const contextSection = result.split('### Context\n')[1];
      const contextLines = contextSection.split('\n').filter((line) => line.startsWith('- **'));

      // Verify order matches insertion order (Object.entries preserves insertion order in modern JS)
      assert.match(contextLines[0], /\*\*Zebra:\*\*/);
      assert.match(contextLines[1], /\*\*Alpha:\*\*/);
      assert.match(contextLines[2], /\*\*Middle:\*\*/);
    });

    it('should format arrays with negative numbers and decimals', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: {
          temperatures: [-10, -5.5, 0, 3.14, 100.99],
          coordinates: [-122.4194, 37.7749],
        },
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /- \*\*Temperatures:\*\* -10, -5.5, 0, 3.14, 100.99/);
      assert.match(result, /- \*\*Coordinates:\*\* -122.4194, 37.7749/);
    });

    it('should format single-element arrays', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: {
          single_tag: ['production'],
          single_number: [42],
        },
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /- \*\*Single Tag:\*\* production/);
      assert.match(result, /- \*\*Single Number:\*\* 42/);
    });

    it('should format context with mixed-type array values', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: {
          string_array: ['alpha', 'beta', 'gamma'],
          number_array: [1, 2, 3],
          empty_array: [],
          single_string: ['solo'],
          single_number: [99],
        },
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /- \*\*String Array:\*\* alpha, beta, gamma/);
      assert.match(result, /- \*\*Number Array:\*\* 1, 2, 3/);
      assert.match(result, /- \*\*Empty Array:\*\* _\(empty\)_/);
      assert.match(result, /- \*\*Single String:\*\* solo/);
      assert.match(result, /- \*\*Single Number:\*\* 99/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero iteration_count', () => {
      const input = {
        current_step: 'Start',
        step_number: '1',
        iteration_count: 0,
        instructions: 'Begin',
        steps_completed_by_tool: [],
        context: {},
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /\*\*Iteration:\*\* 0/);
    });

    it('should handle large iteration_count', () => {
      const input = {
        current_step: 'Retry',
        step_number: '5',
        iteration_count: 999,
        instructions: 'Keep trying',
        steps_completed_by_tool: [],
        context: {},
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /\*\*Iteration:\*\* 999/);
    });

    it('should handle special characters in step names', () => {
      const input = {
        current_step: 'Step w/ Special & Characters <test>',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: {},
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /## Step w\/ Special & Characters <test>/);
    });

    it('should handle special characters in instructions', () => {
      const input = {
        current_step: 'Test',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Run `command --flag="value"` with args',
        steps_completed_by_tool: [],
        context: {},
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /Run `command --flag="value"` with args/);
    });

    it('should handle complex context with mixed types', () => {
      const input = {
        current_step: 'Complex',
        step_number: '1',
        iteration_count: 1,
        instructions: 'Test',
        steps_completed_by_tool: [],
        context: {
          pr_number: 100,
          branch: 'main',
          is_draft: false,
          labels: ['bug', 'urgent'],
          assignees: [],
          review_count: 0,
          metadata: null,
        },
      };

      const result = formatWiggumResponse(input);
      assert.match(result, /- \*\*Pr Number:\*\* 100/);
      assert.match(result, /- \*\*Branch:\*\* main/);
      assert.match(result, /- \*\*Is Draft:\*\* false/);
      assert.match(result, /- \*\*Labels:\*\* bug, urgent/);
      assert.match(result, /- \*\*Assignees:\*\* _\(empty\)_/);
      assert.match(result, /- \*\*Review Count:\*\* 0/);
      assert.match(result, /- \*\*Metadata:\*\* _\(none\)_/);
    });
  });
});
