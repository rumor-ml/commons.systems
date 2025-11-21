/**
 * Playwright Secure CDP Proxy Server
 * Version: 2.0.0
 *
 * Provides authenticated access to Chrome DevTools Protocol (CDP) for remote Playwright tests.
 * Security features:
 * - Cloud Run IAM authentication via OIDC tokens
 * - Rate limiting per token
 * - Session management with auto-expiry
 * - Activity logging and suspicious command detection
 * - CDP exposed on localhost only, proxied with authentication
 */

import express from 'express';
import expressWs from 'express-ws';
import cors from 'cors';
import { chromium } from 'playwright';
import { OAuth2Client } from 'google-auth-library';
import WebSocket from 'ws';
import crypto from 'crypto';

const app = express();
expressWs(app);

const PORT = process.env.PORT || 8080;
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'chalanding';

// OAuth2 client for token validation
const oauth2Client = new OAuth2Client();

// Store active sessions and rate limits
const sessions = new Map();
const rateLimits = new Map();
const MAX_CONNECTIONS_PER_HOUR = 20;

// Track server start time
const serverStartTime = new Date().toISOString();
let requestCount = 0;
let cdpEndpoint = null;
let browserInstance = null;

console.log(`[SERVER] ========================================`);
console.log(`[SERVER] Server started at: ${serverStartTime}`);
console.log(`[SERVER] Process PID: ${process.pid}`);
console.log(`[SERVER] ========================================`);

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  requestCount++;
  console.log(`[SERVER] Request #${requestCount}: ${req.method} ${req.path} from ${req.ip}`);
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
    // Verify the token with Google's OAuth2 service
    // Accept tokens with this service's URL as audience
    const ticket = await oauth2Client.verifyIdToken({
      idToken: token,
      audience: `https://playwright-server-4yac44qrwa-uc.a.run.app`,
    });

    const payload = ticket.getPayload();

    console.log(`[AUTH] Token verified - email: ${payload.email}, aud: ${payload.aud}`);

    // Validate the token is from our project's service account
    if (!payload.email || !payload.email.includes(GCP_PROJECT_ID)) {
      console.warn(`[AUTH] Invalid service account: ${payload.email} (expected project: ${GCP_PROJECT_ID})`);
      return null;
    }

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
 * Check rate limit for a token
 */
function checkRateLimit(tokenId) {
  const now = Date.now();
  const hourAgo = now - 3600000; // 1 hour in ms

  if (!rateLimits.has(tokenId)) {
    rateLimits.set(tokenId, []);
  }

  const connections = rateLimits.get(tokenId);

  // Remove connections older than 1 hour
  const recentConnections = connections.filter(time => time > hourAgo);
  rateLimits.set(tokenId, recentConnections);

  if (recentConnections.length >= MAX_CONNECTIONS_PER_HOUR) {
    return false; // Rate limited
  }

  // Add this connection
  recentConnections.push(now);
  rateLimits.set(tokenId, recentConnections);

  return true; // Not rate limited
}

/**
 * Create a new session with auto-expiry
 */
function createSession(tokenInfo, cdpUrl) {
  const sessionId = crypto.randomUUID();
  const maxDuration = 10 * 60 * 1000; // 10 minutes

  const session = {
    id: sessionId,
    tokenEmail: tokenInfo.email,
    cdpUrl,
    startTime: Date.now(),
    maxDuration,
    activityLog: [],
    active: true
  };

  sessions.set(sessionId, session);

  // Auto-cleanup after max duration
  setTimeout(() => {
    const s = sessions.get(sessionId);
    if (s && s.active) {
      console.log(`[SESSION] Auto-expiring session ${sessionId}`);
      terminateSession(sessionId);
    }
  }, maxDuration);

  console.log(`[SESSION] Created ${sessionId} for ${tokenInfo.email} (expires in 10m)`);
  return session;
}

/**
 * Terminate a session
 */
function terminateSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.active = false;
    if (session.wsConnection) {
      session.wsConnection.close();
    }
    if (session.cdpConnection) {
      session.cdpConnection.close();
    }
    sessions.delete(sessionId);
    console.log(`[SESSION] Terminated ${sessionId}`);
  }
}

/**
 * Log activity and detect suspicious commands
 */
function logActivity(sessionId, direction, message) {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Try to parse as CDP message
  let messageData;
  try {
    messageData = typeof message === 'string' ? JSON.parse(message) : message;
  } catch {
    messageData = { raw: message };
  }

  const activity = {
    timestamp: Date.now(),
    direction,
    method: messageData.method,
    id: messageData.id
  };

  session.activityLog.push(activity);

  // Keep only last 100 activities per session
  if (session.activityLog.length > 100) {
    session.activityLog.shift();
  }

  // Detect suspicious commands
  if (isSuspicious(messageData)) {
    console.error(`[SECURITY] Suspicious command detected in session ${sessionId}:`, messageData.method);
    terminateSession(sessionId);
  }
}

/**
 * Detect dangerous CDP commands
 */
function isSuspicious(messageData) {
  if (!messageData.method) return false;

  // Block potentially dangerous commands
  const blockedCommands = [
    'Network.setCookie',
    'Network.clearBrowserCookies',
    'Network.deleteCookies',
    'Storage.clearDataForOrigin',
    'ServiceWorker.deliverPushMessage',
    'ServiceWorker.dispatchSyncEvent'
  ];

  return blockedCommands.includes(messageData.method);
}

/**
 * Launch Chrome with CDP on localhost
 */
