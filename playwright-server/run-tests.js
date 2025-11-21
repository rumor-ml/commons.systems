#!/usr/bin/env node

/**
 * DEPRECATED: Use PW_TEST_CONNECT_WS_ENDPOINT directly instead
 *
 * This script is kept for backwards compatibility but is no longer the
 * recommended way to run tests against the remote browser server.
 *
 * New standard approach:
 *   1. Get WebSocket endpoint: curl https://server/ws
 *   2. Run tests: PW_TEST_CONNECT_WS_ENDPOINT=<ws-url> npx playwright test
 *
 * This follows the standard Playwright remote browser pattern:
 * https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp
 */

console.warn('⚠️  WARNING: This script is deprecated');
console.warn('⚠️  Use PW_TEST_CONNECT_WS_ENDPOINT environment variable instead');
console.warn('');
console.warn('Example:');
console.warn('  WS_URL=$(curl -s https://playwright-server/ws | jq -r .wsEndpoint)');
console.warn('  PW_TEST_CONNECT_WS_ENDPOINT=$WS_URL npx playwright test');
console.warn('');

process.exit(1);
