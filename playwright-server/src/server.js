/**
 * Playwright Remote Browser Server
 * Version: 2.0.0
 *
 * Provides remote browser instances via WebSocket for Playwright tests.
 * Tests run locally (in CI/CD) and connect to browsers on this server.
 *
 * This follows the standard Playwright remote browser pattern:
 * https://playwright.dev/docs/api/class-browsertype#browser-type-launch-server
 */

import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';

const app = express();
const PORT = process.env.PORT || 8080;

// Store active browser servers
const browserServers = new Map();

// Track server start time
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
    version: '2.0.0',
    serverStartTime: serverStartTime,
    processUptime: Math.floor(process.uptime()),
    requestCount: requestCount,
    activeBrowsers: browserServers.size,
    processPid: process.pid
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Playwright Remote Browser Server',
    version: '2.0.0',
    description: 'Provides remote browser instances via WebSocket',
    endpoints: {
      health: 'GET /health',
      getBrowserEndpoint: 'GET /ws'
    },
    usage: {
      description: 'Tests run locally and connect to browsers on this server',
      example: 'PW_TEST_CONNECT_WS_ENDPOINT=<ws-url> npx playwright test'
    }
  });
});

// Get or create browser WebSocket endpoint
app.get('/ws', async (req, res) => {
  try {
    // Use a shared browser server for all connections
    const browserKey = 'shared-chromium';

    let browserServer = browserServers.get(browserKey);

    // Launch new browser server if needed
    if (!browserServer || !browserServer.wsEndpoint()) {
      console.log(`[SERVER] Launching new browser server...`);

      browserServer = await chromium.launchServer({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled'
        ]
      });

      browserServers.set(browserKey, browserServer);

      console.log(`[SERVER] Browser server launched`);
      console.log(`[SERVER] WebSocket endpoint: ${browserServer.wsEndpoint()}`);

      // Clean up on server close
      browserServer.on('close', () => {
        console.log(`[SERVER] Browser server closed`);
        browserServers.delete(browserKey);
      });
    }

    res.json({
      wsEndpoint: browserServer.wsEndpoint(),
      browserType: 'chromium',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`[SERVER] Failed to launch browser:`, error);
    res.status(500).json({
      error: 'Failed to launch browser',
      message: error.message
    });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Playwright Browser Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API info: http://localhost:${PORT}/api`);
  console.log(`WebSocket endpoint: http://localhost:${PORT}/ws`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');

  // Close all browser servers
  for (const [key, browserServer] of browserServers.entries()) {
    console.log(`Closing browser server: ${key}`);
    await browserServer.close();
  }

  process.exit(0);
});
