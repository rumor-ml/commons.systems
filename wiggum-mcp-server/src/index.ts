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
import { completeAllHands, CompleteAllHandsInputSchema } from './tools/complete-all-hands.js';
import {
  completeSecurityReview,
  CompleteSecurityReviewInputSchema,
} from './tools/complete-security-review.js';
import { completeFix, CompleteFixInputSchema } from './tools/complete-fix.js';
import { recordReviewIssue, RecordReviewIssueInputSchema } from './tools/record-review-issue.js';
import { readManifests, ReadManifestsInputSchema } from './tools/read-manifests.js';
import { listIssues, ListIssuesInputSchema } from './tools/list-issues.js';
import { getIssue, GetIssueInputSchema } from './tools/get-issue.js';

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
        name: 'wiggum_complete_all_hands',
        description:
          'Complete all-hands review after all agents finish (both review and implementation). Reads manifests internally, applies 2-strike agent completion logic, and returns next step instructions. If all agents complete with 0 high-priority in-scope issues, marks step complete and proceeds. Otherwise returns instructions to continue iteration.',
        inputSchema: {
          type: 'object',
          properties: {
            maxIterations: {
              type: 'number',
              description:
                'Optional custom iteration limit. Use when user approves increasing the limit beyond default.',
            },
          },
          required: [],
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
            in_scope_result_files: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Array of in-scope result file paths from security review agents (each file may contain multiple issues)',
            },
            out_of_scope_result_files: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Array of out-of-scope result file paths from security review agents (each file may contain multiple issues)',
            },
            in_scope_issue_count: {
              type: 'number',
              description:
                'Total count of in-scope security issues found across all agents (not file count)',
            },
            out_of_scope_issue_count: {
              type: 'number',
              description:
                'Total count of out-of-scope security recommendations across all agents (not file count)',
            },
            maxIterations: {
              type: 'number',
              description:
                'Optional custom iteration limit. Use when user approves increasing the limit beyond default.',
            },
          },
          required: [
            'command_executed',
            'in_scope_result_files',
            'out_of_scope_result_files',
            'in_scope_issue_count',
            'out_of_scope_issue_count',
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
      {
        name: 'wiggum_record_review_issue',
        description:
          'Record a single review issue to the manifest file system and post as GitHub comment. Each issue is appended to a manifest file based on agent name, scope, and timestamp. Posts to PR (phase2) or issue (phase1).',
        inputSchema: {
          type: 'object',
          properties: {
            agent_name: {
              type: 'string',
              description: 'Name of the review agent that found this issue',
            },
            scope: {
              type: 'string',
              enum: ['in-scope', 'out-of-scope'],
              description: 'Whether this issue is in-scope or out-of-scope for the current work',
            },
            priority: {
              type: 'string',
              enum: ['high', 'low'],
              description: 'Priority level of the issue (high or low only)',
            },
            title: {
              type: 'string',
              description: 'Brief title summarizing the issue',
            },
            description: {
              type: 'string',
              description: 'Detailed description of the issue',
            },
            location: {
              type: 'string',
              description: 'Optional file path or location where the issue was found',
            },
            existing_todo: {
              type: 'object',
              description:
                'Optional existing TODO tracking information for out-of-scope issues. Used to avoid duplicate GitHub comments.',
              properties: {
                has_todo: {
                  type: 'boolean',
                  description: 'Whether a TODO comment exists at the issue location',
                },
                issue_reference: {
                  type: 'string',
                  description: 'Issue number reference from TODO (e.g., "#123")',
                },
              },
              required: ['has_todo'],
            },
            metadata: {
              type: 'object',
              description: 'Optional metadata object with additional context',
            },
          },
          required: ['agent_name', 'scope', 'priority', 'title', 'description'],
        },
      },
      {
        name: 'wiggum_read_manifests',
        description:
          'Read and aggregate review issue manifest files based on scope filter. Returns aggregated manifest data with summary statistics including total issues, priority counts, and issues grouped by agent.',
        inputSchema: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              enum: ['in-scope', 'out-of-scope', 'all'],
              description: 'Filter manifests by scope: in-scope, out-of-scope, or all',
            },
          },
          required: ['scope'],
        },
      },
      {
        name: 'wiggum_list_issues',
        description:
          'List all review issues as minimal references (ID, title, agent, scope, priority) without full details. Use this in the main thread to get issue IDs, then pass IDs to subagents who call wiggum_get_issue to get full details. Prevents token waste in main thread.',
        inputSchema: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              enum: ['in-scope', 'out-of-scope', 'all'],
              description: 'Filter issues by scope (defaults to "all")',
            },
          },
          required: [],
        },
      },
      {
        name: 'wiggum_get_issue',
        description:
          'Get full details for a single issue by ID. Used by subagents to retrieve complete issue information including description, location, existing_todo, and metadata. ID format: {agent-name}-{scope}-{index} (e.g., "code-reviewer-in-scope-0")',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Issue ID from wiggum_list_issues (e.g., "code-reviewer-in-scope-0")',
            },
          },
          required: ['id'],
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

      case 'wiggum_complete_all_hands': {
        const validated = CompleteAllHandsInputSchema.parse(args);
        return await completeAllHands(validated);
      }

      case 'wiggum_complete_security_review': {
        const validated = CompleteSecurityReviewInputSchema.parse(args);
        return await completeSecurityReview(validated);
      }

      case 'wiggum_complete_fix': {
        const validated = CompleteFixInputSchema.parse(args);
        return await completeFix(validated);
      }

      case 'wiggum_record_review_issue': {
        const validated = RecordReviewIssueInputSchema.parse(args);
        return await recordReviewIssue(validated);
      }

      case 'wiggum_read_manifests': {
        const validated = ReadManifestsInputSchema.parse(args);
        return await readManifests(validated);
      }

      case 'wiggum_list_issues': {
        const validated = ListIssuesInputSchema.parse(args);
        return await listIssues(validated);
      }

      case 'wiggum_get_issue': {
        const validated = GetIssueInputSchema.parse(args);
        return await getIssue(validated);
      }

      default:
        throw new Error(
          `Unknown tool: ${name}. Available tools: wiggum_init, wiggum_complete_pr_creation, wiggum_complete_all_hands, wiggum_complete_security_review, wiggum_complete_fix, wiggum_record_review_issue, wiggum_read_manifests, wiggum_list_issues, wiggum_get_issue`
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
