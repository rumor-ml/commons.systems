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

6. Error handling and verification:
   - After script completes, verify resources are actually freed:
     - Parse script output for success indicators (✓ markers)
     - Check for WARNING messages indicating failures
     - Look for specific failure patterns:
       * "WARNING: PID file exists but could not be parsed"
       * "WARNING: Failed to unregister worktree"
       * "WARNING: Failed to release pool instance"
       * "WARNING: Stopped backend emulators while N worktree(s) may still be using them"

   - For each resource failure detected, provide specific guidance:
     * **Hosting emulator parse failure**: Show the PID file location and suggest manual inspection or `/debug`
     * **Port-based cleanup attempted**: Explain that fallback cleanup was used (may indicate stale PID file)
     * **Worktree unregister failure**: Suggest manual registry check: `infrastructure/scripts/worktree-registry.sh list`
     * **Pool release failure**: Provide manual release command: `infrastructure/scripts/emulator-pool.sh release <instance-id>`
     * **Permission denied**: Show specific file/process that failed and suggest checking ownership

   - Verify final state by analyzing script output:
     * Count success markers (✓) vs warnings (WARNING)
     * Identify which resources were stopped vs which failed
     * Distinguish between:
       - Complete success: All ✓ markers, no warnings
       - Partial success: Some ✓ markers, backend intentionally left running (other worktrees active)
       - Partial failure: Some ✓ markers, some WARNING messages
       - Complete failure: Multiple WARNING messages, few or no ✓ markers

7. Display results in structured format:
   - Create a resource status summary showing:
     ```
     Resource Status:
       Hosting emulator:     ✓ Stopped
       Hosting cleanup:      ✓ Complete (PID, log, config)
       Worktree registry:    ✓ Unregistered
       Pool instance:        ✓ Released
       Backend emulators:    - Not stopped (N other worktrees active)
     ```

   - If any failures occurred, show:
     ```
     Shutdown Status: PARTIAL FAILURE (X warnings)

     Issues detected:
       1. [Resource]: [Specific error message from script]
          → Suggestion: [Specific remediation step]
       2. [Resource]: [Specific error message from script]
          → Suggestion: [Specific remediation step]

     Next steps:
       • For detailed logs: /debug
       • For manual cleanup: [Specific commands based on failures]
       • To verify status: /emulator-status
       • To retry: /stop-emulators [with appropriate flags]
     ```

   - For partial success (backend left running intentionally):
     ```
     Shutdown Status: PARTIAL (backend shared with N worktrees)

     Stopped:
       ✓ Hosting emulator for this worktree
       ✓ Worktree unregistered
       ✓ Pool instance released (if applicable)

     Not stopped:
       • Backend emulators (shared with N other worktrees)

     Options:
       1. Stop backend anyway: /stop-emulators --force-backend
       2. Check other worktrees: infrastructure/scripts/worktree-registry.sh list
       3. Verify backend status: /emulator-status
     ```

8. Final summary:
   - For complete success: "All resources stopped and cleaned up successfully"
   - For partial success: "Hosting stopped, backend still running (N worktrees active)"
   - For failures: "Shutdown incomplete - see issues above"
   - Always suggest verification: "Run /emulator-status to confirm current state"

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
