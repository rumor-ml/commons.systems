/**
 * Shared constants for Test MCP server
 */

// Maximum characters to return in tool responses to stay within token limits
export const MAX_RESPONSE_LENGTH = 10000;

// Default timeout for test execution (in seconds)
export const DEFAULT_TEST_TIMEOUT = 300; // 5 minutes
export const MAX_TEST_TIMEOUT = 1800; // 30 minutes

// Default timeout for infrastructure operations (in seconds)
export const DEFAULT_INFRA_TIMEOUT = 120; // 2 minutes
export const MAX_INFRA_TIMEOUT = 600; // 10 minutes

// Polling intervals in seconds
export const DEFAULT_POLL_INTERVAL = 2;
export const MIN_POLL_INTERVAL = 1;
export const MAX_POLL_INTERVAL = 30;

// Script paths (relative to git worktree root)
export const SCRIPTS_DIR = 'infrastructure/scripts';
export const TEST_RUN_SCRIPT = 'test-run.sh';
export const EMULATOR_START_SCRIPT = 'emulator-start.sh';
export const EMULATOR_STOP_SCRIPT = 'emulator-stop.sh';
export const EMULATOR_STATUS_SCRIPT = 'emulator-status.sh';
export const DEV_SERVER_START_SCRIPT = 'dev-server-start.sh';
export const DEV_SERVER_STOP_SCRIPT = 'dev-server-stop.sh';
export const DEV_SERVER_STATUS_SCRIPT = 'dev-server-status.sh';
export const CLEANUP_ORPHANS_SCRIPT = 'cleanup-orphans.sh';
export const CLEANUP_WORKTREE_SCRIPT = 'cleanup-worktree.sh';
export const PORT_ALLOCATION_SCRIPT = 'port-allocation.sh';

// Test status values
export const TEST_STATUS_RUNNING = 'running';
export const TEST_STATUS_PASSED = 'passed';
export const TEST_STATUS_FAILED = 'failed';
export const TEST_STATUS_NOT_STARTED = 'not_started';

// Infrastructure service names
export const SERVICE_FIREBASE_EMULATORS = 'firebase-emulators';
export const SERVICE_DEV_SERVER = 'dev-server';

// Temporary directory name (relative to worktree root)
export const TEMP_DIR = '.test-mcp';
