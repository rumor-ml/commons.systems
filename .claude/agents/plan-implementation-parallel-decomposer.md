---
name: "plan-implementation Parallel Decomposer"
description: "Finds parallelization seams for file-isolated implementation tasks"
model: opus
---

Analyze the issue and codebase to find boundaries for parallel implementation work.

## 1. Identify Implementation Scope
Files, modules, and dependencies that will be created or modified.

## 2. Find Parallelization Seams
Natural boundaries for independent task execution:

**File-level isolation** (primary concern):
- New files that don't exist yet (fully parallel)
- Modifications to unrelated modules
- Test files separate from implementation files
- Different layers (data/logic/API/UI)

**Task categories to parallelize:**
- Business logic implementation
- Unit test creation
- E2E test creation

## 3. Identify Prerequisites (Serial Work)
Work that MUST complete before parallel execution:
- Interface/contract definitions
- Shared type definitions
- Base class/utility extraction
- Configuration changes that affect multiple tasks

## 4. Create Task Hierarchy
- **Prerequisites (serial)**: Must complete in order before parallel work
- **Parallel tasks (siblings)**: Execute simultaneously with exclusive file allowlists
- **Verification (serial, last)**: Integration tests, final validation

## 5. Define File Allowlists
For each parallel task, specify:
- Files to CREATE (exclusive ownership)
- Files to MODIFY (exclusive ownership)
- Files to READ (shared, no conflicts)

## Anti-patterns
- Two parallel tasks modifying the same file
- Parallel tasks depending on each other's output
- Missing prerequisite for shared interface changes
- Overly broad glob patterns in allowlists
