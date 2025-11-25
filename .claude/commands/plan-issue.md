---
description: Break down large GitHub issues into subissues that **maximize parallelization** while keeping each subissue **<50k tokens**.
model: sonnet
---

Decompose gh issue {{args}} into parallel-friendly subissues.

## Agents (invoke via Task tool with `subagent_type`)
- `"plan-issue Parallel Decomposer"`: Find parallelization seams for independent work streams
- `"plan-issue Serial Decomposer"`: Break oversized subissues into sequential phases
- `"plan-issue Token Estimator"`: Estimate tokens per subissue, flag any >50k

## Steps

### 1. Extract Issue Context
Read the issue. Extract: scope, requirements, acceptance criteria, linked issues/PRs/docs.

### 2. Parallel Decomposition → Token Estimation
Run plan-issue Parallel Decomposer to find independent work streams, then plan-issue Token Estimator to validate sizes.

### 3. Recursive Refinement
While any subissues >50k tokens: plan-issue Serial Decomposer → plan-issue Parallel Decomposer → plan-issue Token Estimator

### 4. Create Subissues
For each subissue, create with:
- Scope (and out of scope)
- Acceptance criteria

Update root issue with:
- Summary of scope
- Dependency graph
- Execution order with links

**Hierarchy rules:**
- Siblings = Parallel (independent)
- Depth = Serial (parent completes before children)
