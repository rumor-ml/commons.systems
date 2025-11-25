---
description: Decompose a GitHub issue into file-isolated tasks and execute them locally
model: sonnet
---

Decompose gh issue {{args}} into implementation tasks for local execution.

## Agents
- **plan-implementation Parallel Decomposer** (opus): Find parallelization seams, define file allowlists
- **plan-implementation Serial Decomposer** (opus): Break oversized tasks into sequential phases
- **plan-implementation Task Validator** (sonnet): Validate isolation, estimate tokens
- **plan-implementation Developer** (sonnet): Execute individual tasks (post-approval only)

## During Planning Mode

### 1. Extract Issue Context
Read the issue. Extract: scope, requirements, acceptance criteria.
Explore the codebase to understand:
- Existing patterns and conventions
- Files that will be affected
- Test patterns in use

### 2. Initial Decomposition
Run plan-implementation Parallel Decomposer to identify:
- Refactoring prerequisites (serial)
- Independent implementation tasks (parallel)
- Test tasks (parallel where possible)
- File allowlists for each task

### 3. Validation Pass
Run plan-implementation Task Validator:
- Check file isolation (no conflicts between parallel tasks)
- Estimate tokens per task
- Verify full scope coverage
- Flag tasks >50k tokens for further decomposition

### 4. Recursive Refinement
While any tasks exceed 50k tokens or have conflicts:
- plan-implementation Serial Decomposer for oversized tasks
- plan-implementation Parallel Decomposer to re-partition conflicting tasks
- plan-implementation Task Validator to re-validate

### 5. Generate Plan
Write implementation plan to `tmp/implementation-plans/<issue>-<timestamp>.md`

### 6. Exit Planning Mode
Call ExitPlanMode to present plan for user approval.
User reviews plan and approves by exiting planning mode.

## After Planning Mode (Execution)

### Execute Serial Prerequisites
For each prerequisite task (in order):
1. Update plan file: status = "in_progress"
2. Launch plan-implementation Developer agent with task context and file allowlist
3. Wait for completion
4. Update plan file: status = "completed" or "failed"
5. Proceed to next prerequisite

### Execute Parallel Tasks
Launch ALL ready parallel tasks simultaneously (unlimited):
1. Update plan file: all tasks status = "in_progress"
2. Invoke multiple Task tool calls in SINGLE message
3. Collect results as tasks complete
4. Update plan file with completion statuses
5. Continue with newly unblocked tasks

### Execute Verification
After all tasks complete:
1. Run full test suite
2. Verify acceptance criteria from original issue
3. If failures exist → enter Fix Cycle

### Fix Cycle (Recursive)
While verification failures exist:
1. Analyze failures (test errors, linting issues, type errors)
2. Create new fix tasks with file allowlists
3. Run plan-implementation Task Validator on fix tasks
4. Execute fix tasks (serial or parallel as appropriate)
5. Re-run verification
6. Repeat until all tests pass.

### Completion
When verification passes:
1. Generate completion report
2. Update plan file with final status

## Error Handling
- **Transient failures**: Retry up to 2 times
- **Scope escape** (needs files outside allowlist): Developer reports to orchestrator → orchestrator updates plan with expanded allowlist or new prerequisite task → re-execute
- **Hard failure**: Mark task failed, continue with independent tasks
- **Cascade**: Mark dependents as "blocked"
