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

2. Verify nc (netcat) is available:
   - Run: `command -v nc >/dev/null 2>&1 || { echo "ERROR: nc (netcat) command not found. Install with: apt install netcat" >&2; exit 1; }`

3. Check backend emulator status (shared across worktrees):
   - For each port (AUTH_PORT, FIRESTORE_PORT, STORAGE_PORT, UI_PORT), check status with proper error handling:
   - Use this function pattern for each check:
     ```bash
     check_emulator_port() {
       local port=$1
       local name=$2
       local nc_output

       # Try connection and capture full output
       nc_output=$(nc -z 127.0.0.1 "$port" 2>&1)
       local nc_exit=$?

       if [ $nc_exit -eq 0 ]; then
         echo "$name: RUNNING"
       elif echo "$nc_output" | grep -q "Connection refused"; then
         echo "$name: STOPPED"
       else
         # Other error - show what went wrong
         echo "$name: UNKNOWN (check failed: $nc_output)" >&2
       fi
     }

     check_emulator_port "$AUTH_PORT" "Auth"
     check_emulator_port "$FIRESTORE_PORT" "Firestore"
     check_emulator_port "$STORAGE_PORT" "Storage"
     check_emulator_port "$UI_PORT" "UI"
     ```

4. Check backend PID file:
   - Read: `~/.firebase-emulators/firebase-backend-emulators.pid`
   - If exists, verify process is alive: `kill -0 <pid> 2>/dev/null`

5. Check hosting emulator status (this worktree only):
   - Use the same check_emulator_port function defined in step 3:
     ```bash
     check_emulator_port "$HOSTING_PORT" "Hosting"
     ```
   - Read PID file: `$PROJECT_ROOT/tmp/infrastructure/firebase-hosting-${PROJECT_ID}.pid`

6. Check pool status:
   - Run: `infrastructure/scripts/emulator-pool.sh status`
   - Display total instances, available, and claimed instances

7. Check worktree registrations:
   - Run: `infrastructure/scripts/worktree-registry.sh list`
   - This shows all active worktrees using emulators and their modes

8. Perform health checks on running emulators:
   - If Auth running: Try HTTP request to `http://localhost:$AUTH_PORT/`
   - If Firestore running: Try HTTP request to `http://localhost:$FIRESTORE_PORT/`
   - Display health status (reachable or unreachable)

9. Display comprehensive status output with these sections:

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

10. Suggest next steps based on status:
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
