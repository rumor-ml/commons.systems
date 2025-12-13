/**
 * Format wiggum tool responses as markdown
 *
 * Converts structured wiggum instruction data into human-readable markdown
 * format to avoid JSON decoding errors and improve readability in agent logs.
 */

interface ResponseData {
  current_step: string;
  step_number: string;
  iteration_count: number;
  instructions: string;
  steps_completed_by_tool: string[];
  context: {
    pr_number?: number;
    current_branch?: string;
    [key: string]: any;
  };
}

/**
 * Format wiggum response as markdown
 *
 * Takes structured response data and formats it as markdown with clear sections:
 * - Step header with iteration count
 * - Instructions section (multiline)
 * - Steps completed by tool (bulleted list or "none")
 * - Context section (key-value pairs)
 *
 * @param data - Structured response data from wiggum tool
 * @returns Formatted markdown string
 *
 * @example
 * ```typescript
 * const markdown = formatWiggumResponse({
 *   current_step: "Security Review",
 *   step_number: "4",
 *   iteration_count: 2,
 *   instructions: "Execute /security-review...",
 *   steps_completed_by_tool: [],
 *   context: { pr_number: 252, current_branch: "feature-branch" }
 * });
 * ```
 */
export function formatWiggumResponse(data: ResponseData): string {
  const {
    current_step,
    step_number,
    iteration_count,
    instructions,
    steps_completed_by_tool,
    context,
  } = data;

  const stepsSection =
    steps_completed_by_tool.length > 0
      ? steps_completed_by_tool.map((s) => `- ${s}`).join('\n')
      : '_(none)_';

  const contextEntries = Object.entries(context)
    .map(([key, value]) => {
      const label = key
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      return `- **${label}:** ${value}`;
    })
    .join('\n');

  return `## ${current_step} (Step ${step_number})
**Iteration:** ${iteration_count}

### Instructions

${instructions}

### Steps Completed by Tool
${stepsSection}

### Context
${contextEntries}`;
}
