/**
 * Tool: wiggum_list_issues
 *
 * Returns a minimal list of issue references without full details.
 * This prevents token waste in the main thread by only showing IDs, titles, and metadata.
 * The main thread can then pass issue IDs to subagents who call wiggum_get_issue to get full details.
 *
 * Returns issue references with counts for filtering and tracking.
 *
 * ERROR HANDLING STRATEGY:
 * - VALIDATION ERRORS: Invalid scope parameter
 * - LOGGED ERRORS: File system errors (returns empty list with warning)
 * - STRUCTURED LOGGING: Issue listing, counts, filtering
 */

// TODO(#989): Repeated issue grouping pattern in list-issues.ts and read-manifests.ts
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import type { ToolResult } from '../types.js';
import type { IssueRecord } from './manifest-types.js';
import {
  getManifestDir,
  isManifestFile,
  readManifestFile,
  extractScopeFromFilename,
  groupIssuesByAgent,
  type IssueReference,
} from './manifest-utils.js';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Normalize a file path to a consistent project-relative format for comparison.
 * Converts absolute and relative paths to project-relative by:
 * 1. Removing worktree path prefixes (e.g., /Users/.../worktrees/branch-name/)
 * 2. Converting cwd-relative paths to project-relative
 * 3. Removing leading ./ prefixes
 *
 * Target format: Project-relative path without leading slash or ./
 * (e.g., "wiggum-mcp-server/src/foo.ts")
 *
 * This ensures paths referring to the same file match when used as keys
 * in the Union-Find, regardless of how they were originally specified.
 *
 * Examples:
 * - /Users/n8/worktrees/625-branch/wiggum-mcp-server/src/foo.ts -> wiggum-mcp-server/src/foo.ts
 * - wiggum-mcp-server/src/foo.ts -> wiggum-mcp-server/src/foo.ts
 * - ./wiggum-mcp-server/src/foo.ts -> wiggum-mcp-server/src/foo.ts
 */
export function normalizeFilePath(filePath: string): string {
  // Handle empty input gracefully - return as-is to avoid silent failures
  if (!filePath || filePath.length === 0) {
    return filePath;
  }

  let normalized = filePath;

  // Ensure forward slashes (for Windows compatibility) - do this first
  normalized = normalized.replace(/\\/g, '/');

  // Handle absolute paths with worktree patterns FIRST
  // This must happen before cwd check because cwd might be a subdirectory of the worktree
  // Match: /Users/.../worktrees/branch-name/... or /home/.../worktrees/...
  // Also match Windows-style: C:/Users/.../worktrees/branch-name/...
  const worktreeMatch = normalized.match(/^(?:[A-Za-z]:)?\/.*\/worktrees\/[^/]+\/(.+)$/);
  if (worktreeMatch) {
    normalized = worktreeMatch[1];
    // Validate non-empty result before returning
    if (normalized && normalized.length > 0) {
      return normalized;
    }
    // If worktree match produced empty result, log and fall through
    logger.warn('Worktree path normalization resulted in empty path', {
      original: filePath,
      impact: 'File will use original path for batching',
    });
    return filePath;
  }

  // Get current working directory for non-worktree absolute paths
  const cwd = process.cwd();

  // If absolute path starts with cwd, make it relative
  if (normalized.startsWith(cwd)) {
    normalized = normalized.slice(cwd.length);
    // Remove leading slash if present
    if (normalized.startsWith('/')) {
      normalized = normalized.slice(1);
    }
    // Validate non-empty result
    if (!normalized || normalized.length === 0) {
      logger.warn('CWD path normalization resulted in empty path', {
        original: filePath,
        cwd,
        impact: 'File will use original path for batching',
      });
      return filePath;
    }
  }

  // Remove leading ./ if present
  if (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }

  return normalized;
}

// Zod schema for input validation
export const ListIssuesInputSchema = z.object({
  scope: z.enum(['in-scope', 'out-of-scope', 'all']).optional().default('all'),
});

export type ListIssuesInput = z.infer<typeof ListIssuesInputSchema>;

// Re-export IssueReference from manifest-utils for backward compatibility
export type { IssueReference };

