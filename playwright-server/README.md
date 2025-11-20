# Playwright Test Server

A remote Playwright test execution server for running browser tests when local execution isn't available. This server runs as a containerized Cloud Run service on GCP and provides a REST API for triggering test runs.

## Architecture

- **Express.js API Server**: REST endpoints for test execution
- **Docker Container**: Pre-built with Playwright browsers (Chromium, Firefox, WebKit)
- **GCP Cloud Run**: Serverless deployment with auto-scaling
- **Test Execution**: Runs Fellspiral E2E tests on demand

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
  "version": "1.0.0"
}
```

### API Info
```bash
GET /api
```

Returns information about available endpoints.

### Run Tests
```bash
POST /api/test
```

Starts a test run and returns a test ID for tracking.

**Request Body:**
```json
{
  "project": "chromium",        // Browser: chromium, firefox, webkit (default: chromium)
  "grep": "homepage",           // Optional: Test name pattern
  "testFile": "homepage.spec.js", // Optional: Specific test file
  "headed": false,              // Run in headed mode (default: false)
  "workers": 1,                 // Number of parallel workers (default: 1)
  "deployed": false             // Test deployed site vs local (default: false)
}
```

**Response:**
```json
{
  "testId": "uuid-here",
  "status": "running",
  "message": "Test execution started",
  "statusUrl": "/api/test/uuid-here"
}
```

### Get Test Status
```bash
GET /api/test/:id
```

Returns the current status of a test run.

**Response:**
```json
{
  "id": "uuid-here",
  "status": "running|passed|failed|error",
  "startTime": "2024-01-20T12:00:00.000Z",
  "endTime": "2024-01-20T12:05:00.000Z",
  "output": ["...test output lines..."],
  "error": null,
  "exitCode": 0
}
```

### Get Test Report
```bash
GET /api/reports/:id
```

Returns the full test report with results.

**Response:**
```json
{
  "testId": "uuid-here",
  "report": {
    "suites": [...],
    "specs": [...]
  },
  "output": ["...complete test output..."]
}
```

## Deployment

### Prerequisites

1. **GCP Project** with billing enabled
2. **Terraform** for infrastructure provisioning
3. **GitHub Actions** configured with Workload Identity

### Initial Infrastructure Setup

1. Deploy the infrastructure:
```bash
cd infrastructure/terraform
terraform init
terraform apply
```

This creates:
- Cloud Run service
- Artifact Registry repository
- Service accounts and IAM bindings

2. **Automatic Deployment**: The server deployment workflow automatically runs after the infrastructure workflow completes successfully. When you push infrastructure changes to `main`, the deployment workflow will trigger automatically.

3. **Manual Deployment**: You can also trigger deployment manually via GitHub Actions → Deploy Playwright Server → Run workflow.

### Manual Deployment

Build and push the Docker image:
```bash
# Authenticate with GCP
gcloud auth configure-docker us-central1-docker.pkg.dev

# Build the image
docker build -t us-central1-docker.pkg.dev/YOUR_PROJECT/playwright-server/playwright-server:latest \
  -f fellspiral/playwright-server/Dockerfile .

# Push to Artifact Registry
docker push us-central1-docker.pkg.dev/YOUR_PROJECT/playwright-server/playwright-server:latest

# Deploy to Cloud Run
gcloud run deploy playwright-server \
  --image us-central1-docker.pkg.dev/YOUR_PROJECT/playwright-server/playwright-server:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --timeout 900 \
  --cpu 2 \
  --memory 4Gi \
  --min-instances 0 \
  --max-instances 1
```

## Usage

### Using the Client Script

1. Get the server URL:
```bash
gcloud run services describe playwright-server \
  --region us-central1 \
  --format 'value(status.url)'
```

2. Set the environment variable:
```bash
export PLAYWRIGHT_SERVER_URL=https://playwright-server-xxxxx.run.app
```

3. Run tests:
```bash
# Run all Chromium tests
./fellspiral/playwright-server/run-tests.sh

# Run specific test file
./fellspiral/playwright-server/run-tests.sh --test-file e2e/homepage.spec.js

# Run with grep pattern
./fellspiral/playwright-server/run-tests.sh --grep "homepage"

# Run on different browser
./fellspiral/playwright-server/run-tests.sh --project firefox

# Test deployed site
./fellspiral/playwright-server/run-tests.sh --deployed

# Run with more workers
./fellspiral/playwright-server/run-tests.sh --workers 4
```

### Using curl

```bash
# Start a test run
TEST_ID=$(curl -X POST https://your-server.run.app/api/test \
  -H "Content-Type: application/json" \
  -d '{"project":"chromium"}' \
  | jq -r '.testId')

# Check status
curl https://your-server.run.app/api/test/$TEST_ID | jq

# Get report
curl https://your-server.run.app/api/reports/$TEST_ID | jq
```

### Using Node.js directly

```javascript
const response = await fetch(`${SERVER_URL}/api/test`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    project: 'chromium',
    grep: 'homepage'
  })
});

