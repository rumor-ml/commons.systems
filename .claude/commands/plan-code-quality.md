---
description: Create an implementation plan to refactor code and improve quality
model: opus
---

# Phase 1: Parallel Analysis

Launch 4 subagents simultaneously using the Task tool. Each agent is independent - no shared context needed.

## Agent 1: File Scanner (haiku)

Enumerate all code files and their sizes. Exclude node_modules, dist, build, .git.

**Collect:**
- File path, line count, estimated tokens (lines × 4)
- Flag files >20k tokens as requiring decomposition
- Note test framework configs found

**Return:** Structured list of files with metrics, highlighting >20k token files.

## Agent 2: Pattern Detector (sonnet)

Find duplication and dead code across the codebase.

**Duplication (2+ occurrences):**
- Configuration: build, test, deployment, env configs
- Business logic: algorithms, validation, transformations
- Infrastructure: CI/CD workflows, IaC, scripts
- UI: DOM patterns, components, event handling

**Dead code:**
- Unused imports and exports
- Commented-out code blocks
- Unreachable code paths
- TODO/FIXME/DEPRECATED markers

**Return:** Duplication clusters with file locations and extraction strategy (shared module / local utility / config consolidation). Dead code list with file:line references.

## Agent 3: Security & Quality Auditor (opus)

Deep analysis of security, performance, accessibility, and API patterns.

**Security:**
- XSS vulnerabilities (innerHTML, unsafe interpolation)
- CSRF protection gaps
- Credential exposure (hardcoded keys, logged secrets)
- Unsafe eval/Function constructor
- CORS misconfiguration
- Injection risks (SQL, command, etc.)

**Performance:**
- O(n²) or worse algorithms
- Memory leaks (uncleaned listeners, closures)
- Blocking synchronous operations
- Bundle size issues

**Accessibility:**
- Missing ARIA labels on interactive elements
- Keyboard navigation gaps
- Semantic HTML violations
- Color contrast issues

**API Consistency:**
- Naming convention violations
- Inconsistent error handling
- Mixed async patterns (callbacks vs promises vs async/await)

**Return:** Severity-ranked findings (critical/high/medium/low) with specific file:line references.

## Agent 4: Architecture Analyzer (opus)

Structural analysis, decomposition opportunities, and tooling assessment.

**Dependencies:**
- Circular dependency detection
- Module coupling metrics (high afferent/efferent coupling)
- Layer violations (UI importing directly from data layer)

**Code Quality:**
- Inconsistent error handling patterns
- Swallowed exceptions
- Global mutable state
- Race conditions in async code

**Decomposition Opportunities:**

*By Layer:*
- Mixed presentation, domain, data access
- God objects/functions doing too much

*By Operation:*
- Files handling multiple CRUD operations
- Mixed validation, transformation, formatting

*By Interface Boundary:*
- Tight coupling to file system, network, storage
- Dependency injection opportunities

*By Responsibility:*
- Single Responsibility violations
- Unrelated functions in util/helper files

**Tooling Gaps:**
- Linting/formatting (ESLint, Prettier, pre-commit)
- Type safety (TypeScript adoption candidates)
- CI/CD improvements (coverage gates, vuln scanning)

**Return:** Module boundary suggestions with complexity estimates, dependency issues, tooling recommendations.

# Phase 2: Synthesis

After all agents complete, synthesize findings:

1. **Deduplicate** cross-referenced issues
2. **Categorize** into High/Low priority:

| High Priority | Low Priority |
|---------------|--------------|
| Files >20k tokens | Minor duplication |
| Security vulnerabilities | API consistency |
| Circular dependencies | Accessibility improvements |
| Layer violations | Tooling setup |
| Missing critical tests | Dead code cleanup |

# Phase 3: Plan Output

Update the Claude Code plan with prioritized findings.

## High Priority Items

For each item include:
- **Description**: What needs fixing
- **Rationale**: Why this improves quality
- **Approach**: Implementation strategy
- **Files**: Specific file:line references
- **Effort**: S/M/L/XL
- **Acceptance**: How to verify completion

## Low Priority (Backlog)

Concise list for future work.

## Execution Guidance

- Group related refactorings that can be done together
- Identify work that can proceed in parallel
- Sequence: add tests → refactor → verify

# Phase 4: Complete

Call `ExitPlanMode` to signal plan is ready for user review.

**Note:** This command creates a plan only. It does not execute refactoring or create issues. User decides next steps.
