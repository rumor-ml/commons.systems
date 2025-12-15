#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { createErrorResult } from './utils/errors.js';
import {
  DEFAULT_TEST_TIMEOUT,
  MAX_TEST_TIMEOUT,
  DEFAULT_INFRA_TIMEOUT,
  MAX_INFRA_TIMEOUT,
} from './constants.js';
import { testRun, type TestRunArgs } from './tools/test-run.js';
import { testListModules } from './tools/test-list-modules.js';
import { testGetStatus, type TestGetStatusArgs } from './tools/test-get-status.js';
import { getPortAllocation, type GetPortAllocationArgs } from './tools/get-port-allocation.js';
import { emulatorStart, type EmulatorStartArgs } from './tools/emulator-start.js';
import { emulatorStop, type EmulatorStopArgs } from './tools/emulator-stop.js';
import { emulatorStatus, type EmulatorStatusArgs } from './tools/emulator-status.js';
import { devServerStart, type DevServerStartArgs } from './tools/dev-server-start.js';
import { devServerStop, type DevServerStopArgs } from './tools/dev-server-stop.js';
import { devServerStatus, type DevServerStatusArgs } from './tools/dev-server-status.js';
import { cleanupOrphans, type CleanupOrphansArgs } from './tools/cleanup-orphans.js';
import { cleanupWorktree, type CleanupWorktreeArgs } from './tools/cleanup-worktree.js';

