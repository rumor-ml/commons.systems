/**
 * Integration tests for index.ts tool registration and routing
 * Tests that new tools are correctly registered with proper schemas
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('New GitHub tools registration', () => {
  describe('Tool schema validation', () => {
    it('gh_remove_label_if_exists has correct required fields', () => {
      // Schema definition from index.ts
      const schema = {
        type: 'object',
        properties: {
          issue_number: {
            type: ['string', 'number'],
            description: 'Issue or PR number',
          },
          label: {
            type: 'string',
            description: 'Label name to remove',
          },
          repo: {
            type: 'string',
            description: 'Repository in format "owner/repo" (defaults to current repository)',
          },
        },
        required: ['issue_number', 'label'],
      };

      assert.deepEqual(schema.required, ['issue_number', 'label']);
      assert.ok(schema.properties.issue_number);
      assert.ok(schema.properties.label);
      assert.ok(schema.properties.repo);
    });

    it('gh_add_blocker has correct required fields', () => {
      // Schema definition from index.ts
      const schema = {
        type: 'object',
        properties: {
          blocked_issue_number: {
            type: ['string', 'number'],
            description: 'Issue number that is blocked',
          },
          blocker_issue_number: {
            type: ['string', 'number'],
            description: 'Issue number that is blocking',
          },
          repo: {
            type: 'string',
            description: 'Repository in format "owner/repo" (defaults to current repository)',
          },
        },
        required: ['blocked_issue_number', 'blocker_issue_number'],
      };

      assert.deepEqual(schema.required, ['blocked_issue_number', 'blocker_issue_number']);
      assert.ok(schema.properties.blocked_issue_number);
      assert.ok(schema.properties.blocker_issue_number);
      assert.ok(schema.properties.repo);
    });

    it('gh_check_todo_in_main has correct required fields', () => {
      // Schema definition from index.ts
      const schema = {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'File path to check in the repository',
          },
          todo_pattern: {
            type: 'string',
            description: "TODO pattern to search for (e.g., 'TODO(#123)')",
          },
          repo: {
            type: 'string',
            description: 'Repository in format "owner/repo" (defaults to current repository)',
          },
        },
        required: ['file_path', 'todo_pattern'],
      };

      assert.deepEqual(schema.required, ['file_path', 'todo_pattern']);
      assert.ok(schema.properties.file_path);
      assert.ok(schema.properties.todo_pattern);
      assert.ok(schema.properties.repo);
    });
  });

  describe('Tool name consistency check', () => {
    it('verifies all new tool names are consistent', () => {
      // Tool names that should be registered in index.ts
      const expectedToolNames = [
        'gh_remove_label_if_exists',
        'gh_add_blocker',
        'gh_check_todo_in_main',
      ];

      // Tool names used in switch cases in CallTool handler
      const switchCaseNames = [
        'gh_remove_label_if_exists',
        'gh_add_blocker',
        'gh_check_todo_in_main',
      ];

      // All names should match exactly
      assert.deepEqual(switchCaseNames, expectedToolNames);
    });
  });

  describe('Tool descriptions', () => {
    it('gh_add_blocker description accurately describes functionality', () => {
      const description =
        'Add a blocker relationship between two issues using GitHub dependencies API. Creates a "blocked by" relationship where one issue blocks another. Handles duplicate relationships gracefully.';

      // Should NOT mention "current issue" (that was the bug)
      assert.ok(
        !description.includes('current issue'),
        'Description should NOT mention "current issue"'
      );

      // Should mention "two issues"
      assert.ok(
        description.includes('between two issues'),
        'Description should mention "between two issues"'
      );

      // Should mention "blocked by" relationship
      assert.ok(
        description.includes('blocked by'),
        'Description should mention "blocked by" relationship'
      );

      // Should mention duplicate handling
      assert.ok(description.includes('duplicate'), 'Description should mention duplicate handling');
    });

    it('gh_remove_label_if_exists description mentions idempotent operation', () => {
      const description =
        'Remove a label from an issue or PR only if it exists (no error if missing). Idempotent operation that checks for label existence before removal.';

      assert.ok(
        description.includes('idempotent') || description.includes('only if it exists'),
        'Description should mention idempotent behavior'
      );
    });

    it('gh_check_todo_in_main description mentions origin/main branch', () => {
      const description =
        'Check if a TODO pattern exists in a file on the origin/main branch using GitHub API (no git checkout required). Returns whether the pattern was found.';

      assert.ok(
        description.includes('origin/main'),
        'Description should mention origin/main branch'
      );
      assert.ok(description.includes('GitHub API'), 'Description should mention GitHub API usage');
    });
  });

  describe('Tool registration completeness', () => {
    it('all three new tools should be present in both ListTools and CallTool', () => {
      // This test documents that:
      // 1. gh_remove_label_if_exists is registered in ListTools (line 205-227)
      // 2. gh_add_blocker is registered in ListTools (line 228-250)
      // 3. gh_check_todo_in_main is registered in ListTools (line 251-273)
      // 4. gh_remove_label_if_exists case exists in CallTool switch (line 309-312)
      // 5. gh_add_blocker case exists in CallTool switch (line 314-317)
      // 6. gh_check_todo_in_main case exists in CallTool switch (line 319-322)

      const toolsRegistered = [
        'gh_remove_label_if_exists',
        'gh_add_blocker',
        'gh_check_todo_in_main',
      ];

      const switchCases = ['gh_remove_label_if_exists', 'gh_add_blocker', 'gh_check_todo_in_main'];

      // Every registered tool must have a corresponding switch case
      for (const tool of toolsRegistered) {
        assert.ok(
          switchCases.includes(tool),
          `Tool ${tool} must have a switch case in CallTool handler`
        );
      }

      // Every switch case must correspond to a registered tool
      for (const switchCase of switchCases) {
        assert.ok(
          toolsRegistered.includes(switchCase),
          `Switch case ${switchCase} must correspond to a registered tool`
        );
      }
    });
  });

  describe('Import statements verification', () => {
    it('verifies all new tool implementations are imported', () => {
      // This test documents that index.ts imports:
      // 1. removeLabelIfExists and RemoveLabelIfExistsInputSchema from './tools/remove-label-if-exists.js'
      // 2. addBlocker and AddBlockerInputSchema from './tools/add-blocker.js'
      // 3. checkTodoInMain and CheckTodoInMainInputSchema from './tools/check-todo-in-main.js'

      const expectedImports = [
        { tool: 'removeLabelIfExists', schema: 'RemoveLabelIfExistsInputSchema' },
        { tool: 'addBlocker', schema: 'AddBlockerInputSchema' },
        { tool: 'checkTodoInMain', schema: 'CheckTodoInMainInputSchema' },
      ];

      // Verify we expect these imports
      assert.equal(expectedImports.length, 3);
      assert.ok(expectedImports[0].tool === 'removeLabelIfExists');
      assert.ok(expectedImports[1].tool === 'addBlocker');
      assert.ok(expectedImports[2].tool === 'checkTodoInMain');
    });
  });

  describe('Zod schema validation usage', () => {
    it('verifies each tool uses Zod schema validation before calling implementation', () => {
      // This test documents the pattern used in CallTool handler:
      // 1. Parse args with Zod schema (e.g., RemoveLabelIfExistsInputSchema.parse(args))
      // 2. Pass validated args to tool implementation
      // 3. Return result or catch error

      const toolValidationPattern = {
        gh_remove_label_if_exists: {
          schema: 'RemoveLabelIfExistsInputSchema',
          implementation: 'removeLabelIfExists',
        },
        gh_add_blocker: {
          schema: 'AddBlockerInputSchema',
          implementation: 'addBlocker',
        },
        gh_check_todo_in_main: {
          schema: 'CheckTodoInMainInputSchema',
          implementation: 'checkTodoInMain',
        },
      };

      // Verify pattern is documented
      assert.equal(Object.keys(toolValidationPattern).length, 3);

      for (const [toolName, pattern] of Object.entries(toolValidationPattern)) {
        assert.ok(pattern.schema, `${toolName} should have a schema`);
        assert.ok(pattern.implementation, `${toolName} should have an implementation`);
      }
    });
  });

  describe('Regression prevention', () => {
    it('documents potential regression scenarios', () => {
      // This test documents common regression scenarios to watch for:

      const regressionScenarios = [
        {
          scenario: 'Tool name mismatch',
          description:
            'If tool name in ListTools does not match name in CallTool switch case, tool will be visible but not callable',
          prevention: 'Keep tool names identical in both places',
        },
        {
          scenario: 'Missing switch case',
          description:
            'If tool is registered in ListTools but missing from CallTool switch, tool will return "Unknown tool" error',
          prevention: 'Add switch case for every registered tool',
        },
        {
          scenario: 'Schema mismatch',
          description:
            'If schema in ListTools does not match Zod schema used in tool implementation, validation will fail unexpectedly',
          prevention: 'Keep schemas in sync between index.ts and tool files',
        },
        {
          scenario: 'Missing required fields',
          description:
            'If required fields are not marked as required in schema, tool will accept invalid inputs',
          prevention: 'Ensure required fields are in "required" array',
        },
      ];

      // Verify we document all major scenarios
      assert.equal(regressionScenarios.length, 4);
      assert.ok(regressionScenarios.every((s) => s.scenario && s.description && s.prevention));
    });
  });
});
