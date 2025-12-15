/**
 * Tests for test_list_modules tool - module list parsing and formatting
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

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
 * Parse module list JSON (extracted logic for testing)
 */
function parseModuleList(stdout: string): ModuleInfo[] {
  try {
    const parsed = JSON.parse(stdout);
    // The JSON is an array directly, not wrapped in an object
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

/**
 * Format modules for display (extracted logic for testing)
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

describe('Module List Parser', () => {
  it('should parse valid JSON array', () => {
    const jsonOutput = JSON.stringify([
      {
        name: 'printsync',
        type: 'go-fullstack',
        path: '/path/to/printsync',
        tests: { unit: true, e2e: true, deployed_e2e: true },
      },
    ]);

    const modules = parseModuleList(jsonOutput);
    assert.strictEqual(modules.length, 1);
    assert.strictEqual(modules[0].name, 'printsync');
    assert.strictEqual(modules[0].type, 'go-fullstack');
  });

  it('should handle empty array', () => {
    const jsonOutput = JSON.stringify([]);
    const modules = parseModuleList(jsonOutput);
    assert.strictEqual(modules.length, 0);
  });

  it('should handle invalid JSON gracefully', () => {
    const modules = parseModuleList('not valid json');
    assert.strictEqual(modules.length, 0);
  });

  it('should handle empty string', () => {
    const modules = parseModuleList('');
    assert.strictEqual(modules.length, 0);
  });

  it('should parse multiple modules', () => {
    const jsonOutput = JSON.stringify([
      {
        name: 'printsync',
        type: 'go-fullstack',
        path: '/path/to/printsync',
        tests: { unit: true, e2e: true, deployed_e2e: true },
      },
      {
        name: 'fellspiral',
        type: 'firebase',
        path: '/path/to/fellspiral',
        tests: { unit: false, e2e: true, deployed_e2e: true },
      },
      {
        name: 'wiggum-mcp-server',
        type: 'mcp-server',
        path: '/path/to/wiggum',
        tests: { unit: true, e2e: false, deployed_e2e: false },
      },
    ]);

    const modules = parseModuleList(jsonOutput);
    assert.strictEqual(modules.length, 3);
    assert.strictEqual(modules[0].name, 'printsync');
    assert.strictEqual(modules[1].name, 'fellspiral');
    assert.strictEqual(modules[2].name, 'wiggum-mcp-server');
  });

  it('should preserve test type flags', () => {
    const jsonOutput = JSON.stringify([
      {
        name: 'printsync',
        type: 'go-fullstack',
        path: '/path',
        tests: { unit: true, e2e: true, deployed_e2e: true },
      },
    ]);

    const modules = parseModuleList(jsonOutput);
    assert.strictEqual(modules[0].tests.unit, true);
    assert.strictEqual(modules[0].tests.e2e, true);
    assert.strictEqual(modules[0].tests.deployed_e2e, true);
  });

  it('should handle false test type flags', () => {
    const jsonOutput = JSON.stringify([
      {
        name: 'firebase-only',
        type: 'firebase',
        path: '/path',
        tests: { unit: false, e2e: true, deployed_e2e: true },
      },
    ]);

    const modules = parseModuleList(jsonOutput);
    assert.strictEqual(modules[0].tests.unit, false);
    assert.strictEqual(modules[0].tests.e2e, true);
  });
});

describe('Module List Formatter', () => {
  it('should format empty module list', () => {
    const formatted = formatModules([]);
    assert.ok(formatted.includes('Available Test Modules:'));
    assert.ok(formatted.includes('Total: 0 modules'));
  });

  it('should format single module', () => {
    const modules: ModuleInfo[] = [
      {
        name: 'printsync',
        type: 'go-fullstack',
        path: '/path/to/printsync',
        tests: { unit: true, e2e: true, deployed_e2e: true },
      },
    ];

    const formatted = formatModules(modules);
    assert.ok(formatted.includes('go-fullstack:'));
    assert.ok(formatted.includes('- printsync'));
    assert.ok(formatted.includes('Path: /path/to/printsync'));
    assert.ok(formatted.includes('Tests: unit, e2e, deployed-e2e'));
    assert.ok(formatted.includes('Total: 1 modules'));
  });

  it('should group modules by type', () => {
    const modules: ModuleInfo[] = [
      {
        name: 'printsync',
        type: 'go-fullstack',
        path: '/path1',
        tests: { unit: true, e2e: true, deployed_e2e: true },
      },
      {
        name: 'fellspiral',
        type: 'firebase',
        path: '/path2',
        tests: { unit: false, e2e: true, deployed_e2e: true },
      },
      {
        name: 'wiggum',
        type: 'mcp-server',
        path: '/path3',
        tests: { unit: true, e2e: false, deployed_e2e: false },
      },
    ];

    const formatted = formatModules(modules);
    assert.ok(formatted.includes('go-fullstack:'));
    assert.ok(formatted.includes('firebase:'));
    assert.ok(formatted.includes('mcp-server:'));
  });

  it('should handle modules with only some test types', () => {
    const modules: ModuleInfo[] = [
      {
        name: 'firebase-only',
        type: 'firebase',
        path: '/path',
        tests: { unit: false, e2e: true, deployed_e2e: true },
      },
    ];

    const formatted = formatModules(modules);
    assert.ok(formatted.includes('Tests: e2e, deployed-e2e'));
    assert.ok(!formatted.includes('unit'));
  });

  it('should handle module with only unit tests', () => {
    const modules: ModuleInfo[] = [
      {
        name: 'unit-only',
        type: 'go-package',
        path: '/path',
        tests: { unit: true, e2e: false, deployed_e2e: false },
      },
    ];

    const formatted = formatModules(modules);
    assert.ok(formatted.includes('Tests: unit'));
  });

  it('should display correct total count', () => {
    const modules: ModuleInfo[] = [
      {
        name: 'mod1',
        type: 'type1',
        path: '/path1',
        tests: { unit: true, e2e: false, deployed_e2e: false },
      },
      {
        name: 'mod2',
        type: 'type1',
        path: '/path2',
        tests: { unit: true, e2e: false, deployed_e2e: false },
      },
      {
        name: 'mod3',
        type: 'type2',
        path: '/path3',
        tests: { unit: false, e2e: true, deployed_e2e: false },
      },
    ];

    const formatted = formatModules(modules);
    assert.ok(formatted.includes('Total: 3 modules'));
  });

  it('should show modules under correct type grouping', () => {
    const modules: ModuleInfo[] = [
      {
        name: 'mod1',
        type: 'firebase',
        path: '/path1',
        tests: { unit: false, e2e: true, deployed_e2e: true },
      },
      {
        name: 'mod2',
        type: 'firebase',
        path: '/path2',
        tests: { unit: false, e2e: true, deployed_e2e: true },
      },
    ];

    const formatted = formatModules(modules);
    const lines = formatted.split('\n');

    // Find firebase section
    const firebaseIndex = lines.findIndex((line) => line === 'firebase:');
    assert.ok(firebaseIndex >= 0, 'Should have firebase section');

    // Check both modules appear after firebase heading
    const afterFirebase = lines.slice(firebaseIndex).join('\n');
    assert.ok(afterFirebase.includes('- mod1'));
    assert.ok(afterFirebase.includes('- mod2'));
  });
});

describe('Module Type Coverage', () => {
  it('should handle all known module types', () => {
    const moduleTypes = ['firebase', 'go-fullstack', 'go-tui', 'go-package', 'mcp-server'];

    moduleTypes.forEach((type) => {
      const modules: ModuleInfo[] = [
        {
          name: `test-${type}`,
          type: type,
          path: `/path/${type}`,
          tests: { unit: true, e2e: false, deployed_e2e: false },
        },
      ];

      const formatted = formatModules(modules);
      assert.ok(formatted.includes(`${type}:`));
      assert.ok(formatted.includes(`test-${type}`));
    });
  });
});

describe('Test Type Display', () => {
  it('should display test types in correct order', () => {
    const modules: ModuleInfo[] = [
      {
        name: 'all-tests',
        type: 'go-fullstack',
        path: '/path',
        tests: { unit: true, e2e: true, deployed_e2e: true },
      },
    ];

    const formatted = formatModules(modules);
    // Check order: unit, e2e, deployed-e2e
    const testsLine = formatted.split('\n').find((line) => line.includes('Tests:'));
    assert.ok(testsLine);
    assert.ok(testsLine.includes('unit, e2e, deployed-e2e'));
  });

  it('should use kebab-case for deployed_e2e', () => {
    const modules: ModuleInfo[] = [
      {
        name: 'test',
        type: 'firebase',
        path: '/path',
        tests: { unit: false, e2e: false, deployed_e2e: true },
      },
    ];

    const formatted = formatModules(modules);
    assert.ok(formatted.includes('deployed-e2e'));
    assert.ok(!formatted.includes('deployed_e2e'));
  });
});
