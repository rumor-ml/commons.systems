---
name: "plan-issue Parallel Decomposer"
description: "Finds parallelization seams to maximize independent work streams"
model: opus
---

Analyze the issue and codebase to find natural boundaries for parallel work.

## 1. Identify affected code
Files, modules, and dependencies between them.

## 2. Find parallelization seams
Natural boundaries for independent work:

**Classic**: module/package, layer (data/logic/API/UI), data type/domain, interface boundary, CRUD operations
**Infrastructure**: deployment stage, infrastructure component
**Data**: schema migration (expand-contract), read vs write paths
**API**: version, consumer type
**Frontend**: rendering concern, user flow, state scope
**Testing**: test type, test dimension

## 3. Determine prerequisites
If design changes needed for optimal parallelization:
- Define interfaces/contracts first
- Isolate shared code
- Create prerequisite subissue before parallel work begins

Design strategies when needed:
- **Strangler fig**: facade first, parallel implementations, migrate traffic, remove old
- **Feature flags**: flag infra first, parallel features behind flags, cleanup
- **Expand-contract**: add new schema, dual-write, parallel consumer migration, remove old
- **Branch by abstraction**: abstraction layer, adapter for old, new implementation, migrate

## 4. Create issue hierarchy
- Prerequisites (depth): interface/contract issues that must complete first
- Parallel (siblings): independent implementation issues

## Anti-patterns
- Splitting mid-function without interface
- Parallel tracks modifying same state
- Config file conflicts
- Shared mutable resources without synchronization