const server = new Server(
  {
    name: 'test-mcp-server',
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
        name: 'test_run',
        description:
          'Execute tests for a specific module or all modules. Supports filtering by test name pattern and running in watch mode. Returns test results with pass/fail status and error details.',
        inputSchema: {
          type: 'object',
          properties: {
            module: {
              type: 'string',
              description:
                'Module name to test (e.g., "printsync", "financesync"). If not specified, runs all modules.',
            },
            pattern: {
              type: 'string',
              description: 'Test name pattern to filter tests (optional)',
            },
            watch: {
              type: 'boolean',
              description: 'Run tests in watch mode (default: false)',
              default: false,
            },
            timeout_seconds: {
              type: 'number',
              description: `Maximum time to wait in seconds (default: ${DEFAULT_TEST_TIMEOUT}, max: ${MAX_TEST_TIMEOUT})`,
              default: DEFAULT_TEST_TIMEOUT,
            },
          },
          required: [],
        },
      },
      {
        name: 'test_list_modules',
        description:
          'List all available test modules in the project. Returns module names, paths, and test file counts.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'test_get_status',
        description:
          'Get the current status of running tests. Returns information about which tests are currently executing, their progress, and recent results.',
        inputSchema: {
          type: 'object',
          properties: {
            module: {
              type: 'string',
              description:
                'Module name to get status for. If not specified, returns status for all modules.',
            },
          },
          required: [],
        },
      },
      {
        name: 'emulator_start',
        description:
          'Start Firebase emulators for local testing. Launches Auth, Firestore, Storage, and other configured emulators. Returns emulator URLs and port allocations.',
        inputSchema: {
          type: 'object',
          properties: {
            services: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Specific services to start (e.g., ["auth", "firestore"]). If not specified, starts all configured services.',
            },
            timeout_seconds: {
              type: 'number',
              description: `Maximum time to wait for startup in seconds (default: ${DEFAULT_INFRA_TIMEOUT}, max: ${MAX_INFRA_TIMEOUT})`,
              default: DEFAULT_INFRA_TIMEOUT,
            },
          },
          required: [],
        },
      },
      {
        name: 'emulator_stop',
        description:
          'Stop running Firebase emulators. Gracefully shuts down all emulator services and cleans up resources.',
        inputSchema: {
          type: 'object',
          properties: {
            timeout_seconds: {
              type: 'number',
              description: `Maximum time to wait for shutdown in seconds (default: ${DEFAULT_INFRA_TIMEOUT}, max: ${MAX_INFRA_TIMEOUT})`,
              default: DEFAULT_INFRA_TIMEOUT,
            },
          },
          required: [],
        },
      },
      {
        name: 'emulator_status',
        description:
          'Check the status of Firebase emulators. Returns whether emulators are running, which services are active, and their connection details.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'dev_server_start',
        description:
          'Start the development server for a specific module. Launches the dev server with hot reloading and returns the server URL. Can optionally start Firebase emulators as well.',
        inputSchema: {
          type: 'object',
          properties: {
            module: {
              type: 'string',
              description: 'Module name to start dev server for (e.g., "printsync", "fellspiral")',
            },
            with_emulators: {
              type: 'boolean',
              description: 'Start Firebase emulators before starting dev server (default: true)',
              default: true,
            },
            timeout_seconds: {
              type: 'number',
              description: `Maximum time to wait for startup in seconds (default: ${DEFAULT_INFRA_TIMEOUT}, max: ${MAX_INFRA_TIMEOUT})`,
              default: DEFAULT_INFRA_TIMEOUT,
            },
          },
          required: ['module'],
        },
      },
      {
        name: 'dev_server_stop',
        description:
          'Stop the development server for this worktree. Gracefully shuts down the dev server. Can optionally stop Firebase emulators as well.',
        inputSchema: {
          type: 'object',
          properties: {
            with_emulators: {
              type: 'boolean',
              description: 'Stop Firebase emulators along with dev server (default: false)',
              default: false,
            },
            timeout_seconds: {
              type: 'number',
              description: `Maximum time to wait for shutdown in seconds (default: ${DEFAULT_INFRA_TIMEOUT}, max: ${MAX_INFRA_TIMEOUT})`,
              default: DEFAULT_INFRA_TIMEOUT,
            },
          },
          required: [],
        },
      },
      {
        name: 'dev_server_status',
        description:
          'Check the status of the development server for this worktree. Returns whether the server is running, connection details, and Firebase emulator status.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'cleanup_orphans',
        description:
          'Clean up orphaned Firebase emulator processes and stale PID files. Identifies stale PID files where the process is no longer running, and escaped emulator processes without corresponding PID files. Returns what was found and cleaned up.',
        inputSchema: {
          type: 'object',
          properties: {
            dry_run: {
              type: 'boolean',
              description: 'Only list orphans, do not clean them up (default: false)',
              default: false,
            },
            force: {
              type: 'boolean',
              description:
                'Do not prompt for confirmation, clean up automatically (default: true for MCP)',
              default: true,
            },
          },
          required: [],
        },
      },
      {
        name: 'cleanup_worktree',
        description:
          'Clean up all test infrastructure for a specific worktree. Stops running Firebase emulators, removes worktree-specific temp directory, and removes temporary Firebase config. If no worktree_path is specified, cleans up the current worktree.',
        inputSchema: {
          type: 'object',
          properties: {
            worktree_path: {
              type: 'string',
              description:
                'Path to worktree to clean (default: current worktree). Example: /Users/name/worktrees/my-branch',
            },
          },
          required: [],
        },
      },
      {
        name: 'get_port_allocation',
        description:
          'Get the current port allocation for test infrastructure services. Returns which ports are assigned to which services and whether they are currently in use.',
        inputSchema: {
          type: 'object',
          properties: {
            service: {
              type: 'string',
              description:
                'Specific service to get port allocation for. If not specified, returns all allocations.',
            },
          },
          required: [],
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
      case 'test_run':
        return await testRun(args as TestRunArgs);

      case 'test_list_modules':
        return await testListModules();

      case 'test_get_status':
        return await testGetStatus(args as TestGetStatusArgs);

      case 'emulator_start':
        return await emulatorStart(args as EmulatorStartArgs);

      case 'emulator_stop':
        return await emulatorStop(args as EmulatorStopArgs);

      case 'emulator_status':
        return await emulatorStatus(args as EmulatorStatusArgs);

      case 'dev_server_start':
        return await devServerStart(args as DevServerStartArgs);

      case 'dev_server_stop':
        return await devServerStop(args as DevServerStopArgs);

      case 'dev_server_status':
        return await devServerStatus(args as DevServerStatusArgs);

      case 'cleanup_orphans':
        return await cleanupOrphans(args as CleanupOrphansArgs);

      case 'cleanup_worktree':
        return await cleanupWorktree(args as CleanupWorktreeArgs);

      case 'get_port_allocation':
        return await getPortAllocation(args as GetPortAllocationArgs);

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
  console.error('Test MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
