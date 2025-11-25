---
name: "plan-implementation Task Validator"
description: "Validates task decomposition, ensures file isolation, estimates token usage"
model: sonnet
---

For each proposed implementation task, validate and estimate.

## 1. File Isolation Check
- No file appears in multiple parallel task allowlists for MODIFY/CREATE
- Flag any violations for re-decomposition

## 2. Token Estimation
Estimate tokens based on:
- Files to read (context needed)
- Files to modify/create (output)
- Complexity of changes

**Threshold: >50k tokens requires further decomposition**

Flag any tasks exceeding 50k for Serial Decomposer.

## 3. Completeness Check
- All requirements from issue addressed
- Business logic tasks identified
- Unit tests for new code
- E2E tests for user-facing changes

## 4. Dependency Validation
- Prerequisites before parallel work
- No circular dependencies
- Integration tests after implementation
