/**
 * Hosting Emulator Isolation Tests
 *
 * Verifies that the hosting emulator serves build artifacts from the correct
 * worktree when multiple worktrees run tests concurrently.
 *
 * Context:
 * - Each worktree uses relative paths (fellspiral/site/dist) in temporary Firebase config
 * - Multiple worktrees need separate hosting emulator instances on different ports
 * - Critical for multi-worktree isolation: data isolation (project ID) + build isolation (hosting)
 *
 * This prevents regressions where:
 * - Worktree A accidentally serves worktree B's build artifacts
 * - Hosting emulator config uses absolute paths (all worktrees serve same files)
 * - Relative path resolution breaks (hosting serves empty/404s)
 * - Tests pass/fail unpredictably based on which worktree's emulator started first
 */

import { test, expect } from '../../../playwright.fixtures.ts';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Hosting Emulator Isolation', () => {
  test('hosting emulator serves build from correct worktree', async ({ page, baseURL }) => {
    // Navigate to homepage
    await page.goto('/');

    // Verify page loads successfully (not 404 or empty)
    await expect(page).toHaveTitle(/Fellspiral/);

    // Extract asset hash from loaded page to verify we're getting THIS worktree's build
    // Each build generates unique content hashes in asset filenames (e.g., main-DM8Yqs_e.js)
    const content = await page.content();

    // Extract JS asset hash from script tag
    const jsAssetMatch = content.match(/\/assets\/main-([a-zA-Z0-9_-]+)\.js/);
    expect(jsAssetMatch, 'Page should contain hashed JS asset').not.toBeNull();
    const jsHash = jsAssetMatch[1];

    // Extract CSS asset hash from link tag
    const cssAssetMatch = content.match(/\/assets\/main-([a-zA-Z0-9_-]+)\.css/);
    expect(cssAssetMatch, 'Page should contain hashed CSS asset').not.toBeNull();
    const cssHash = cssAssetMatch[1];

    // Verify these hashes match the actual dist directory in THIS worktree
    // process.cwd() is the tests directory, go up to repo root
    const worktreeRoot = path.resolve(process.cwd(), '../..');
    const distIndexPath = path.join(worktreeRoot, 'fellspiral/site/dist/index.html');

    // Read the built index.html from THIS worktree's dist directory
    const distContent = fs.readFileSync(distIndexPath, 'utf-8');

    // Verify JS hash matches
    expect(
      distContent,
      `JS asset hash ${jsHash} should match THIS worktree's build in ${distIndexPath}`
    ).toContain(`/assets/main-${jsHash}.js`);

    // Verify CSS hash matches
    expect(
      distContent,
      `CSS asset hash ${cssHash} should match THIS worktree's build in ${distIndexPath}`
    ).toContain(`/assets/main-${cssHash}.css`);

    // Verify assets are actually loadable (not 404)
    const jsResponse = await page.goto(`/assets/main-${jsHash}.js`);
    expect(jsResponse.status(), 'JS asset should load successfully').toBe(200);

    const cssResponse = await page.goto(`/assets/main-${cssHash}.css`);
    expect(cssResponse.status(), 'CSS asset should load successfully').toBe(200);

    // Navigate back to homepage for cleanup
    await page.goto('/');
  });

  test('baseURL port matches HOSTING_PORT from THIS worktree', async ({ baseURL }) => {
    // Verify the hosting emulator is using the port allocated to THIS worktree
    const expectedPort = process.env.HOSTING_PORT;

    expect(expectedPort, 'HOSTING_PORT should be defined').toBeDefined();
    expect(baseURL, 'baseURL should contain worktree-specific HOSTING_PORT').toContain(
      `:${expectedPort}`
    );
  });

  // TODO(#1380): Test fails when reusing emulators - temp config only created on fresh start
  test.skip('temporary firebase config uses relative paths', async ({ page }) => {
    // Verify the temporary Firebase config (.firebase-PROJECT_ID.json) uses relative paths
    // This ensures each worktree resolves to its own dist directory
    const projectId = process.env.GCP_PROJECT_ID;
    // process.cwd() is the tests directory, go up to repo root
    const worktreeRoot = path.resolve(process.cwd(), '../..');

    expect(projectId, 'GCP_PROJECT_ID should be defined').toBeDefined();

    // Temp config is created in the repo root by start-emulators.sh
    const tempConfigPath = path.join(worktreeRoot, `.firebase-${projectId}.json`);

    // Check if temp config exists (it should be created by start-emulators.sh)
    const configExists = fs.existsSync(tempConfigPath);
    expect(configExists, `Temporary Firebase config should exist at ${tempConfigPath}`).toBe(true);

    if (configExists) {
      const configContent = fs.readFileSync(tempConfigPath, 'utf-8');
      const config = JSON.parse(configContent);

      // Verify hosting config uses relative path
      expect(config.hosting, 'Config should have hosting section').toBeDefined();
      expect(config.hosting.public, 'Hosting public path should be defined').toBeDefined();

      // Public path should be relative (not absolute)
      const publicPath = config.hosting.public;
      expect(publicPath, 'Public path should be relative (not start with /)').not.toMatch(/^\//);

      // Verify it resolves to the dist directory in THIS worktree
      const resolvedPath = path.resolve(path.dirname(tempConfigPath), publicPath);
      const expectedDistPath = path.join(worktreeRoot, 'fellspiral/site/dist');

      expect(
        resolvedPath,
        "Resolved public path should point to THIS worktree's dist directory"
      ).toBe(expectedDistPath);
    }

    // Verify hosting actually serves content (sanity check after config verification)
    await page.goto('/');
    await expect(page).toHaveTitle(/Fellspiral/);
  });

  test.skip('hosting serves 404 for non-existent files (not another worktree)', async ({
    page,
  }) => {
    // TODO(#1089): Test expects 404 but Firebase hosting rewrites all routes to /index.html (returns 200)
    // This is intentional SPA behavior per firebase.json rewrites config.
    // Need to rewrite test to verify isolation in a different way (e.g., check content hash, not HTTP status).

    // Verify hosting doesn't fall back to serving files from another worktree
    // Generate a unique filename that definitely doesn't exist
    const nonExistentFile = `/definitely-does-not-exist-${Date.now()}.html`;

    const response = await page.goto(nonExistentFile, { waitUntil: 'domcontentloaded' });

    // Should get 404, not content from another worktree
    expect(response.status(), 'Non-existent file should return 404').toBe(404);
  });
});
