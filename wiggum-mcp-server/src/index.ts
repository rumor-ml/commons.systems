#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';

import { nextStep, NextStepInputSchema } from './tools/next-step.js';
import { completePRReview, CompletePRReviewInputSchema } from './tools/complete-pr-review.js';
import {
  completeSecurityReview,
  CompleteSecurityReviewInputSchema,
} from './tools/complete-security-review.js';
import { completeFix, CompleteFixInputSchema } from './tools/complete-fix.js';

import { createErrorResult } from './utils/errors.js';
import { MAX_ITERATIONS } from './constants.js';

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
        name: 'wiggum_next_step',
        description:
          'Primary orchestration tool for wiggum PR automation flow. Analyzes current state (git, PR, and wiggum state from PR comments) and returns instructions for the next action. No inputs required - all state is detected automatically.',
        inputSchema: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository in format "owner/repo" (defaults to current repository)',
            },
          },
          required: [],
        },
      },
      {
        name: 'wiggum_complete_pr_review',
        description:
          'Complete PR review step after executing /pr-review-toolkit:review-pr. Validates command execution, posts structured PR comment with review results, and returns next step instructions. If issues found, increments iteration and returns Plan+Fix instructions. If no issues, marks step complete and proceeds.',
        inputSchema: {
          type: 'object',
          properties: {
            command_executed: {
              type: 'boolean',
              description:
                'Confirm /pr-review-toolkit:review-pr was actually executed (must be true)',
            },
            verbatim_response: {
              type: 'string',
              description: 'Complete verbatim response from review command',
            },
            high_priority_issues: {
              type: 'number',
              description: 'Count of high priority issues found',
            },
            medium_priority_issues: {
              type: 'number',
              description: 'Count of medium priority issues found',
            },
            low_priority_issues: {
              type: 'number',
              description: 'Count of low priority issues found',
            },
            repo: {
              type: 'string',
              description: 'Repository in format "owner/repo" (defaults to current repository)',
            },
          },
          required: [
            'command_executed',
            'verbatim_response',
            'high_priority_issues',
            'medium_priority_issues',
            'low_priority_issues',
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
            verbatim_response: {
              type: 'string',
              description: 'Complete verbatim response from security review command',
            },
            high_priority_issues: {
              type: 'number',
              description: 'Count of high priority security issues found',
            },
            medium_priority_issues: {
              type: 'number',
              description: 'Count of medium priority security issues found',
            },
            low_priority_issues: {
              type: 'number',
              description: 'Count of low priority security issues found',
            },
            repo: {
              type: 'string',
              description: 'Repository in format "owner/repo" (defaults to current repository)',
            },
          },
          required: [
            'command_executed',
            'verbatim_response',
            'high_priority_issues',
            'medium_priority_issues',
            'low_priority_issues',
          ],
        },
      },
      {
        name: 'wiggum_complete_fix',
        description: `Complete a Plan+Fix cycle. Posts PR comment documenting the fix and returns instructions to restart workflow monitoring (Step 1). Used after fixing any issues found during workflow monitoring, PR checks, code quality review, PR review, or security review. Maximum ${MAX_ITERATIONS} iterations allowed.`,
        inputSchema: {
          type: 'object',
          properties: {
            fix_description: {
              type: 'string',
              description: 'Brief description of what was fixed',
            },
            repo: {
              type: 'string',
              description: 'Repository in format "owner/repo" (defaults to current repository)',
            },
          },
          required: ['fix_description'],
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
      case 'wiggum_next_step': {
        const validated = NextStepInputSchema.parse(args);
        return await nextStep(validated);
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
        throw new Error(`Unknown tool: ${name}`);
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
