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

6. Verify results and display summary:
   - Parse script output for success indicators (✓) and warnings (WARNING)
   - For complete success: Report all resources stopped cleanly
   - For partial success (backend left running): Report hosting stopped, explain N worktrees still using backend, offer `--force-backend` option
   - For failures: List failed resources with specific error messages, provide recovery commands based on failure type:
     * PID file issues: Suggest `/debug` or manual inspection
     * Worktree unregister failure: Show `worktree-registry.sh list` command
     * Pool release failure: Show `emulator-pool.sh release <instance-id>` command
   - Always suggest `/emulator-status` to verify final state

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
