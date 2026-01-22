/**
 * Tool: gh_create_worktree
 * Create a new git worktree with full setup
 */

import { z } from 'zod';
import { homedir } from 'os';
import { join } from 'path';
import { execa } from 'execa';
import type { ToolResult } from '../types.js';
import { ValidationError, createErrorResult } from '../utils/errors.js';
import { ghCli, resolveRepo } from '../utils/gh-cli.js';
import { generateBranchName } from '../utils/string-utils.js';
import {
  getCurrentBranch,
  isWorkingDirectoryClean,
  fetchAndPullMain,
  createWorktree,
  setUpstream,
  configureHooksPath,
  worktreeExists,
} from '../utils/git-commands.js';

export const CreateWorktreeInputSchema = z
  .object({
    issue_number: z.number().int().positive().optional(),
    description: z.string().optional(),
    repo: z.string().optional(),
  })
  .strict()
  .refine((data) => data.issue_number !== undefined || data.description !== undefined, {
    message: 'Must provide at least one of: issue_number or description',
  });

export type CreateWorktreeInput = z.infer<typeof CreateWorktreeInputSchema>;

interface Issue {
  number: number;
  title: string;
  state: string;
}

/**
 * Check if a command exists in PATH
 */
async function commandExists(command: string): Promise<boolean> {
  try {
    const result = await execa('which', [command], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Resolve issue from GitHub or use description
 */
async function resolveIssue(
  issueNumber: number | undefined,
  description: string | undefined,
  repo: string
): Promise<{ number?: number; title: string }> {
  if (issueNumber !== undefined) {
    try {
      const issue = await ghCli(
        ['issue', 'view', issueNumber.toString(), '--json', 'number,title,state'],
        { repo }
      );
      const parsed: Issue = JSON.parse(issue);
      return {
        number: parsed.number,
        title: parsed.title,
      };
    } catch (error) {
      throw new ValidationError(
        `Failed to fetch issue #${issueNumber}. Make sure the issue exists and you have access.\n` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (description !== undefined) {
    return {
      title: description,
    };
  }

  throw new ValidationError('Must provide either issue_number or description');
}

/**
 * Update issue labels (remove "ready", add "in progress")
 */
async function updateIssueLabels(
  issueNumber: number,
  repo: string
): Promise<{ success: boolean; warning?: string }> {
  try {
    // Remove "ready" label if it exists (best effort)
    await ghCli(['issue', 'edit', issueNumber.toString(), '--remove-label', 'ready'], { repo });
  } catch (error) {
    // Ignore errors - label might not exist
  }

  try {
    // Add "in progress" label
    await ghCli(['issue', 'edit', issueNumber.toString(), '--add-label', 'in progress'], { repo });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      warning: `Failed to update issue labels: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Run direnv allow in the worktree directory
 */
async function runDirenvAllow(
  worktreePath: string
): Promise<{ success: boolean; warning?: string }> {
  const hasDirenv = await commandExists('direnv');
  if (!hasDirenv) {
    return { success: false, warning: 'direnv not found in PATH, skipping' };
  }

  try {
    await execa('direnv', ['allow', worktreePath], { reject: false });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      warning: `Failed to run direnv allow: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Open tmux window with claude in nix shell
 */
async function openTmuxWindow(
  worktreePath: string,
  branchName: string
): Promise<{ success: boolean; warning?: string }> {
  const hasTmux = await commandExists('tmux');
  if (!hasTmux) {
    return { success: false, warning: 'tmux not found in PATH, skipping' };
  }

  try {
    // Create new tmux window with branch name
    await execa('tmux', ['new-window', '-n', branchName, '-c', worktreePath], { reject: false });

    // Send command to start nix shell with claude
    await execa('tmux', ['send-keys', '-t', branchName, 'nix develop -c claude', 'Enter'], {
      reject: false,
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      warning: `Failed to open tmux window: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Create a new git worktree with full setup
 */
export async function createWorktreeCmd(input: CreateWorktreeInput): Promise<ToolResult> {
  const warnings: string[] = [];

  try {
    // ===== PRE-FLIGHT VALIDATION =====

    // Check current branch is main
    const currentBranch = await getCurrentBranch();
    if (currentBranch !== 'main') {
      throw new ValidationError(
        `Must be on main branch to create worktree. Current branch: ${currentBranch}\n` +
          `Run: cd ~/commons.systems/ (or the main worktree directory)`
      );
    }

    // Check working directory is clean
    const isClean = await isWorkingDirectoryClean();
    if (!isClean) {
      throw new ValidationError(
        'Working directory has uncommitted changes. Commit or stash changes before creating worktree.\n' +
          'Run: git status'
      );
    }

    // Fetch/pull latest from origin/main
    await fetchAndPullMain();

    // Resolve issue
    const repo = await resolveRepo(input.repo);
    const resolved = await resolveIssue(input.issue_number, input.description, repo);

    // Generate branch name
    const branchName = generateBranchName(resolved.number, resolved.title);
    const worktreePath = join(homedir(), 'worktrees', branchName);

    // Check worktree doesn't already exist
    const exists = await worktreeExists(worktreePath);
    if (exists) {
      throw new ValidationError(
        `Worktree already exists at: ${worktreePath}\n` +
          `Either use the existing worktree or remove it first.\n` +
          `To remove: git worktree remove ${worktreePath}`
      );
    }

    // Update issue labels (best effort, before point of no return)
    if (resolved.number !== undefined) {
      const labelResult = await updateIssueLabels(resolved.number, repo);
      if (labelResult.warning) {
        warnings.push(labelResult.warning);
      }
    }

    // ===== POINT OF NO RETURN =====
    // After this point, worktree has been created and we do best-effort setup

    await createWorktree(worktreePath, branchName);

    // ===== POST-CREATION SETUP (BEST EFFORT) =====

    // Set upstream
    try {
      await setUpstream(branchName, worktreePath);
    } catch (error) {
      warnings.push(
        `Failed to set upstream: ${error instanceof Error ? error.message : String(error)}\n` +
          `You can set it manually: cd ${worktreePath} && git branch --set-upstream-to origin/${branchName}`
      );
    }

    // Configure hooks path
    try {
      await configureHooksPath(worktreePath);
    } catch (error) {
      warnings.push(
        `Failed to configure hooks path: ${error instanceof Error ? error.message : String(error)}\n` +
          `You can configure it manually: cd ${worktreePath} && git config core.hooksPath $(git rev-parse --git-common-dir)/hooks`
      );
    }

    // Run direnv allow
    const direnvResult = await runDirenvAllow(worktreePath);
    if (direnvResult.warning) {
      warnings.push(direnvResult.warning);
    }

    // Open tmux window
    const tmuxResult = await openTmuxWindow(worktreePath, branchName);
    if (tmuxResult.warning) {
      warnings.push(tmuxResult.warning);
    }

    // ===== SUCCESS RESPONSE =====

    let summary = `✓ Created worktree: ${worktreePath}\n`;
    summary += `✓ Branch: ${branchName}\n`;
    if (resolved.number !== undefined) {
      summary += `✓ Issue: #${resolved.number} - ${resolved.title}\n`;
    } else {
      summary += `✓ Description: ${resolved.title}\n`;
    }

    if (warnings.length > 0) {
      summary += `\nWarnings:\n${warnings.map((w) => `  - ${w}`).join('\n')}\n`;
    }

    summary += `\nNext steps:\n`;
    summary += `  1. cd ${worktreePath}\n`;
    summary += `  2. Start working on the issue\n`;
    if (resolved.number !== undefined) {
      summary += `  3. Reference issue #${resolved.number} in commits\n`;
    }

    return {
      content: [
        {
          type: 'text',
          text: summary,
        },
      ],
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