async function launchBrowser() {
  if (browserInstance) {
    console.log('[BROWSER] Using existing browser instance');
    return cdpEndpoint;
  }

  console.log('[BROWSER] Launching Chrome with CDP...');

  browserInstance = await chromium.launch({
    headless: true,
    args: [
      '--remote-debugging-port=9222',
      '--remote-debugging-address=127.0.0.1', // localhost only!
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  // Get CDP endpoint URL
  cdpEndpoint = browserInstance._initializer.browserEndpoint;

  if (!cdpEndpoint) {
    // Fallback: construct CDP URL
    cdpEndpoint = 'ws://127.0.0.1:9222/devtools/browser';
  }

  console.log(`[BROWSER] Chrome launched with CDP endpoint: ${cdpEndpoint}`);

  // Handle browser close
  browserInstance.on('disconnected', () => {
    console.log('[BROWSER] Browser disconnected');
    browserInstance = null;
    cdpEndpoint = null;
  });

  return cdpEndpoint;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    serverStartTime: serverStartTime,
    processUptime: Math.floor(process.uptime()),
    requestCount: requestCount,
    activeSessions: sessions.size,
    browserActive: !!browserInstance,
    processPid: process.pid
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'Playwright Secure CDP Proxy',
    version: '2.0.0',
    description: 'Authenticated CDP proxy for remote Playwright tests',
    endpoints: {
      health: 'GET /health',
      cdpEndpoint: 'GET /api/cdp-endpoint (requires auth)',
      cdpProxy: 'WS /api/cdp (requires auth)'
    },
    security: {
      authentication: 'Google Cloud OIDC tokens',
      rateLimit: `${MAX_CONNECTIONS_PER_HOUR} connections per hour`,
      sessionTimeout: '10 minutes',
      cdpExposure: 'localhost only (proxied)'
    }
  });
});

/**
 * Get CDP endpoint (authenticated)
 */
app.get('/api/cdp-endpoint', async (req, res) => {
  // Validate token
  const tokenInfo = await validateToken(req.headers.authorization);
  if (!tokenInfo) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing token' });
  }

  // Check rate limit
  if (!checkRateLimit(tokenInfo.sub)) {
    return res.status(429).json({
      error: 'Rate limited',
      message: `Maximum ${MAX_CONNECTIONS_PER_HOUR} connections per hour exceeded`
    });
  }

  try {
    // Ensure browser is running
    const endpoint = await launchBrowser();

    // Create session
    const session = createSession(tokenInfo, endpoint);

    // Return CDP WebSocket URL (points to our proxy, not direct CDP)
    const proxyUrl = `wss://${req.get('host')}/api/cdp?session=${session.id}`;

    res.json({
      cdpUrl: proxyUrl,
      sessionId: session.id,
      expiresIn: '10m',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[ERROR] Failed to launch browser:', error);
    res.status(500).json({ error: 'Failed to launch browser', message: error.message });
  }
});

/**
 * WebSocket CDP Proxy (authenticated)
 */
app.ws('/api/cdp', async (ws, req) => {
  const sessionId = req.query.session;

  // Validate session
  const session = sessions.get(sessionId);
  if (!session || !session.active) {
    console.warn(`[PROXY] Invalid or expired session: ${sessionId}`);
    ws.close(1008, 'Invalid or expired session');
    return;
  }

  console.log(`[PROXY] WebSocket connection established for session ${sessionId}`);

  // Connect to local CDP
  let cdp;
  try {
    cdp = new WebSocket(session.cdpUrl);
  } catch (error) {
    console.error(`[PROXY] Failed to connect to CDP: ${error.message}`);
    ws.close(1011, 'Failed to connect to browser');
    return;
  }

  // Store connections in session
  session.wsConnection = ws;
  session.cdpConnection = cdp;

  // Forward messages from client to CDP
  ws.on('message', (message) => {
    if (!session.active) {
      ws.close(1000, 'Session expired');
      return;
    }

    logActivity(sessionId, 'client→cdp', message);

    if (cdp.readyState === WebSocket.OPEN) {
      cdp.send(message);
    }
  });

  // Forward messages from CDP to client
  cdp.on('message', (message) => {
    if (!session.active) {
      cdp.close();
      return;
    }

    logActivity(sessionId, 'cdp→client', message);

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });

  // Handle CDP connection open
  cdp.on('open', () => {
    console.log(`[PROXY] CDP connection open for session ${sessionId}`);
  });

  // Handle CDP errors
  cdp.on('error', (error) => {
    console.error(`[PROXY] CDP error for session ${sessionId}:`, error.message);
    ws.close(1011, 'CDP connection error');
    terminateSession(sessionId);
  });

  // Handle CDP close
  cdp.on('close', () => {
    console.log(`[PROXY] CDP connection closed for session ${sessionId}`);
    ws.close(1000, 'CDP connection closed');
  });

  // Handle client disconnect
  ws.on('close', () => {
    console.log(`[PROXY] Client disconnected from session ${sessionId}`);
    if (cdp.readyState === WebSocket.OPEN) {
      cdp.close();
    }
    terminateSession(sessionId);
  });

  // Handle client errors
  ws.on('error', (error) => {
    console.error(`[PROXY] Client error for session ${sessionId}:`, error.message);
    terminateSession(sessionId);
  });
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Playwright Secure CDP Proxy running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`API info: http://localhost:${PORT}/api`);

  // Pre-launch browser
  try {
    await launchBrowser();
    console.log('[SERVER] Browser pre-launched and ready');
  } catch (error) {
    console.error('[SERVER] Failed to pre-launch browser:', error);
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');

  // Close all sessions
  for (const [sessionId] of sessions) {
    terminateSession(sessionId);
  }

  // Close browser
  if (browserInstance) {
    await browserInstance.close();
  }

  process.exit(0);
});
