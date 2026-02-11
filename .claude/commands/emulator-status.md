---
skill: emulator-status
model: haiku
dangerouslyDisableSandbox: true
description: Show Firebase emulator status and health
---

# /emulator-status - Check Emulator Status

Show comprehensive status of Firebase emulators, pool status, and worktree registrations.

## Usage

- `/emulator-status` - Show status of all emulators, pool, and worktree registrations

## Instructions

**IMPORTANT: Execute each step below sequentially. Do not skip steps or proceed to other work until all steps are complete.**

1. Source port utilities and allocation:
   - Run: `source infrastructure/scripts/port-utils.sh`
   - Run: `source infrastructure/scripts/allocate-test-ports.sh`
   - This gets all port variables: AUTH_PORT, FIRESTORE_PORT, STORAGE_PORT, UI_PORT, HOSTING_PORT, PROJECT_ID

2. Check backend emulator status (shared across worktrees):
   - For each port (AUTH_PORT, FIRESTORE_PORT, STORAGE_PORT, UI_PORT), check if the port is in use
   - Determine if each emulator is RUNNING, STOPPED, or UNKNOWN
   - Report status for: Auth, Firestore, Storage, and UI emulators

3. Check backend PID file:
   - Read: `~/.firebase-emulators/firebase-backend-emulators.pid`
   - If exists, verify process is alive: `kill -0 <pid> 2>/dev/null`

4. Check hosting emulator status (this worktree only):
   - Check if HOSTING_PORT is in use
   - Read PID file: `$PROJECT_ROOT/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.pid`

5. Check pool status:
   - Run: `infrastructure/scripts/emulator-pool.sh status`
   - Display total instances, available, and claimed instances

6. Check worktree registrations:
   - Run: `infrastructure/scripts/worktree-registry.sh list`
   - This shows all active worktrees using emulators and their modes

7. Perform health checks on running emulators:
   - If Auth running: Try HTTP request to `http://localhost:$AUTH_PORT/`
   - If Firestore running: Try HTTP request to `http://localhost:$FIRESTORE_PORT/`
   - Display health status (reachable or unreachable)

8. Display comprehensive status output with these sections:

   **Backend Emulators (Shared):**
   - Auth: [port] - [RUNNING/STOPPED] [✓/✗]
   - Firestore: [port] - [RUNNING/STOPPED] [✓/✗]
   - Storage: [port] - [RUNNING/STOPPED] [✓/✗]
   - UI: [port] - [RUNNING/STOPPED] [✓/✗]

   **Hosting Emulator (This Worktree):**
   - Hosting: [port] - [RUNNING/STOPPED] [✓/✗]
   - Project ID: [project-id]

   **Emulator Pool Status:**
   - [Show output from emulator-pool.sh status]

   **Worktree Registrations:**
   - [Show output from worktree-registry.sh list]

   **URLs:**
   - Emulator UI: http://localhost:[UI_PORT]
   - Hosting: http://localhost:[HOSTING_PORT]

9. Suggest next steps based on status:
   - If all running: "Emulators ready for development"
   - If none running: "Run `/start-emulators` to start"
   - If partial: "Run `/stop-emulators` then `/start-emulators` to reset"

## Example Output

```
Backend Emulators (Shared):
  Auth (9099): RUNNING ✓
  Firestore (8080): RUNNING ✓
  Storage (9199): RUNNING ✓
  UI (4000): RUNNING ✓

Hosting (This Worktree): RUNNING ✓ (port 5030, demo-test-314015698)

Pool: 2 total, 1 available, 1 claimed
Worktrees: 2 active (1 pool, 1 singleton)

URLs: http://localhost:4000 (UI), http://localhost:5030 (Hosting)
Status: All emulators healthy ✓
```

## Notes

- Backend is shared across worktrees; hosting is per-worktree
- Port allocation is deterministic based on worktree path (singleton mode)
- Pool instances have specific port ranges
- Worktree registry tracks which worktrees are using emulators
- Always use `dangerouslyDisableSandbox: true` for these operations
