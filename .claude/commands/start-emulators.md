---
skill: start-emulators
model: haiku
dangerouslyDisableSandbox: true
description: Start Firebase emulators with pool auto-detection
---

# /start-emulators - Start Firebase Emulators

Start Firebase emulators (Auth, Firestore, Storage, Hosting) with automatic pool detection.

## Usage

- `/start-emulators` - Start all emulators (auto-detect pool vs singleton mode)
- `/start-emulators --app <name>` - Start emulators and host specific app
- `/start-emulators --no-pool` - Force singleton mode (no pool)

## Instructions

**IMPORTANT: Execute each step below sequentially. Do not skip steps or proceed to other work until all steps are complete.**

1. Parse command line arguments:
   - Check for `--app <name>` flag (specific app name to host)
   - Check for `--no-pool` flag (force singleton mode)
   - Store these for use in later steps

2. Check if emulators are already running:
   - Source port utilities: `source infrastructure/scripts/port-utils.sh`
   - Source port allocation: `source infrastructure/scripts/allocate-test-ports.sh`
   - Run: `nc -z 127.0.0.1 $AUTH_PORT 2>/dev/null`
   - If already running, display status and exit with message: "Emulators already running on ports: Auth=$AUTH_PORT, Firestore=$FIRESTORE_PORT, Storage=$STORAGE_PORT, UI=$UI_PORT"

3. Determine if pool mode should be used (unless `--no-pool` provided):
   - If `--no-pool` flag was provided, skip to step 5 (singleton mode)
   - Otherwise, check if pool is initialized: Run `infrastructure/scripts/emulator-pool.sh status`
   - If pool shows "Pool not initialized", automatically initialize it: Run `infrastructure/scripts/emulator-pool.sh init 2`
   - Display: "Pool initialized with 2 instances"

4. Claim pool instance (unless `--no-pool` provided):
   - Run: `infrastructure/scripts/emulator-pool.sh claim`
   - Parse the JSON output to extract: `id`, `projectId`, `authPort`, `firestorePort`, `storagePort`, `uiPort`, `hostingPort`
   - Set environment variables for use with start-emulators.sh:
     - `POOL_INSTANCE_ID="<id>"`
     - `GCP_PROJECT_ID="<projectId>"`
     - `AUTH_PORT="<authPort>"`
     - `FIRESTORE_PORT="<firestorePort>"`
     - `STORAGE_PORT="<storagePort>"`
     - `UI_PORT="<uiPort>"`
     - `HOSTING_PORT="<hostingPort>"`
   - Export these variables
   - Display: "Pool instance claimed: [id] (ports: Auth=[authPort], Firestore=[firestorePort], Storage=[storagePort])"

5. Start emulators using infrastructure script:
   - If `--app` flag was provided, build command: `APP_NAME="<app-name>" infrastructure/scripts/start-emulators.sh`
   - Otherwise, build command: `infrastructure/scripts/start-emulators.sh`
   - Execute with `dangerouslyDisableSandbox: true`
   - Capture and display all output including the final summary

6. If startup succeeds, display comprehensive summary:
   - Show mode: "Pool Mode" or "Singleton Mode"
   - Show backend emulator URLs with ports
   - Show hosting emulator URL (if started)
   - Show project ID
   - Show how to stop: "To stop: /stop-emulators"
   - Show how to check status: "To check status: /emulator-status"

7. If startup fails (non-zero exit code):
   - Capture the full output (stdout and stderr)
   - Display all output, not just last 20 lines (failure often at start)
   - Check for common error patterns:
     * Port conflict: "address already in use" or "EADDRINUSE"
     * Missing binary: "firebase: command not found"
     * Invalid config: "firebase.json" errors
     * Permission denied: "EACCES" or "Permission denied"
   - For each error type, provide specific recovery:
     * Port conflict: "Run /stop-emulators to release ports"
     * Missing binary: "Install Firebase CLI: npm install -g firebase-tools"
     * Invalid config: "Check firebase.json syntax: jq . firebase.json"
     * Permission denied: "Check file permissions and port binding capabilities"
   - Check if emulator log files exist and show last 50 lines:
     * Backend: ~/.firebase-emulators/firebase-backend-emulators.log
     * Hosting: tmp/infrastructure/firebase-hosting-*.log
   - If pool instance was claimed:
     * Attempt release: `infrastructure/scripts/emulator-pool.sh release <instance-id>`
     * Verify release succeeded (check exit code)
     * If release fails, warn: "Pool instance may be leaked. Run: emulator-pool.sh status"
   - Provide actionable next step: "Run /debug for interactive troubleshooting"

## Notes

- Emulator pool enables parallel test execution across multiple worktrees
- Each pool instance has isolated ports and project IDs
- Singleton mode allocates unique ports per worktree
- Backend emulators are shared; hosting is per-worktree
- QA users in fallspiral/emulator-data are automatically imported
- Always use `dangerouslyDisableSandbox: true` for emulator operations
