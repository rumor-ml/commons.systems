/**
 * Fellspiral Playwright Test Server
 * Version: 1.4.0
 *
 * Fixes:
 * - Corrected test directory paths (/app/tests instead of /app/fellspiral/tests)
 * - Improved Cloud Run configuration (min-instances: 1, concurrency: 10)
 * - Added comprehensive logging for debugging 404 errors
 * - Set max-instances: 1 to prevent distributed state issues
 * - Added process spawn error handling and PID logging
 * - Enhanced stdout/stderr logging with prefixes
 * - Track server start time, process PID, and request count
 * - Log all incoming requests to detect server restarts
 */

import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Store test runs and their results
const testRuns = new Map();

// Track server start time to detect restarts
const serverStartTime = new Date().toISOString();
let requestCount = 0;
console.log(`[SERVER] ========================================`);
console.log(`[SERVER] Server started at: ${serverStartTime}`);
console.log(`[SERVER] Process PID: ${process.pid}`);
console.log(`[SERVER] ========================================`);

// Middleware
app.use(cors());
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
  requestCount++;
  console.log(`[SERVER] Request #${requestCount}: ${req.method} ${req.path} from ${req.ip}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.4.0',
    serverStartTime: serverStartTime,
    processUptime: Math.floor(process.uptime()),
    requestCount: requestCount,
    testRunsInMemory: testRuns.size,
    processPid: process.pid
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Fellspiral Playwright Test Server',
    version: '1.3.0',
    endpoints: {
      health: 'GET /health',
      runTests: 'POST /api/test',
      getTestStatus: 'GET /api/test/:id',
      getReport: 'GET /api/reports/:id',
      debug: 'GET /api/debug'
    }
  });
});

// Debug endpoint to see all test runs
app.get('/api/debug', (req, res) => {
  const testRunsArray = Array.from(testRuns.entries()).map(([id, run]) => ({
    id,
    status: run.status,
    startTime: run.startTime,
    endTime: run.endTime,
    exitCode: run.exitCode,
    outputLines: run.output.length,
    lastOutput: run.output.slice(-3),
    error: run.error
  }));

  res.json({
    totalRuns: testRuns.size,
    runs: testRunsArray
  });
});

// Run tests endpoint
app.post('/api/test', async (req, res) => {
  const testId = uuidv4();
  const {
    project = 'chromium',
    grep = null,
    testFile = null,
    headed = false,
    workers = 1,
    deployed = false,
    deployedUrl = null,
    site = 'fellspiral', // Default to fellspiral for backwards compatibility
    testsArchive = null // Base64-encoded tar.gz of tests directory
  } = req.body;

  console.log(`[SERVER] Creating test run: ${testId}, site: ${site}, workers: ${workers}, project: ${project}`);
  console.log(`[SERVER] Tests archive provided: ${testsArchive ? 'yes' : 'no'}`);
  console.log(`[SERVER] Current test runs in memory: ${testRuns.size}`);

  // Initialize test run status
  testRuns.set(testId, {
    id: testId,
    status: 'running',
    startTime: new Date().toISOString(),
    output: [],
    error: null,
    exitCode: null
  });

  console.log(`[SERVER] Test run ${testId} stored in memory. Total runs: ${testRuns.size}`);

  // Respond immediately with test ID
  res.json({
    testId,
    status: 'running',
    message: 'Test execution started',
    statusUrl: `/api/test/${testId}`
  });

  // Run tests asynchronously (extract tests if archive provided, then run)
  runPlaywrightTests(testId, { project, grep, testFile, headed, workers, deployed, deployedUrl, site, testsArchive });
});

// Get test status endpoint
app.get('/api/test/:id', (req, res) => {
  const testId = req.params.id;
  console.log(`[SERVER] Status check for test run: ${testId}`);
  console.log(`[SERVER] Total test runs in memory: ${testRuns.size}`);
  console.log(`[SERVER] Test run IDs in memory: ${Array.from(testRuns.keys()).join(', ')}`);

  const testRun = testRuns.get(testId);

  if (!testRun) {
    console.error(`[SERVER] ERROR: Test run ${testId} not found in memory!`);
    console.error(`[SERVER] Available test runs: ${Array.from(testRuns.keys()).join(', ') || 'none'}`);
    return res.status(404).json({ error: 'Test run not found' });
  }

  console.log(`[SERVER] Test run ${testId} found. Status: ${testRun.status}`);
  res.json(testRun);
});

// Get test report endpoint
app.get('/api/reports/:id', async (req, res) => {
  const testId = req.params.id;
  const testRun = testRuns.get(testId);

  if (!testRun) {
    return res.status(404).json({ error: 'Test run not found' });
  }

  if (testRun.status === 'running') {
    return res.status(202).json({
      message: 'Test still running',
      status: testRun.status
    });
  }

  // Try to read the JSON report
  const reportPath = path.join(__dirname, '../../tests/test-results/.last-run.json');

  try {
    if (existsSync(reportPath)) {
      const reportData = await fs.readFile(reportPath, 'utf-8');
      res.json({
        testId,
        report: JSON.parse(reportData),
        output: testRun.output
      });
    } else {
      res.json({
        testId,
        message: 'No report file found',
        output: testRun.output
      });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Failed to read report',
      message: error.message,
      output: testRun.output
    });
  }
});

// Function to run Playwright tests
async function runPlaywrightTests(testId, options) {
  const { project, grep, testFile, headed, workers, deployed, deployedUrl, site = 'fellspiral', testsArchive = null } = options;
  const testRun = testRuns.get(testId);

  let testsDir;

  // If tests archive is provided, extract it
  if (testsArchive) {
    try {
      console.log(`[${testId}] Extracting tests archive for site: ${site}`);

      // Create unique directory for this test run
      testsDir = path.join(__dirname, '../../tests', `${site}-${testId}`);
      await fs.mkdir(testsDir, { recursive: true });

      // Write base64-encoded archive to file
      const archivePath = path.join('/tmp', `tests-${testId}.tar.gz`);
      const archiveBuffer = Buffer.from(testsArchive, 'base64');
      await fs.writeFile(archivePath, archiveBuffer);
      console.log(`[${testId}] Archive written to: ${archivePath} (${archiveBuffer.length} bytes)`);

      // Extract archive
      console.log(`[${testId}] Extracting archive to: ${testsDir}`);
      await exec(`tar -xzf ${archivePath} -C ${testsDir}`);

      // Install dependencies
      console.log(`[${testId}] Installing test dependencies...`);
      const { stdout, stderr } = await exec('npm install', { cwd: testsDir });
      if (stdout) console.log(`[${testId}] npm install stdout: ${stdout}`);
      if (stderr) console.log(`[${testId}] npm install stderr: ${stderr}`);

      // Clean up archive file
      await fs.unlink(archivePath);
      console.log(`[${testId}] Tests extracted and dependencies installed`);
    } catch (error) {
      console.error(`[${testId}] Failed to extract tests:`, error);
      testRun.status = 'failed';
      testRun.error = `Failed to extract tests: ${error.message}`;
      testRun.exitCode = 1;
      testRun.endTime = new Date().toISOString();
      return;
    }
  } else {
    // Use pre-existing tests directory (for backwards compatibility)
    testsDir = path.join(__dirname, '../../tests', site);
  }

  // Build command arguments
  const args = ['test'];

  if (project) {
    args.push('--project', project);
  }

  if (grep) {
    args.push('--grep', grep);
  }

  if (testFile) {
    args.push(testFile);
  }

  if (headed) {
    args.push('--headed');
  }

  if (workers) {
    args.push('--workers', workers.toString());
  }

  // Always use JSON reporter for programmatic access
  args.push('--reporter=json,list');

  // Validate test directory exists
  if (!existsSync(testsDir)) {
    console.error(`[${testId}] Error: Test directory not found: ${testsDir}`);
    testRun.status = 'failed';
    testRun.error = `Test directory not found: ${testsDir}`;
    testRun.exitCode = 1;
    testRun.endTime = new Date().toISOString();
    return;
  }

  // Set environment variables
  const env = {
    ...process.env,
    CI: 'true' // Run in CI mode for better reporting
  };

  if (deployed) {
    env.DEPLOYED = 'true';
  }

  // Pass the deployed URL if provided
  if (deployedUrl) {
    env.DEPLOYED_URL = deployedUrl;
    console.log(`[${testId}] Using deployed URL: ${deployedUrl}`);
  }

  console.log(`[${testId}] Running Playwright tests for site: ${site}`);
  console.log(`[${testId}] Tests directory: ${testsDir}`);
  console.log(`[${testId}] Command: npx playwright ${args.join(' ')}`);

  const playwrightProcess = spawn('npx', ['playwright', ...args], {
    cwd: testsDir,
    env,
    shell: true
  });

  console.log(`[${testId}] Process spawned with PID: ${playwrightProcess.pid}`);

  // Handle spawn errors
  playwrightProcess.on('error', (err) => {
    console.error(`[${testId}] Failed to spawn process:`, err);
    testRun.error = err.message;
    testRun.status = 'failed';
    testRun.exitCode = -1;
    testRun.endTime = new Date().toISOString();
  });

  // Capture stdout
  playwrightProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[${testId}] STDOUT: ${output}`);
    testRun.output.push(output);
  });

  // Capture stderr
  playwrightProcess.stderr.on('data', (data) => {
    const output = data.toString();
    console.error(`[${testId}] STDERR: ${output}`);
    testRun.output.push(output);
  });

  // Handle process completion
  playwrightProcess.on('close', async (code) => {
    console.log(`[${testId}] Tests completed with exit code: ${code}`);

    testRun.status = code === 0 ? 'passed' : 'failed';
    testRun.exitCode = code;
    testRun.endTime = new Date().toISOString();

    // Try to save the JSON report
    try {
      const reportPath = path.join(testsDir, 'test-results/.last-run.json');
      const playwrightReportPath = path.join(testsDir, 'test-results/results.json');

      if (existsSync(playwrightReportPath)) {
        await fs.copyFile(playwrightReportPath, reportPath);
        console.log(`[${testId}] Report saved to ${reportPath}`);
      }
    } catch (error) {
      console.error(`[${testId}] Failed to save report:`, error);
      testRun.error = error.message;
    }

    // Clean up old test runs (keep only last 100)
    if (testRuns.size > 100) {
      const oldestKey = testRuns.keys().next().value;
      testRuns.delete(oldestKey);
    }
  });

  playwrightProcess.on('error', (error) => {
    console.error(`[${testId}] Failed to start tests:`, error);
    testRun.status = 'error';
    testRun.error = error.message;
    testRun.endTime = new Date().toISOString();
  });
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Playwright Test Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API info: http://localhost:${PORT}/api`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});
