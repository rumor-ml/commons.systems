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
   - Check Auth: `nc -z 127.0.0.1 $AUTH_PORT 2>/dev/null && echo "RUNNING" || echo "STOPPED"`
   - Check Firestore: `nc -z 127.0.0.1 $FIRESTORE_PORT 2>/dev/null && echo "RUNNING" || echo "STOPPED"`
   - Check Storage: `nc -z 127.0.0.1 $STORAGE_PORT 2>/dev/null && echo "RUNNING" || echo "STOPPED"`
   - Check UI: `nc -z 127.0.0.1 $UI_PORT 2>/dev/null && echo "RUNNING" || echo "STOPPED"`

3. Check backend PID file:
   - Read: `~/.firebase-emulators/firebase-backend-emulators.pid`
   - If exists, verify process is alive: `kill -0 <pid> 2>/dev/null`

4. Check hosting emulator status (this worktree only):
   - Check: `nc -z 127.0.0.1 $HOSTING_PORT 2>/dev/null && echo "RUNNING" || echo "STOPPED"`
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
Firebase Emulator Status
========================

Backend Emulators (Shared):
  Auth (port 9099): RUNNING ✓
  Firestore (port 8080): RUNNING ✓
  Storage (port 9199): RUNNING ✓
  UI (port 4000): RUNNING ✓

Hosting Emulator (This Worktree):
  Port: 5030
  Project ID: demo-test-314015698
  Status: RUNNING ✓

Emulator Pool Status
====================
Total instances: 2
Available: 1
Claimed: 1

Claimed instances:
  pool-instance-0: claimed by /home/user/worktrees/1621-feature /worktree1 at 1704067200

Worktree Registrations (2 active)
==================================
Worktree:     /home/user/worktrees/1621-feature
Project ID:   demo-test-314015698
Mode:         pool
Hosting Port: 5042
Pool ID:      pool-instance-0
Registered:   2024-01-01 12:00:00
---
Worktree:     /home/user/worktrees/other-branch
Project ID:   demo-test-314015699
Mode:         singleton
Hosting Port: 5043
Pool ID:      none
Registered:   2024-01-01 12:05:00

URLs:
  Emulator UI: http://localhost:4000
  Hosting: http://localhost:5030

Status: All emulators healthy ✓
```

## Notes

- Backend is shared across worktrees; hosting is per-worktree
- Port allocation is deterministic based on worktree path (singleton mode)
- Pool instances have specific port ranges
- Worktree registry tracks which worktrees are using emulators
- Always use `dangerouslyDisableSandbox: true` for these operations
