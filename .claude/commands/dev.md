---
skill: dev
model: haiku
dangerouslyDisableSandbox: true
description: Start dev server with emulators for an app
---

# /dev - Start Development Server with Emulators

Start a development server with Firebase emulators for local development and testing.

## Usage

- `/dev` - Start dev server for current app (auto-detect from directory)
- `/dev <app-name>` - Start dev server for specific app (e.g., `/dev fellspiral`)
- `/dev --no-pool` - Force singleton mode (no pool instance)

## Instructions

**IMPORTANT: Execute each step below sequentially. Do not skip steps or proceed to other work until all steps are complete.**

1. Parse command line arguments:
   - Check for `--no-pool` flag (force singleton mode)
   - Check for app name argument
   - If no app name, detect from current directory (check for common app locations: fellspiral, budget, printsync, videobrowser, etc.)

2. Validate app directory exists:
   - If app name provided, check that app directory exists
   - If directory not found, show error and list available apps: `infrastructure/scripts/discover-apps.sh`
   - For current directory detection, verify it's an app directory (contains Makefile with dev target)

3. Ensure emulators are running:
   - Check if emulators already running: `nc -z 127.0.0.1 $AUTH_PORT 2>/dev/null`
   - If not running, start them: Run `/start-emulators --no-pool` if `--no-pool` provided, otherwise `/start-emulators`
   - Verify startup succeeded by checking port again

4. Verify QA users are seeded (for Firebase apps):
   - Check if app uses Firebase (has firebase.json or uses Firestore)
   - If using Firebase and emulators running, seed QA users:
     - Run: `infrastructure/scripts/seed-firestore-local.sh`
     - Display: "QA users seeded: qa-github@test.com (GitHub provider)"

5. Start dev server for the app:
   - Change to app directory
   - Run: `make dev` (or appropriate dev command for the app type)
   - Capture output and display

6. Display the dev server URL, emulator URLs, and QA credentials

7. If startup fails:
   - Show error message from make dev
   - Suggest common fixes:
     - "Port already in use: Run `/stop-emulators` first"
     - "App directory not found: Run `infrastructure/scripts/discover-apps.sh` to list apps"
     - "Emulator failed to start: Run `/emulator-status` to debug"
   - Offer to run `/debug` for detailed investigation

## Examples

### Start dev for current app

```bash
cd fellspiral
/dev
```

### Start dev for specific app

```bash
/dev fellspiral
```

### Start dev without pool (singleton mode)

```bash
/dev fellspiral --no-pool
```

## Notes

- Dev server runs in foreground; use Ctrl+C to stop
- Emulators continue running after dev server stops (use `/stop-emulators` to stop them)
- Pool mode auto-detected from POOL_INSTANCE_ID environment variable
- Singleton mode allocates unique ports per worktree
- QA users are pre-configured for testing Firebase Auth
- Always use `dangerouslyDisableSandbox: true` for emulator operations
