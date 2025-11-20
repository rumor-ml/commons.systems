import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Store test runs and their results
const testRuns = new Map();

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Fellspiral Playwright Test Server',
    version: '1.0.0',
    endpoints: {
      health: 'GET /health',
      runTests: 'POST /api/test',
      getTestStatus: 'GET /api/test/:id',
      getReport: 'GET /api/reports/:id'
    }
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
    deployed = false
  } = req.body;

  // Initialize test run status
  testRuns.set(testId, {
    id: testId,
    status: 'running',
    startTime: new Date().toISOString(),
    output: [],
    error: null,
    exitCode: null
  });

  // Respond immediately with test ID
  res.json({
    testId,
    status: 'running',
    message: 'Test execution started',
    statusUrl: `/api/test/${testId}`
  });

  // Run tests asynchronously
  runPlaywrightTests(testId, { project, grep, testFile, headed, workers, deployed });
});

// Get test status endpoint
app.get('/api/test/:id', (req, res) => {
  const testId = req.params.id;
  const testRun = testRuns.get(testId);

  if (!testRun) {
    return res.status(404).json({ error: 'Test run not found' });
  }

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
  const { project, grep, testFile, headed, workers, deployed } = options;
  const testRun = testRuns.get(testId);

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

  const testsDir = path.join(__dirname, '../../tests');

  // Set environment variables
  const env = {
    ...process.env,
    CI: 'true' // Run in CI mode for better reporting
  };

  if (deployed) {
    env.DEPLOYED = 'true';
  }

  console.log(`[${testId}] Running Playwright tests in: ${testsDir}`);
  console.log(`[${testId}] Command: npx playwright ${args.join(' ')}`);

  const playwrightProcess = spawn('npx', ['playwright', ...args], {
    cwd: testsDir,
    env,
    shell: true
  });

  // Capture stdout
  playwrightProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[${testId}] ${output}`);
    testRun.output.push(output);
  });

  // Capture stderr
  playwrightProcess.stderr.on('data', (data) => {
    const output = data.toString();
    console.error(`[${testId}] ${output}`);
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