/**
 * Batch of in-scope issues grouped by file overlap
 */
export interface IssueBatch {
  readonly batch_id: string; // e.g., "batch-0"
  readonly files: readonly string[]; // Files this batch affects
  readonly issue_count: number; // Number of issues in batch
  readonly issue_ids: readonly string[]; // IDs of issues in this batch
  readonly titles: readonly string[]; // Brief titles for display
}

/**
 * Result with batched in-scope issues and individual out-of-scope issues
 */
export interface ListIssuesResult {
  // Batched structure for in-scope issues
  readonly in_scope_batches: readonly IssueBatch[];

  // Individual out-of-scope issues (unchanged)
  readonly out_of_scope: readonly IssueReference[];

  // Counts
  readonly total_issues: number;
  readonly total_batches: number;
  readonly counts: {
    readonly in_scope: number;
    readonly out_of_scope: number;
    readonly high_priority: number;
    readonly low_priority: number;
  };
}

/**
 * Union-Find data structure for grouping issues with overlapping files.
 *
 * Enforced invariants (validated at runtime):
 * - parent[i] points to a valid element (0 <= parent[i] < size) - bounds checked in find()/union()
 * - size is non-negative - validated in constructor
 * - External mutation prevented via private fields
 *
 * Algorithmic properties (maintained by correct implementation):
 * - rank[i] remains non-negative (initialized to 0, only incremented)
 * - Path compression in find() maintains tree structure
 * - Union by rank keeps trees balanced for O(alpha(n)) operations
 */
class UnionFind {
  private readonly _size: number;
  private readonly parent: Map<number, number> = new Map();
  private readonly rank: Map<number, number> = new Map();

  constructor(size: number) {
    if (size < 0) {
      throw new Error(`UnionFind size must be non-negative, got ${size}`);
    }
    this._size = size;
    for (let i = 0; i < size; i++) {
      this.parent.set(i, i);
      this.rank.set(i, 0);
    }
  }

  private validateIndex(x: number, method: string): void {
    if (x < 0 || x >= this._size) {
      throw new Error(`${method}: index ${x} out of bounds [0, ${this._size})`);
    }
  }

  find(x: number): number {
    this.validateIndex(x, 'find');
    const parent = this.parent.get(x)!;
    if (parent !== x) {
      this.parent.set(x, this.find(parent)); // Path compression
    }
    return this.parent.get(x)!;
  }

  union(x: number, y: number): void {
    this.validateIndex(x, 'union');
    this.validateIndex(y, 'union');

    const rootX = this.find(x);
    const rootY = this.find(y);

    if (rootX === rootY) return;

    const rankX = this.rank.get(rootX)!;
    const rankY = this.rank.get(rootY)!;

