---
skill: stop-emulators
model: haiku
dangerouslyDisableSandbox: true
description: Stop Firebase emulators cleanly and release pool instances
---

# /stop-emulators - Stop Firebase Emulators

Stop Firebase emulators and clean up resources. Unregisters worktree and releases pool instances if applicable.

## Usage

- `/stop-emulators` - Stop hosting emulator, unregister worktree, release pool if applicable
- `/stop-emulators --force-backend` - Force stop backend emulator even if other worktrees are active

## Instructions

**IMPORTANT: Execute each step below sequentially. Do not skip steps or proceed to other work until all steps are complete.**

1. Parse command line arguments:
   - Check for `--force-backend` flag (force backend shutdown)
   - Store this flag for use in step 5

2. Execute the stop script:
   - Run: `infrastructure/scripts/stop-emulators.sh` (or with `--force-backend` if provided)
   - Use `dangerouslyDisableSandbox: true`
   - Capture all output

3. Parse the script output to determine what was stopped:
   - Look for messages indicating:
     - Hosting emulator stopped or not running
     - Worktree unregistered
     - Pool instance released (if applicable)
     - Backend emulator stopped or still in use

4. Display results to user in clear format:
   - Show what was stopped: hosting, backend, pool
   - If backend not stopped, show how many other worktrees are using it
   - Show that cleanup completed successfully
   - If stopping failed, show error message and suggest `/debug` for investigation

5. If pool instance was active:
   - The script automatically handles pool release
   - Display: "Pool instance released successfully"

6. Error handling:
   - If stop fails with permission issues, suggest checking file permissions
   - If PID files are stale, script will clean them up
   - Show cleanup status for each resource: hosting, backend, pool, registrations

7. Final summary:
   - Display "Emulator shutdown complete" or "Partial cleanup - see messages above"
   - For singleton mode: "Confirm emulators stopped with /emulator-status"
   - For pool mode: "Pool instance has been released and is available for other worktrees"

## Examples

### Stop emulators for this worktree

```bash
infrastructure/scripts/stop-emulators.sh
```

Expected output:

```

Stopping Firebase emulators...

Stopping hosting emulator...
✓ Successfully stopped hosting emulator
✓ Cleaned up hosting PID file
✓ Cleaned up hosting log file
✓ Cleaned up temp config

Unregistering worktree from registry...
✓ Worktree unregistered

Releasing pool instance: pool-instance-0
✓ Pool instance released

Backend emulators still in use by 1 other worktree(s) - NOT stopping

✓ Emulator shutdown complete
```

### Force stop all emulators

```bash
infrastructure/scripts/stop-emulators.sh --force-backend
```

## Notes

- Hosting emulator is per-worktree (safe to stop, doesn't affect others)
- Backend emulator is shared (script checks other worktrees before stopping)
- Use `--force-backend` only if you're sure other worktrees are done
- Pool instances are automatically released for reuse
- Worktree registration is automatically removed from registry
- Always use `dangerouslyDisableSandbox: true` for these operations
