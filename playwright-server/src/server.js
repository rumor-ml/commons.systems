/**
 * Playwright Browser Server with Authentication and WebSocket Proxy
 * Version: 3.1.0
 *
 * Provides authenticated access to Playwright browsers for remote test execution.
 * Uses Playwright's native browser server with WebSocket proxying for public access.
 */

import crypto from 'crypto';
import { chromium } from 'playwright';
import { OAuth2Client } from 'google-auth-library';
import express from 'express';
import expressWs from 'express-ws';
import WebSocket from 'ws';

const PORT = process.env.PORT || 8080;
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'chalanding';
const AUDIENCE = process.env.PLAYWRIGHT_SERVER_URL || `https://playwright-server-4yac44qrwa-uc.a.run.app`;

// OAuth2 client for token validation
const oauth2Client = new OAuth2Client();

// Server state
const serverStartTime = new Date().toISOString();
let requestCount = 0;
let browserServer = null;
let wsEndpoint = null;

// Connection tokens for WebSocket authentication
// Maps connection token -> { email, exp }
const connectionTokens = new Map();
const CONNECTION_TOKEN_TTL = 60000; // 60 seconds

// Cleanup expired connection tokens every 30 seconds
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of connectionTokens.entries()) {
    if (data.exp < now) {
      connectionTokens.delete(token);
    }
  }
}, 30000);

console.log(`[SERVER] ========================================`);
console.log(`[SERVER] Playwright Browser Server v3.1.0`);
console.log(`[SERVER] Started at: ${serverStartTime}`);
console.log(`[SERVER] Process PID: ${process.pid}`);
console.log(`[SERVER] ========================================`);

// Set up Express with WebSocket support
const app = express();
const wsInstance = expressWs(app);

// Middleware
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  requestCount++;
  console.log(`[SERVER] Request #${requestCount}: ${req.method} ${req.path}`);
  next();
});

/**
 * Generate a short-lived connection token for WebSocket authentication
 */
function generateConnectionToken(email) {
  // Generate a random token using Node's crypto
  const token = crypto.randomBytes(32).toString('hex');

  const exp = Date.now() + CONNECTION_TOKEN_TTL;
  connectionTokens.set(token, { email, exp });

  return token;
}

/**
 * Validate a connection token
 */
function validateConnectionToken(token) {
  const data = connectionTokens.get(token);
  if (!data) {
    return null;
  }

  if (data.exp < Date.now()) {
    connectionTokens.delete(token);
    return null;
  }

  // Single use token - delete after validation
  connectionTokens.delete(token);
  return data;
}

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
      audience: AUDIENCE,
    });

    const payload = ticket.getPayload();

    // Validate the token is from our project's service account
    // Must match pattern: <service-account>@<project-id>.iam.gserviceaccount.com
    const validServiceAccountPattern = new RegExp(`^[a-z0-9-]+@${GCP_PROJECT_ID}\\.iam\\.gserviceaccount\\.com$`);
    if (!payload.email || !validServiceAccountPattern.test(payload.email)) {
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
    version: '3.1.0',
    serverStartTime,
    processUptime: Math.floor(process.uptime()),
    requestCount,
    browserActive: browserServer !== null,
    processPid: process.pid
  });
});

/**
 * Exchange OIDC token for short-lived connection token (authenticated)
 */
app.post('/api/ws-token', async (req, res) => {
  // Validate authentication
  const authHeader = req.headers.authorization;
  const user = await validateToken(authHeader);
  if (!user) {
    console.warn(`[API] Unauthorized token exchange request`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Generate connection token
  const connectionToken = generateConnectionToken(user.email);
  console.log(`[API] Generated connection token for ${user.email}`);

  res.json({
    token: connectionToken,
    expiresIn: CONNECTION_TOKEN_TTL / 1000, // seconds
    message: 'Use this token to connect to WebSocket endpoint'
  });
});

/**
 * Get browser server WebSocket endpoint (authenticated)
 */
app.get('/api/browser-endpoint', async (req, res) => {
  // Validate authentication
  const authHeader = req.headers.authorization;
  const user = await validateToken(authHeader);
  if (!user) {
    console.warn(`[API] Unauthorized browser endpoint request`);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!wsEndpoint) {
    console.error(`[API] Browser server not ready`);
    return res.status(503).json({ error: 'Browser server not ready' });
  }

  console.log(`[API] Providing browser endpoint to ${user.email}`);

  // Generate a connection token for WebSocket authentication
  const connectionToken = generateConnectionToken(user.email);

  // Construct public WebSocket URL using Cloud Run service URL
  const protocol = req.protocol === 'https' ? 'wss' : 'ws';
  const host = req.get('host');
  const publicWsEndpoint = `${protocol}://${host}/ws?token=${encodeURIComponent(connectionToken)}`;

  res.json({
    wsEndpoint: publicWsEndpoint,
    message: 'Connect using Playwright connectOptions.wsEndpoint',
    tokenExpiresIn: CONNECTION_TOKEN_TTL / 1000 // seconds
  });
});

/**
 * WebSocket proxy endpoint - proxies connections to local Playwright browser server
 */
app.ws('/ws', async (ws, req) => {
  console.log('[WS] New WebSocket connection request');

  // Validate authentication - connection token is in query parameter
  const token = req.query.token;
  if (!token) {
    console.warn('[WS] No token provided in WebSocket connection');
    ws.close(1008, 'Unauthorized - no token');
    return;
  }

  // Validate the connection token (short-lived, single-use)
  const user = validateConnectionToken(token);
  if (!user) {
    console.warn('[WS] Invalid or expired connection token');
    ws.close(1008, 'Unauthorized - invalid token');
    return;
  }

  if (!wsEndpoint) {
    console.error('[WS] Browser server not ready');
    ws.close(1011, 'Browser server not ready');
    return;
  }

  console.log(`[WS] Authenticated WebSocket connection from ${user.email}`);

  // Connect to local Playwright browser server
  const browserWs = new WebSocket(wsEndpoint);

  // Forward messages from client to browser
  ws.on('message', (data) => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data);
    }
  });

  // Forward messages from browser to client
  browserWs.on('message', (data) => {
    if (ws.readyState === 1) { // 1 = OPEN
      ws.send(data);
    }
  });

  // Handle browser connection open
  browserWs.on('open', () => {
    console.log('[WS] Connected to Playwright browser server');
  });

  // Handle errors
  browserWs.on('error', (error) => {
    console.error(`[WS] Browser WebSocket error: ${error.message}`);
    ws.close(1011, 'Browser connection error');
  });

  ws.on('error', (error) => {
    console.error(`[WS] Client WebSocket error: ${error.message}`);
    browserWs.close();
  });

  // Handle disconnections
  browserWs.on('close', (code, reason) => {
    console.log(`[WS] Browser WebSocket closed: ${code} - ${reason}`);
    ws.close(code, reason);
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] Client WebSocket closed: ${code} - ${reason}`);
    browserWs.close();
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
    console.log(`[BROWSER] Local WebSocket endpoint: ${wsEndpoint}`);
    console.log(`[BROWSER] Public connections will be proxied through /ws`);

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
