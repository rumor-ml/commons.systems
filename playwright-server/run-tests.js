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

  // Pass DEPLOYED_URL from environment if set
  if (process.env.DEPLOYED_URL) {
    requestBody.deployedUrl = process.env.DEPLOYED_URL;
    console.log(`📍 Testing against: ${process.env.DEPLOYED_URL}`);
  }

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
    console.log(`   URL: ${SERVER_URL}/api/test`);
    console.log(`   Method: POST`);
    console.log(`   Body: ${JSON.stringify(requestBody)}`);

    const startResponse = await fetch(`${SERVER_URL}/api/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    }).catch(err => {
      console.error('❌ Fetch failed with error:');
      console.error(`   Error name: ${err.name}`);
      console.error(`   Error message: ${err.message}`);
      console.error(`   Error stack: ${err.stack}`);
      console.error(`   Server URL: ${SERVER_URL}`);
      throw new Error(`Network request failed: ${err.message}`);
    });

    console.log(`   Response status: ${startResponse.status} ${startResponse.statusText}`);

    if (!startResponse.ok) {
      const errorText = await startResponse.text().catch(() => 'Unable to read error response');
      console.error(`❌ Server returned error:`);
      console.error(`   Status: ${startResponse.status}`);
      console.error(`   Status text: ${startResponse.statusText}`);
      console.error(`   Response body: ${errorText}`);
      throw new Error(`Failed to start tests: ${startResponse.status} ${startResponse.statusText}`);
    }

    const startData = await startResponse.json();
    const testId = startData.testId;

    console.log(`✅ Test started with ID: ${testId}`);
    console.log('');

    // Poll for test completion
    let completed = false;
    let attempts = 0;
    const maxAttempts = 240; // 20 minutes max (5 second intervals)

    while (!completed && attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      const statusResponse = await fetch(`${SERVER_URL}/api/test/${testId}`);
      if (!statusResponse.ok) {
        throw new Error(`Failed to get test status: ${statusResponse.status}`);
      }

      const statusData = await statusResponse.json();

      // Print latest output with progress
      if (statusData.output && statusData.output.length > 0) {
        const newOutput = statusData.output.slice(-5); // Last 5 lines

        // Extract test progress from output
        const fullOutput = statusData.output.join('\n');
        const progressMatch = fullOutput.match(/✓\s+(\d+)\s+\[/g);
        const testCount = progressMatch ? progressMatch.length : 0;

        console.log(`⏳ Waiting for tests to complete... (${attempts * 5}s) - ${testCount} tests passed`);
        console.log('📄 Recent test output:');
        newOutput.forEach(line => console.log(line.trim()));
        console.log('');
      } else {
        console.log(`⏳ Waiting for tests to complete... (${attempts * 5}s)`);
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
    console.error('');
    console.error('═══════════════════════════════════════════');
    console.error('❌ ERROR RUNNING TESTS');
    console.error('═══════════════════════════════════════════');
    console.error('');
    console.error('Error details:');
    console.error(`  Name: ${error.name}`);
    console.error(`  Message: ${error.message}`);
    console.error('');
    if (error.stack) {
      console.error('Stack trace:');
      console.error(error.stack);
      console.error('');
    }
    console.error('Configuration:');
    console.error(`  Server URL: ${SERVER_URL}`);
    console.error(`  Project: ${values.project}`);
    console.error(`  Workers: ${values.workers}`);
    console.error('');
    console.error('Troubleshooting:');
    console.error('  1. Verify server is accessible:');
    console.error(`     curl ${SERVER_URL}/health`);
    console.error('  2. Check server is deployed and running');
    console.error('  3. Verify network connectivity to Cloud Run');
    console.error('  4. Check server logs for errors');
    console.error('');
    console.error('═══════════════════════════════════════════');
    process.exit(1);
  }
}

runTests();