    // Union by rank
    if (rankX < rankY) {
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      this.parent.set(rootY, rootX);
    } else {
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
  }
}

/**
 * Batch in-scope issues by overlapping file sets using union-find algorithm
 * Exported for use in get-issue.ts
 */
export function batchInScopeIssues(
  issues: IssueReference[],
  allIssues: IssueRecord[]
): IssueBatch[] {
  if (issues.length === 0) {
    return [];
  }

  // Create a map from issue ID to issue record for file lookup
  const issueMap = new Map<string, IssueRecord>();
  for (const issue of allIssues) {
    // Find the matching reference to get its ID
    const ref = issues.find(
      (r) => r.agent_name === issue.agent_name && r.scope === issue.scope && r.title === issue.title
    );
    if (ref) {
      issueMap.set(ref.id, issue);
    }
  }

  // Initialize union-find
  const uf = new UnionFind(issues.length);

  // Create file-to-issues mapping
  const fileToIssues = new Map<string, number[]>();
  issues.forEach((issue, index) => {
    const record = issueMap.get(issue.id);
    const files = record?.files_to_edit || [];

    if (files.length === 0) {
      // Issue without files gets its own batch
      return;
    }

    files.forEach((file) => {
      // Normalize file paths to ensure consistent matching
      // (e.g., absolute vs relative paths should be treated as the same file)
      const normalizedFile = normalizeFilePath(file);
      if (!fileToIssues.has(normalizedFile)) {
        fileToIssues.set(normalizedFile, []);
      }
      fileToIssues.get(normalizedFile)!.push(index);
    });
  });

  // Union issues that share files
  for (const issueIndices of fileToIssues.values()) {
    for (let i = 1; i < issueIndices.length; i++) {
      uf.union(issueIndices[0], issueIndices[i]);
    }
  }

  // Group issues by root
  const batchGroups = new Map<number, number[]>();
  issues.forEach((_, index) => {
    const root = uf.find(index);
    if (!batchGroups.has(root)) {
      batchGroups.set(root, []);
    }
    batchGroups.get(root)!.push(index);
  });

  // Create batches
  const batches: IssueBatch[] = [];
  let batchIndex = 0;

  for (const issueIndices of batchGroups.values()) {
    // Collect all files for this batch
    const filesSet = new Set<string>();
    const batchIssueIds: string[] = [];
    const batchTitles: string[] = [];

    for (const index of issueIndices) {
      const issue = issues[index];
      batchIssueIds.push(issue.id);
      batchTitles.push(issue.title);

      const record = issueMap.get(issue.id);
      const files = record?.files_to_edit || [];
      // Normalize file paths for consistent output
      files.forEach((file) => filesSet.add(normalizeFilePath(file)));
    }

    batches.push({
      batch_id: `batch-${batchIndex}`,
      files: Array.from(filesSet).sort(),
      issue_count: issueIndices.length,
      issue_ids: batchIssueIds,
      titles: batchTitles,
    });

    batchIndex++;
  }

  return batches;
}

/**
 * Read all manifest files matching the scope filter and return minimal references
 * Also returns full issue records for batching purposes
 */
// TODO(#1016): Duplicate logic with collectManifestIssuesWithReferences in manifest-utils.ts
function listManifestIssues(scope: 'in-scope' | 'out-of-scope' | 'all'): {
  references: IssueReference[];
  records: IssueRecord[];
} {
  const manifestDir = getManifestDir();

  // Check if directory exists
  if (!existsSync(manifestDir)) {
    logger.info('Manifest directory does not exist - no issues recorded yet', {
      path: manifestDir,
    });
    return { references: [], records: [] };
  }

  // Read all files in directory
  const files = readdirSync(manifestDir);

  // Filter manifest files by scope
  const matchingFiles = files.filter((filename) => {
    if (!isManifestFile(filename)) {
      return false;
    }

    if (scope === 'all') {
      return true;
    }

    const fileScope = extractScopeFromFilename(filename);
    return fileScope === scope;
  });

  logger.info('Found manifest files for listing', {
    totalFiles: files.length,
    matchingFiles: matchingFiles.length,
    scope,
  });

  // Read and create minimal references
  const issueReferences: IssueReference[] = [];
  const issuesByAgent = new Map<string, IssueRecord[]>();
  const allIssueRecords: IssueRecord[] = [];

  // First, group all issues by agent name and scope
  for (const filename of matchingFiles) {
    const filepath = join(manifestDir, filename);
    const issues = readManifestFile(filepath);

    for (const issue of issues) {
      allIssueRecords.push(issue);
      const key = `${issue.agent_name}-${issue.scope}`;
      if (!issuesByAgent.has(key)) {
        issuesByAgent.set(key, []);
      }
      issuesByAgent.get(key)!.push(issue);
    }
  }

  // Now create issue references with stable IDs
  for (const [key, issues] of issuesByAgent) {
    issues.forEach((issue, index) => {
      issueReferences.push({
        id: `${key}-${index}`,
        agent_name: issue.agent_name,
        scope: issue.scope,
        priority: issue.priority,
        title: issue.title,
      });
    });
  }

  logger.info('Listed issue references', {
    totalReferences: issueReferences.length,
    scope,
  });

  return { references: issueReferences, records: allIssueRecords };
}

/**
 * Calculate counts from in-scope and out-of-scope issues
 * Note: batches parameter removed since we calculate directly from issues
 */
function calculateCounts(
  inScopeIssues: readonly IssueReference[],
  outOfScope: readonly IssueReference[]
): ListIssuesResult['counts'] {
  const inScopeCount = inScopeIssues.length;

  return {
    in_scope: inScopeCount,
    out_of_scope: outOfScope.length,
    high_priority:
      inScopeIssues.filter((i) => i.priority === 'high').length +
      outOfScope.filter((i) => i.priority === 'high').length,
    low_priority:
      inScopeIssues.filter((i) => i.priority === 'low').length +
      outOfScope.filter((i) => i.priority === 'low').length,
  };
}

/**
 * Format result as text output
 */
function formatResult(result: ListIssuesResult, scope: string): string {
  if (result.total_issues === 0) {
    return `No issues found for scope: ${scope}`;
  }

  const { counts } = result;

  let output = `# Issue References (scope: ${scope})

## Counts
- **Total:** ${result.total_issues}
- **In-Scope:** ${counts.in_scope}
- **Out-of-Scope:** ${counts.out_of_scope}
- **High Priority:** ${counts.high_priority}
- **Low Priority:** ${counts.low_priority}
- **Batches:** ${result.total_batches}

`;

  // Format in-scope batches
  if (result.in_scope_batches.length > 0) {
    output += `## In-Scope Batches\n\n`;

    for (const batch of result.in_scope_batches) {
      output += `### ${batch.batch_id} (${batch.issue_count} issue${batch.issue_count !== 1 ? 's' : ''}, ${batch.files.length} file${batch.files.length !== 1 ? 's' : ''})\n\n`;
      output += `**Files:**\n`;
      for (const file of batch.files) {
        output += `- ${file}\n`;
      }
      output += `\n**Issues:**\n`;
      for (let i = 0; i < batch.issue_ids.length; i++) {
        output += `- [${batch.issue_ids[i]}] ${batch.titles[i]}\n`;
      }
      output += '\n';
    }
  }

  // Format out-of-scope issues
  if (result.out_of_scope.length > 0) {
    output += `## Out-of-Scope Issues\n\n`;

    // Group out-of-scope issues by agent using shared utility (resolves #989)
    const issuesByAgent = groupIssuesByAgent(result.out_of_scope);

    // Format each agent's issues
    for (const [agentName, issues] of issuesByAgent) {
      output += `### ${agentName} (${issues.length} issue${issues.length !== 1 ? 's' : ''})\n\n`;

      for (const issue of issues) {
        const priorityEmoji = issue.priority === 'high' ? '🔴' : '🔵';

        output += `- **${priorityEmoji}** [${issue.id}] ${issue.title}\n`;
      }

      output += '\n';
    }
  }

  output += `\n---

**Next steps:**
- For in-scope batches: Call unsupervised-implement agent with \`batch_id\` (ALL IN PARALLEL)
- For out-of-scope issues: Call out-of-scope-tracker agent with \`issue_id\` (ALL IN PARALLEL)
- Implementation agents will call \`wiggum_get_issue({ batch_id })\` to get all issues in batch
- Tracker agents will call \`wiggum_get_issue({ id })\` to get individual issue details
`;

  return output;
}

/**
 * List all issues as minimal references
 */
export async function listIssues(input: ListIssuesInput): Promise<ToolResult> {
  logger.info('wiggum_list_issues', {
    scope: input.scope,
  });

  // Get minimal issue references and full records
  const { references, records } = listManifestIssues(input.scope);

  // Separate in-scope and out-of-scope
  const inScopeIssues = references.filter((i) => i.scope === 'in-scope');
  const outOfScopeIssues = references.filter((i) => i.scope === 'out-of-scope');

  // Batch in-scope issues by overlapping files
  const inScopeBatches = batchInScopeIssues(inScopeIssues, records);

  // Calculate counts
  const counts = calculateCounts(inScopeIssues, outOfScopeIssues);

  // Create result
  const result: ListIssuesResult = {
    in_scope_batches: inScopeBatches,
    out_of_scope: outOfScopeIssues,
    total_issues: references.length,
    total_batches: inScopeBatches.length,
    counts,
  };

  // Format output
  const output = formatResult(result, input.scope);

  return {
    content: [{ type: 'text', text: output }],
  };
}
