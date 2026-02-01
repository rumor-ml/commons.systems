// Playwright test to capture visual evidence of barrier crossing bug
// This test navigates to seed 12345 step 7 and captures detailed diagnostics

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test.describe('Seed 12345 Step 7 Barrier Crossing Analysis', () => {
  let consoleLogs = [];
  let consoleErrors = [];

  test.beforeEach(async ({ page }) => {
    // Capture all console messages
    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();

      const logEntry = {
        type,
        text,
        timestamp: new Date().toISOString(),
      };

      consoleLogs.push(logEntry);

      if (type === 'error') {
        consoleErrors.push(logEntry);
      }

      // Print to test output for visibility
      console.log(`[${type.toUpperCase()}] ${text}`);
    });

    // Capture page errors
    page.on('pageerror', (error) => {
      console.error('Page error:', error.message);
      consoleErrors.push({
        type: 'pageerror',
        text: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
    });
  });

  test('should analyze barrier state at step 7', async ({ page }) => {
    console.log('\n' + '='.repeat(80));
    console.log('STARTING VISUAL ANALYSIS: Seed 12345 Step 7');
    console.log('='.repeat(80) + '\n');

    // Navigate to the application
    await page.goto('http://localhost:5001');
    await page.waitForLoadState('networkidle');

    // Take initial screenshot
    await page.screenshot({
      path: 'test-results/00-initial-load.png',
      fullPage: true,
    });

    // Enter seed 12345
    console.log('\n--- Entering seed 12345 ---');
    await page.fill('input[type="text"]', '12345');
    await page.click('button:has-text("Apply")');

    // Wait for generator to initialize
    await page.waitForTimeout(500);
    await page.screenshot({
      path: 'test-results/01-seed-applied.png',
      fullPage: true,
    });

    console.log('\n--- Stepping through to step 7 ---');

    // Step forward 7 times, capturing state at each step
    for (let step = 1; step <= 7; step++) {
      console.log(`\n>>> Clicking forward to step ${step} <<<`);

      // Clear console logs for this step
      const stepStartIndex = consoleLogs.length;

      // Click forward
      await page.click('button:has-text("Forward")');
      await page.waitForTimeout(300); // Wait for rendering

      // Capture screenshot for this step
      await page.screenshot({
        path: `test-results/step-${step.toString().padStart(2, '0')}.png`,
        fullPage: true,
      });

      // Get step-specific console logs
      const stepLogs = consoleLogs.slice(stepStartIndex);

      console.log(`\nConsole logs for step ${step}:`);
      stepLogs.forEach((log) => {
        if (
          log.text.includes('[STEP') ||
          log.text.includes('[BARRIER') ||
          log.text.includes('[VALID MOVES]')
        ) {
          console.log(`  ${log.text}`);
        }
      });

      // Extract barrier information from page
      const barrierInfo = await page.evaluate(() => {
        // Access the generator instance
        // We need to check if there's a way to access it
        return {
          step: document.querySelector('.text-xl')?.textContent || 'Unknown',
          // We'll extract this from console logs instead
        };
      });

      console.log(`Step display: ${barrierInfo.step}`);
    }

    // After step 7, perform detailed analysis
    console.log('\n' + '='.repeat(80));
    console.log('STEP 7 DETAILED ANALYSIS');
    console.log('='.repeat(80) + '\n');

    // Get all barrier-related console logs
    const barrierLogs = consoleLogs.filter(
      (log) =>
        log.text.includes('[BARRIER') ||
        log.text.includes('CROSSING') ||
        log.text.includes('barrier')
    );

    console.log('\nAll barrier-related logs:');
    barrierLogs.forEach((log) => {
      console.log(`  [${log.type}] ${log.text}`);
    });

    // Extract barrier creation events
    const barrierCreated = consoleLogs.filter((log) => log.text.includes('[BARRIER CREATED]'));

    console.log('\n--- Barriers Created During Execution ---');
    barrierCreated.forEach((log) => {
      console.log(`  ${log.text}`);
    });

    // Extract barrier check events
    const barrierChecks = consoleLogs.filter((log) => log.text.includes('[BARRIER CHECK'));

    console.log('\n--- Barrier Checks During Movement ---');
    barrierChecks.forEach((log) => {
      console.log(`  ${log.text}`);
    });

    // Check for barrier crossing errors
    const crossingErrors = consoleLogs.filter(
      (log) =>
        log.text.includes('BARRIER CROSSING') ||
        log.text.includes('BARRIER CREATED ON TRAVERSED EDGE')
    );

    console.log('\n--- Barrier Crossing Errors ---');
    if (crossingErrors.length > 0) {
      console.log('  ✗ ERRORS DETECTED:');
      crossingErrors.forEach((log) => {
        console.log(`    ${log.text}`);
      });
    } else {
      console.log('  ✓ No barrier crossing errors detected');
    }

    // Extract step 7 specific logs
    const step7Logs = consoleLogs.filter((log) => log.text.includes('[STEP 7]'));

    console.log('\n--- Step 7 Specific Logs ---');
    step7Logs.forEach((log) => {
      console.log(`  ${log.text}`);
    });

    // Try to extract barrier crossings count from console
    const crossingCountLogs = consoleLogs.filter((log) => log.text.includes('barrier crossings'));

    console.log('\n--- Barrier Crossing Counter ---');
    if (crossingCountLogs.length > 0) {
      crossingCountLogs.forEach((log) => {
        console.log(`  ${log.text}`);
      });
    }

    // Take a final zoomed screenshot focusing on the explorer
    await page.screenshot({
      path: 'test-results/step-07-final.png',
      fullPage: true,
    });

    // Save all console logs to a file
    const logOutput = {
      totalLogs: consoleLogs.length,
      errors: consoleErrors.length,
      barrierCreated: barrierCreated.length,
      barrierChecks: barrierChecks.length,
      crossingErrors: crossingErrors.length,
      allLogs: consoleLogs,
      summary: {
        step7Logs,
        barrierCreated,
        barrierChecks,
        crossingErrors,
      },
    };

    fs.writeFileSync('test-results/console-logs.json', JSON.stringify(logOutput, null, 2));

    console.log('\n' + '='.repeat(80));
    console.log('ANALYSIS COMPLETE');
    console.log('='.repeat(80));
    console.log(`Total console messages: ${consoleLogs.length}`);
    console.log(`Console errors: ${consoleErrors.length}`);
    console.log(`Barriers created: ${barrierCreated.length}`);
    console.log(`Barrier checks: ${barrierChecks.length}`);
    console.log(`Crossing errors: ${crossingErrors.length}`);
    console.log('\nScreenshots saved to test-results/');
    console.log('Console logs saved to test-results/console-logs.json');
    console.log('='.repeat(80) + '\n');

    // Assertions
    expect(consoleErrors.length).toBe(0);
    expect(crossingErrors.length).toBe(0);
  });

  test.skip('should verify visual display matches logic - seed 12345 step 7', async ({
    page,
    context,
  }) => {
    // SKIPPED: Test expects "Barrier Crossings" UI feature that hasn't been implemented yet
    console.log('\n--- Visual Verification with Fresh Browser ---\n');

    // Force hard reload by clearing cache
    await context.clearCookies();

    await page.goto('http://localhost:5001', {
      waitUntil: 'networkidle',
    });

    // Force hard reload
    await page.reload({ waitUntil: 'networkidle' });

    console.log('Browser loaded with fresh cache');

    // Setup seed 12345
    await page.fill('input[type="text"]', '12345');
    await page.click('button:has-text("Apply")');
    await page.waitForTimeout(1000);

    console.log('Seed 12345 applied');

    // Take screenshot at step 0
    await page.screenshot({
      path: 'test-results/fresh-step-00.png',
      fullPage: true,
    });

    // Go to step 7
    await page.fill('input[type="number"][placeholder]', '7');
    await page.click('button:has-text("Go")');
    await page.waitForTimeout(1000);

    console.log('Navigated to step 7');

    // Take final screenshot
    await page.screenshot({
      path: 'test-results/fresh-step-07-final.png',
      fullPage: true,
    });

    // Check the barrier crossings counter display
    const barrierCountText = await page.locator('text=/Barrier Crossings/i').textContent();
    console.log('Barrier counter display:', barrierCountText);

    // Verify current position shows (-3,3)
    const positionText = await page.locator('text=/Coordinates:/i').textContent();
    console.log('Position display:', positionText);

    // Expect barrier crossings to be 0
    expect(barrierCountText).toMatch(/0/);

    // Expect position to be (-3,3)
    expect(positionText).toMatch(/-3.*3/);

    // Inject visualization code to highlight the hexes and barriers
    await page.evaluate(() => {
      console.log('=== HEX AND BARRIER VERIFICATION ===');
      console.log('Looking for hexes (-3,2) and (-3,3) in the generator...');

      // Try to access the generator from window
      // (This won't work in React but we can check console)
    });

    console.log('\n✓ Visual verification complete - screenshots saved');
    console.log('  - fresh-step-00.png: Initial state');
    console.log('  - fresh-step-07-final.png: After step 7');
    console.log(`  - Barrier counter shows: ${barrierCountText}`);
    console.log(`  - Position shows: ${positionText}`);
  });
});
