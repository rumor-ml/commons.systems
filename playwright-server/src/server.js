/**
 * Playwright Browser Server with Authentication
 * Version: 3.0.0
 *
 * Provides authenticated access to Playwright browsers for remote test execution.
 * Uses Playwright's native browser server protocol (NOT CDP).
 */

import { chromium } from 'playwright';
import { OAuth2Client } from 'google-auth-library';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 8080;
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'chalanding';

// OAuth2 client for token validation
const oauth2Client = new OAuth2Client();

// Server state
const serverStartTime = new Date().toISOString();
let requestCount = 0;
let browserServer = null;
let wsEndpoint = null;

console.log(`[SERVER] ========================================`);
console.log(`[SERVER] Playwright Browser Server v3.0.0`);
console.log(`[SERVER] Started at: ${serverStartTime}`);
console.log(`[SERVER] Process PID: ${process.pid}`);
console.log(`[SERVER] ========================================`);

// Middleware
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  requestCount++;
  console.log(`[SERVER] Request #${requestCount}: ${req.method} ${req.path}`);
  next();
});

/**
 * Validate Google Cloud OIDC token
 */
async function validateToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);

  try {
    const ticket = await oauth2Client.verifyIdToken({
      idToken: token,
      audience: `https://playwright-server-4yac44qrwa-uc.a.run.app`,
    });

    const payload = ticket.getPayload();

    // Validate the token is from our project's service account
    if (!payload.email || !payload.email.includes(GCP_PROJECT_ID)) {
      console.warn(`[AUTH] Invalid service account: ${payload.email}`);
      return null;
    }

    console.log(`[AUTH] Token verified - email: ${payload.email}`);
    return {
      email: payload.email,
      sub: payload.sub,
      exp: payload.exp
    };
  } catch (error) {
    console.error(`[AUTH] Token validation failed: ${error.message}`);
    return null;
  }
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '3.0.0',
    serverStartTime,
    processUptime: Math.floor(process.uptime()),
    requestCount,
    browserActive: browserServer !== null,
    processPid: process.pid
  });
});

/**
 * Get browser server WebSocket endpoint (authenticated)
 */
app.get('/api/browser-endpoint', async (req, res) => {
  // Validate authentication
  const user = await validateToken(req.headers.authorization);
  if (!user) {
    console.warn(`[API] Unauthorized browser endpoint request`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!wsEndpoint) {
    console.error(`[API] Browser server not ready`);
    return res.status(503).json({ error: 'Browser server not ready' });
  }

  console.log(`[API] Providing browser endpoint to ${user.email}`);

  res.json({
    wsEndpoint,
    message: 'Connect using Playwright connectOptions.wsEndpoint'
  });
});

/**
 * Start Playwright browser server
 */
async function startBrowserServer() {
  try {
    console.log('[BROWSER] Launching Playwright browser server...');

    browserServer = await chromium.launchServer({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    wsEndpoint = browserServer.wsEndpoint();
    console.log(`[BROWSER] Browser server started successfully`);
    console.log(`[BROWSER] WebSocket endpoint: ${wsEndpoint}`);

  } catch (error) {
    console.error(`[BROWSER] Failed to start browser server: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function shutdown(signal) {
  console.log(`[SERVER] Received ${signal}, shutting down gracefully...`);

  if (browserServer) {
    console.log('[BROWSER] Closing browser server...');
    await browserServer.close();
  }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * Start server
 */
async function start() {
  // Start browser server first
  await startBrowserServer();

  // Then start HTTP server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] HTTP server listening on port ${PORT}`);
    console.log(`[SERVER] Ready to accept connections`);
  });
}

start().catch(error => {
  console.error('[SERVER] Fatal error:', error);
  process.exit(1);
});
