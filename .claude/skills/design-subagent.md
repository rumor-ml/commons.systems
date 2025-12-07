---
description: Guide for designing Claude Code subagents with best practices
---

## When to Create Subagents

Create a new subagent when:

1. **Context Isolation** - Task requires context that would pollute the main conversation
   - Heavy codebase exploration that generates many file reads
   - Domain-specific analysis (security audit, performance profiling)
   - Research that produces intermediate artifacts not needed later

2. **Model Optimization** - Task complexity doesn't match current model
   - Use **opus** for: complex reasoning, architecture decisions, security analysis, multi-step planning
   - Use **sonnet** for: general implementation, balanced analysis, most coding tasks
   - Use **haiku** for: file enumeration, token counting, validation, simple transforms

3. **Parallel Execution** - Independent work streams that can run simultaneously
   - Multiple files/modules to analyze independently
   - Different perspectives on same problem (security vs performance vs maintainability)

## Separation of Concerns: Commands vs Agents

### Commands (`.claude/commands/`)

Focus on **orchestration and flow control**:

- Define inputs (arguments, issue numbers, file paths)
- Specify expected outputs from each step
- Coordinate agent invocations (sequential vs parallel)
- Handle conditional logic and error paths
- Aggregate results from multiple agents

Commands should NOT contain:

- Detailed methodology for how to perform analysis
- Domain knowledge or heuristics
- Step-by-step execution instructions

### Agents (`.claude/agents/<name>/`)

Focus on **execution methodology**:

- Deep domain expertise and heuristics
- Step-by-step analysis procedures
- Quality criteria and validation rules
- Output format specifications

Agents should NOT contain:

- Awareness of other agents in the pipeline
- Flow control logic
- Input parsing from user arguments

## Model Selection Decision Tree

```
Is task primarily:
├─ Enumeration/counting/validation → haiku
├─ Pattern matching/simple transforms → haiku
├─ Standard implementation/analysis → sonnet
├─ Complex reasoning/multi-step planning → opus
├─ Security/architecture decisions → opus
└─ Uncertain → sonnet
```

## Anti-patterns to Avoid

1. **Context Duplication**
   - BAD: Command explains methodology, agent repeats it
   - GOOD: Command says "Agent: Decomposer", agent contains all methodology

2. **Vague Instructions**
   - BAD: "Research the authentication system"
   - GOOD: "Identify auth entry points, trace token validation flow, map permission checks"

3. **Overlapping Responsibilities**
   - BAD: Two agents both checking for security issues
   - GOOD: One agent for OWASP top 10, another for dependency vulnerabilities

4. **Over-parallelization**
   - BAD: Spawning agents for tasks with shared dependencies
   - GOOD: Sequential for dependent work, parallel only for truly independent tasks

5. **Wrong Model for Task**
   - BAD: Using opus for file counting (expensive, slow)
   - BAD: Using haiku for architecture decisions (insufficient reasoning)
