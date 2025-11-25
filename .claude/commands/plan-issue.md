---
description: Break down large GitHub issues into subissues that **maximize parallelization** while keeping each subissue **<50k tokens**.
model: sonnet
---

Decompose gh issue {{args}} into parallel-friendly subissues.

## Agents
- **Parallel Decomposer** (opus): Find parallelization seams for independent work streams
- **Serial Decomposer** (opus): Break oversized subissues into sequential phases
- **Token Estimator** (haiku): Estimate tokens per subissue, flag any >50k

## Steps

### 1. Extract Issue Context
Read the issue. Extract: scope, requirements, acceptance criteria, linked issues/PRs/docs.

### 2. Parallel Decomposition → Token Estimation
Run Parallel Decomposer to find independent work streams, then Token Estimator to validate sizes.

### 3. Recursive Refinement
While any subissues >50k tokens: Serial Decomposer → Parallel Decomposer → Token Estimator

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
