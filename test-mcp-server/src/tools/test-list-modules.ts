/**
 * test_list_modules tool - List all available test modules
 */

import type { ToolResult } from '../types.js';
import { execScript } from '../utils/exec.js';
import { getWorktreeRoot } from '../utils/paths.js';
import { createErrorResult } from '../utils/errors.js';
import path from 'path';

interface ModuleInfo {
  name: string;
  type: string;
  path: string;
  tests: {
    unit: boolean;
    e2e: boolean;
    deployed_e2e: boolean;
  };
}

/**
 * Format module list for display
 */
function formatModules(modules: ModuleInfo[]): string {
  const lines: string[] = [];

  lines.push('Available Test Modules:');
  lines.push('');

  // Group by type
  const byType = modules.reduce(
    (acc, mod) => {
      if (!acc[mod.type]) {
        acc[mod.type] = [];
      }
      acc[mod.type].push(mod);
      return acc;
    },
    {} as Record<string, ModuleInfo[]>
  );

  // Display each type
  Object.entries(byType).forEach(([type, mods]) => {
    lines.push(`${type}:`);
    mods.forEach((mod) => {
      const testTypes: string[] = [];
      if (mod.tests.unit) testTypes.push('unit');
      if (mod.tests.e2e) testTypes.push('e2e');
      if (mod.tests.deployed_e2e) testTypes.push('deployed-e2e');

      lines.push(`  - ${mod.name}`);
      lines.push(`    Path: ${mod.path}`);
      lines.push(`    Tests: ${testTypes.join(', ')}`);
    });
    lines.push('');
  });

  lines.push(`Total: ${modules.length} modules`);

  return lines.join('\n');
}

/**
 * Execute the test_list_modules tool
 */
export async function testListModules(): Promise<ToolResult> {
  try {
    // Get script path
    const root = await getWorktreeRoot();
    const scriptPath = path.join(root, 'infrastructure', 'scripts', 'test.sh');

    // Execute with --list --ci flags to get JSON output
    const result = await execScript(scriptPath, ['--list', '--ci'], {
      cwd: root,
      timeout: 30000, // 30 seconds should be plenty for listing
    });

    // Parse the JSON output
    let modules: ModuleInfo[];
    try {
      const parsed = JSON.parse(result.stdout);
      // Handle both array format and object format
      modules = Array.isArray(parsed) ? parsed : (parsed.modules || []);
    } catch (error) {
      // If JSON parsing fails, return empty list
      modules = [];
    }

    // Format for display
    const formatted = formatModules(modules);

    return {
      content: [
        {
          type: 'text',
          text: formatted,
        },
      ],
      _meta: {
        modules,
        count: modules.length,
      },
    };
  } catch (error) {
    return createErrorResult(error);
  }
}
