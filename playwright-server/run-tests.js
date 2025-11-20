#!/usr/bin/env node

/**
 * Client script to run Playwright tests via the remote server
 *
 * Usage:
 *   node run-tests.js [options]
 *
 * Environment Variables:
 *   PLAYWRIGHT_SERVER_URL - URL of the Playwright server (required)
 *
 * Options:
 *   --project <name>     - Browser project (chromium, firefox, webkit)
 *   --grep <pattern>     - Test name pattern to run
 *   --test-file <path>   - Specific test file to run
 *   --headed             - Run in headed mode
 *   --workers <n>        - Number of parallel workers
 *   --deployed           - Test deployed site instead of local
 */

import { parseArgs } from 'node:util';

const SERVER_URL = process.env.PLAYWRIGHT_SERVER_URL;

if (!SERVER_URL) {
  console.error('❌ Error: PLAYWRIGHT_SERVER_URL environment variable not set');
  console.error('');
  console.error('Example:');
  console.error('  export PLAYWRIGHT_SERVER_URL=https://playwright-server-xxx.run.app');
  console.error('  node run-tests.js --project chromium');
  process.exit(1);
}

// Parse command line arguments
const { values } = parseArgs({
  options: {
    project: {
      type: 'string',
      default: 'chromium'
    },
    grep: {
      type: 'string'
    },
    'test-file': {
      type: 'string'
    },
    headed: {
      type: 'boolean',
      default: false
    },
    workers: {
      type: 'string',
      default: '1'
    },
    deployed: {
      type: 'boolean',
      default: false
    }
  }
});

async function runTests() {
  console.log('🚀 Starting Playwright tests on remote server...');
  console.log(`📍 Server: ${SERVER_URL}`);
  console.log('');

  const requestBody = {
    project: values.project,
    headed: values.headed,
    workers: parseInt(values.workers),
    deployed: values.deployed
  };

  if (values.grep) {
    requestBody.grep = values.grep;
  }

  if (values['test-file']) {
    requestBody.testFile = values['test-file'];
  }

  console.log('📝 Test configuration:');
  console.log(JSON.stringify(requestBody, null, 2));
  console.log('');

  try {
    // Start the test run
    console.log('⏳ Sending test request...');
    const startResponse = await fetch(`${SERVER_URL}/api/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!startResponse.ok) {
      throw new Error(`Failed to start tests: ${startResponse.status} ${startResponse.statusText}`);
    }

    const startData = await startResponse.json();
    const testId = startData.testId;

    console.log(`✅ Test started with ID: ${testId}`);
    console.log('');

    // Poll for test completion
    let completed = false;
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes max (5 second intervals)

    while (!completed && attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      const statusResponse = await fetch(`${SERVER_URL}/api/test/${testId}`);
      if (!statusResponse.ok) {
        throw new Error(`Failed to get test status: ${statusResponse.status}`);
      }

      const statusData = await statusResponse.json();

      // Print latest output
      if (statusData.output && statusData.output.length > 0) {
        const newOutput = statusData.output.slice(-5); // Last 5 lines
        console.log('📄 Test output:');
        newOutput.forEach(line => console.log(line.trim()));
        console.log('');
      }

      if (statusData.status !== 'running') {
        completed = true;
        console.log(`🏁 Tests ${statusData.status}`);
        console.log(`⏱️  Duration: ${Math.round((new Date(statusData.endTime) - new Date(statusData.startTime)) / 1000)}s`);
        console.log('');

        // Get the full report
        console.log('📊 Fetching test report...');
        const reportResponse = await fetch(`${SERVER_URL}/api/reports/${testId}`);

        if (reportResponse.ok) {
          const reportData = await reportResponse.json();

          if (reportData.report) {
            console.log('');
            console.log('=== Test Results ===');
            console.log(`Total: ${reportData.report.suites?.length || 0} suites`);

            let totalTests = 0;
            let passedTests = 0;
            let failedTests = 0;

            if (reportData.report.suites) {
              reportData.report.suites.forEach(suite => {
                if (suite.specs) {
                  suite.specs.forEach(spec => {
                    totalTests++;
                    if (spec.ok) passedTests++;
                    else failedTests++;
                  });
                }
              });
            }

            console.log(`Passed: ${passedTests}`);
            console.log(`Failed: ${failedTests}`);
            console.log('');
          }

          // Print full output
          console.log('=== Full Test Output ===');
          reportData.output.forEach(line => console.log(line));
        }

        // Exit with appropriate code
        process.exit(statusData.exitCode || 0);
      } else {
        process.stdout.write(`⏳ Waiting for tests to complete... (${attempts * 5}s)\r`);
      }
    }

    if (!completed) {
      console.error('❌ Test execution timed out after 10 minutes');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error running tests:', error.message);
    process.exit(1);
  }
}

runTests();
