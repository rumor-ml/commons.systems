#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { wiggumInit, WiggumInitInputSchema } from './tools/init.js';
import { completePRCreation, CompletePRCreationInputSchema } from './tools/complete-pr-creation.js';
import { completePRReview, CompletePRReviewInputSchema } from './tools/complete-pr-review.js';
import {
  completeSecurityReview,
  CompleteSecurityReviewInputSchema,
} from './tools/complete-security-review.js';
import { completeFix, CompleteFixInputSchema } from './tools/complete-fix.js';

import { createErrorResult } from './utils/errors.js';
import { DEFAULT_MAX_ITERATIONS } from './constants.js';

const server = new Server(
  {
    name: 'wiggum-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'wiggum_init',
        description:
          'Start wiggum workflow. Analyzes current state and determines first action needed.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'wiggum_complete_pr_creation',
        description:
          'Create PR with codified process. Extracts issue from branch, gets commits, creates PR with correct format, marks step complete.',
        inputSchema: {
          type: 'object',
          properties: {
            pr_description: {
              type: 'string',
              description:
                "Agent's description of PR contents - must cover ALL commits on the branch (git log main..HEAD), not just recent changes",
            },
          },
          required: ['pr_description'],
        },
      },
      {
        name: 'wiggum_complete_pr_review',
        description:
          'Complete PR review step after executing the phase-appropriate review command (Phase 1: /all-hands-review, Phase 2: /review). Validates command execution, posts structured PR comment with review results, and returns next step instructions. If issues found, increments iteration and returns Plan+Fix instructions. If no issues, marks step complete and proceeds.',
        inputSchema: {
          type: 'object',
          properties: {
            command_executed: {
              type: 'boolean',
              description: 'Confirm PR review command was actually executed (must be true)',
            },
            in_scope_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of in-scope result file paths from review agents',
            },
            out_of_scope_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of out-of-scope result file paths from review agents',
            },
            in_scope_count: {
              type: 'number',
              description: 'Total count of in-scope issues found across all agents',
            },
            out_of_scope_count: {
              type: 'number',
              description: 'Total count of out-of-scope recommendations across all agents',
            },
            maxIterations: {
              type: 'number',
              description:
                'Optional custom iteration limit. Use when user approves increasing the limit beyond default.',
            },
          },
          required: [
            'command_executed',
            'in_scope_files',
            'out_of_scope_files',
            'in_scope_count',
            'out_of_scope_count',
          ],
        },
      },
      {
        name: 'wiggum_complete_security_review',
        description:
          'Complete security review step after executing /security-review. Validates command execution, posts structured PR comment with security review results, and returns next step instructions. If issues found, increments iteration and returns Plan+Fix instructions. If no issues, marks step complete and proceeds.',
        inputSchema: {
          type: 'object',
          properties: {
            command_executed: {
              type: 'boolean',
              description: 'Confirm /security-review was actually executed (must be true)',
            },
            in_scope_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of in-scope result file paths from security review agents',
            },
            out_of_scope_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of out-of-scope result file paths from security review agents',
            },
            in_scope_count: {
              type: 'number',
              description: 'Total count of in-scope security issues found across all agents',
            },
            out_of_scope_count: {
              type: 'number',
              description: 'Total count of out-of-scope security recommendations across all agents',
            },
            maxIterations: {
              type: 'number',
              description:
                'Optional custom iteration limit. Use when user approves increasing the limit beyond default.',
            },
          },
          required: [
            'command_executed',
            'in_scope_files',
            'out_of_scope_files',
            'in_scope_count',
            'out_of_scope_count',
          ],
        },
      },
      {
        name: 'wiggum_complete_fix',
        description: `Complete a Plan+Fix cycle. Posts PR comment documenting the fix and returns instructions to restart workflow monitoring (Step 1). Used after fixing any issues found during workflow monitoring, PR checks, code quality review, PR review, or security review. Maximum ${DEFAULT_MAX_ITERATIONS} iterations allowed.`,
        inputSchema: {
          type: 'object',
          properties: {
            fix_description: {
              type: 'string',
              description: 'Brief description of what was fixed',
            },
            has_in_scope_fixes: {
              type: 'boolean',
              description:
                'Whether any in-scope fixes were made. If false, skips state update and comment posting.',
            },
            out_of_scope_issues: {
              type: 'array',
              items: { type: 'number' },
              description:
                'List of issue numbers for out-of-scope recommendations (both new and existing)',
            },
            maxIterations: {
              type: 'number',
              description:
                'Optional custom iteration limit. Use when user approves increasing the limit beyond default.',
            },
          },
          required: ['fix_description', 'has_in_scope_fixes'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'wiggum_init': {
        const validated = WiggumInitInputSchema.parse(args);
        return await wiggumInit(validated);
      }

      case 'wiggum_complete_pr_creation': {
        const validated = CompletePRCreationInputSchema.parse(args);
        return await completePRCreation(validated);
      }

      case 'wiggum_complete_pr_review': {
        const validated = CompletePRReviewInputSchema.parse(args);
        return await completePRReview(validated);
      }

      case 'wiggum_complete_security_review': {
        const validated = CompleteSecurityReviewInputSchema.parse(args);
        return await completeSecurityReview(validated);
      }

      case 'wiggum_complete_fix': {
        const validated = CompleteFixInputSchema.parse(args);
        return await completeFix(validated);
      }

      default:
        throw new Error(
          `Unknown tool: ${name}. Available tools: wiggum_init, wiggum_complete_pr_creation, wiggum_complete_pr_review, wiggum_complete_security_review, wiggum_complete_fix`
        );
    }
  } catch (error) {
    return createErrorResult(error);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Wiggum MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
