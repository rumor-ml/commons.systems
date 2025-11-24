---
description: Break down large GitHub issues into subissues that **maximize parallelization** while keeping each subissue **<50k tokens**.
model: sonnet
---

# Step 1: Analyze

Look at gh issue {{args}}. If argument is not a gh issue then return an error an do not proceed.

1. Read the full issue scope, linked docs, and relevant code
2. Identify what work can proceed independently
3. Map which files/modules each piece of work touches

# Step 2: Find Parallelization Seams

Look for natural boundaries that enable independent work:

**By Module/Package**: Different packages can usually be worked in parallel
**By Layer**: Database layer, business logic, API handlers, UI components  
**By Data Type**: Work on Users vs Orders vs Inventory  
**By Operation**: Read paths vs write paths, CRUD operations on same entity  
**By Interface Boundary**: Anything separated by an interface can parallelize  
**By Test Scope**: Unit-testable chunks that don't need integration  

**Anti-patterns to avoid**:
- Splitting mid-function or mid-file without clear interface
- "Part 1" and "Part 2" of sequential logic
- Shared mutable state across subissues

# Step 3: Design for Independence

## Define Interfaces First
If parallel tracks will integrate later, create a **serial "interface definition" subissue first**:
```
#101 Define interfaces for X (serial - do first)
  ├── #102 Implement interface A (parallel)
  ├── #103 Implement interface B (parallel)  
  └── #104 Implement interface C (parallel)
#105 Integration tests (serial - do last)
```

## Use Dependency Injection
Structure work so implementations depend on interfaces, not concrete types. This allows:
- Parallel implementation against shared contracts
- Independent testing with mocks
- Merge in any order

## Isolate Shared Code Changes
If multiple tracks need a shared utility:
1. Extract the shared change as its own subissue
2. Make it a dependency for all tracks that need it
3. Complete it first, then parallelize the rest

# Step 4: Structure the Hierarchy
```
Siblings = Parallel (independent, separate PRs, merge in any order)
Depth = Serial (parent must complete before children start)
```

Example:
```
#66 Original Issue
├── #67 Database schema + migrations (parallel track A)
├── #68 API implementation (parallel track B)  
│   ├── #69 Define request/response types (serial B.1)
│   ├── #70 Implement endpoints (serial B.2, needs B.1)
│   └── #71 Add middleware (serial B.3, needs B.2)
├── #72 CLI commands (parallel track C)
└── #73 Integration tests (serial - after A, B, C)
```

If any subissue exceeds 50k tokens, recursively decompose it using the same rules.

# Step 5: Validation Checklist

Before finalizing:
- [ ] No two parallel subissues modify the same code in conflicting ways
- [ ] Every subissue is <50k tokens
- [ ] Union of all subissues == original issue scope  
- [ ] Merge order is clear from dependency graph
- [ ] Each subissue can be tested independently

Step 6: Create Plan
Include steps to:
- Create each subissue. Each subissue must contain:
    - Scope
    - Acceptance criteria
    - What is out of scope
- Update body of root issue.
    - Top level summary of scope.
    - Dependency graph
    - List execution order with links to each subissue.
