# Playwright Remote Browser Server

A remote browser server for running Playwright tests with browsers in the cloud. This server runs as a containerized Cloud Run service on GCP and provides remote browser instances via WebSocket.

## Architecture

**Standard Playwright Remote Browser Pattern:**
- Tests run locally (in CI/CD or developer machine)
- Browsers run remotely (in Docker container on Cloud Run)
- Tests connect to remote browsers via WebSocket
- Follows official Playwright remote browser pattern

```
┌─────────────────┐        WebSocket         ┌──────────────────┐
│  GitHub Actions │  ───────────────────────> │  Browser Server  │
│  (tests here)   │   connect to browsers     │  (browsers only) │
└─────────────────┘                           └──────────────────┘
```

## Benefits

- **Simpler**: Tests run where code is already available (CI/CD)
- **Standard**: Uses official Playwright remote browser APIs
- **Scalable**: Cloud Run auto-scales browser capacity
- **Isolated**: Each site's tests naturally test only that site
- **Efficient**: No need to upload/bundle test code

## API Endpoints

### Health Check
```bash
GET /health
```

Returns server health status.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-20T12:00:00.000Z",
  "version": "2.0.0",
  "activeBrowsers": 1
}
```

### API Info
```bash
GET /api
```

Returns information about available endpoints and usage.

### Get Browser WebSocket Endpoint
```bash
GET /ws
```

Returns a WebSocket endpoint for connecting to remote browsers.

**Response:**
```json
{
  "wsEndpoint": "ws://localhost:35791/...",
  "browserType": "chromium",
  "timestamp": "2024-01-20T12:00:00.000Z"
}
```

## Usage

### In CI/CD (GitHub Actions)

```bash
#!/bin/bash
# Get WebSocket endpoint from browser server
WS_RESPONSE=$(curl -sf "https://playwright-server.run.app/ws")
WS_ENDPOINT=$(echo "$WS_RESPONSE" | jq -r '.wsEndpoint')

# Run tests locally, connecting to remote browser
cd mysite/tests
PW_TEST_CONNECT_WS_ENDPOINT="$WS_ENDPOINT" npx playwright test
```

### Locally (for testing)

```bash
# Start local browser server
npm run start

# In another terminal, run tests
WS_URL=$(curl -s http://localhost:8080/ws | jq -r .wsEndpoint)
cd ../mysite/tests
PW_TEST_CONNECT_WS_ENDPOINT=$WS_URL npx playwright test
```

## Environment Variables

- `PORT`: Server port (default: 8080)
- `NODE_ENV`: Environment (production/development)

## Test Configuration

Your Playwright tests will automatically connect to the remote browser when `PW_TEST_CONNECT_WS_ENDPOINT` is set:

```javascript
// playwright.config.js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // ... your config ...
  // No special config needed - Playwright automatically
  // uses PW_TEST_CONNECT_WS_ENDPOINT when set
});
```

## Deployment

The server is deployed to GCP Cloud Run via CI/CD:

```bash
# Build and deploy
./infrastructure/scripts/deploy-playwright-server.sh <commit-sha>
```

## Development

```bash
# Install dependencies
npm install

# Start server locally
npm run start

# Test health endpoint
curl http://localhost:8080/health

# Get WebSocket endpoint
curl http://localhost:8080/ws
```

## Version History

### 2.0.0 (Current)
- **Breaking**: Switched to standard Playwright remote browser pattern
- Tests now run locally, only browsers run remotely
- Simplified architecture following Playwright conventions
- Removed custom test execution API

### 1.x (Legacy)
- Custom test execution server
- Required uploading test code to server
- More complex architecture

## References

- [Playwright Remote Browser Documentation](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-server)
- [Playwright connectOverCDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
