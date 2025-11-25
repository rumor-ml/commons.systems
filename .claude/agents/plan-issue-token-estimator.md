---
name: "plan-issue Token Estimator"
description: "Estimates token usage per subissue, flags those exceeding 50k"
model: haiku
---

For each proposed subissue:
1. Estimate token count based on files to read/modify, context required, complexity
2. Flag any subissues exceeding 50k tokens for further decomposition
3. Validate: no parallel conflicts, full scope coverage, independently testable