const { testId } = await response.json();

// Poll for completion
const statusResponse = await fetch(`${SERVER_URL}/api/test/${testId}`);
const status = await statusResponse.json();
```

## Local Development

Run the server locally with Docker:

```bash
# Build and run
./fellspiral/playwright-server/build-and-run.sh

# Or manually
docker build -t playwright-server:local -f fellspiral/playwright-server/Dockerfile .
docker run -p 8080:8080 playwright-server:local
```

Test locally:
```bash
export PLAYWRIGHT_SERVER_URL=http://localhost:8080
./fellspiral/playwright-server/run-tests.sh
```

## Configuration

### Environment Variables

- `NODE_ENV`: Environment (production/development)
- `PORT`: Server port (default: 8080)

### Cloud Run Settings

- **Timeout**: 15 minutes (900s) - allows long-running tests
- **CPU**: 2 cores - needed for browser rendering
- **Memory**: 4GB - Playwright browsers are memory-intensive
- **Concurrency**: Default (80) - handles multiple sequential test requests
- **Min Instances**: 0 - scales to zero when not in use (cost-effective)
- **Max Instances**: 1 - single instance for cost optimization

## Cost Optimization

The server is designed to minimize costs:

1. **Scales to zero**: No cost when not running tests
2. **On-demand execution**: Only runs when requested
3. **Automatic cleanup**: Old test results are pruned (keeps last 100)
4. **Efficient caching**: Docker layers and dependencies are cached

Estimated cost: ~$0.50-$2.00/month with moderate usage (10-50 test runs/day)

## Monitoring

View logs:
```bash
gcloud run services logs read playwright-server --region us-central1
```

View metrics:
```bash
gcloud run services describe playwright-server --region us-central1
```

## Troubleshooting

### Tests fail to start

- Check server logs: `gcloud run services logs read playwright-server`
- Verify Cloud Run service is running: `gcloud run services list`
- Check memory/CPU limits aren't being exceeded

### Timeout errors

- Tests take too long (>15 min timeout)
- Increase `--workers` to parallelize
- Use `--grep` to run specific tests
- Consider splitting into multiple test runs

### Browser crashes

- Increase memory allocation in Cloud Run
- Reduce parallel workers
- Check for memory-intensive tests

## Security

- **Public Access**: Server is publicly accessible (no authentication)
- **Rate Limiting**: Consider adding rate limiting for production
- **CORS**: Enabled for all origins
- **Data Privacy**: Test results stored temporarily in memory (not persisted)

For production use, consider:
- Adding API key authentication
- Implementing rate limiting
- Using Cloud Armor for DDoS protection
- Setting up VPC connector for private access

## CI/CD Integration

### Workflow Dependencies

The Playwright server deployment workflow runs **after** the infrastructure workflow completes:

1. **Infrastructure Workflow** (`infrastructure.yml`) runs when:
   - Changes are pushed to `main`
   - Manually triggered via `workflow_dispatch`

2. **Deployment Workflow** (`deploy-playwright-server.yml`) runs when:
   - Infrastructure workflow completes successfully
   - Manually triggered via `workflow_dispatch`

This ensures the Artifact Registry and IAM permissions are created before attempting to deploy.

### Deployment Process

1. Infrastructure workflow applies Terraform changes (creates registry, permissions, etc.)
2. Deployment workflow automatically triggers after infrastructure succeeds
3. Docker image is built with a snapshot of:
   - Playwright server code
   - Fellspiral tests
   - Fellspiral site (built version)
4. Image is pushed to Artifact Registry
5. Cloud Run service is deployed/updated

**Note**: The Docker image includes a snapshot of the tests and site at build time. To update tests or site code in the server, manually trigger the infrastructure workflow (which will then trigger deployment) or use `workflow_dispatch` on the deployment workflow.

## Architecture Diagram

```
┌─────────────────┐
│  Claude / User  │
└────────┬────────┘
         │
         │ HTTP POST /api/test
         ▼
┌─────────────────────────┐
│  Playwright Server      │
│  (Cloud Run)            │
│  ┌───────────────────┐  │
│  │ Express.js API    │  │
│  └─────────┬─────────┘  │
│            │            │
│  ┌─────────▼─────────┐  │
│  │ Playwright Runner │  │
│  │ - Chromium        │  │
│  │ - Firefox         │  │
│  │ - WebKit          │  │
│  └─────────┬─────────┘  │
│            │            │
│  ┌─────────▼─────────┐  │
│  │ Fellspiral Tests  │  │
│  │ (8 test suites)   │  │
│  └───────────────────┘  │
└─────────────────────────┘
```

## Contributing

When making changes:

1. Update the server code in `src/server.js`
2. Test locally with Docker
3. Update documentation if API changes
4. Push to trigger automatic deployment

## License

MIT
