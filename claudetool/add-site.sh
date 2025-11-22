#!/bin/bash
# Add a new site to the monorepo
# Usage: ./claudetool/add-site.sh <site-name>

set -e

SITE_NAME="${1}"

if [ -z "$SITE_NAME" ]; then
  echo "Error: Site name is required"
  echo "Usage: $0 <site-name>"
  echo "Example: $0 myblog"
  exit 1
fi

# Validate site name (lowercase, alphanumeric, hyphens only)
if ! echo "$SITE_NAME" | grep -qE '^[a-z][a-z0-9-]*$'; then
  echo "Error: Site name must start with a letter and contain only lowercase letters, numbers, and hyphens"
  exit 1
fi

# Check if site already exists
if [ -d "$SITE_NAME" ]; then
  echo "Error: Directory $SITE_NAME already exists"
  exit 1
fi

echo "=== Adding new site: $SITE_NAME ==="
echo ""

# ==================== Step 1: Create directory structure ====================
echo "Step 1/6: Creating directory structure..."

mkdir -p "$SITE_NAME/site/src"
mkdir -p "$SITE_NAME/tests"

echo "✓ Created directories"

# ==================== Step 2: Create site boilerplate ====================
echo "Step 2/6: Creating site boilerplate..."

# Create site package.json
cat > "$SITE_NAME/site/package.json" <<EOF
{
  "name": "@commons/${SITE_NAME}-site",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
EOF

# Create basic index.html
cat > "$SITE_NAME/site/src/index.html" <<EOF
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${SITE_NAME^}</title>
  <link rel="stylesheet" href="./styles/main.css">
</head>
<body>
  <div id="app">
    <h1>Welcome to ${SITE_NAME^}</h1>
    <p>This site is under construction.</p>
  </div>
  <script type="module" src="./scripts/main.js"></script>
</body>
</html>
EOF

# Create basic CSS
mkdir -p "$SITE_NAME/site/src/styles"
cat > "$SITE_NAME/site/src/styles/main.css" <<EOF
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  line-height: 1.6;
  padding: 2rem;
}

#app {
  max-width: 800px;
  margin: 0 auto;
}

h1 {
  margin-bottom: 1rem;
  color: #333;
}
EOF

# Create basic JavaScript
mkdir -p "$SITE_NAME/site/src/scripts"
cat > "$SITE_NAME/site/src/scripts/main.js" <<EOF
console.log('${SITE_NAME^} is ready!');

// Add your application logic here
EOF

# Create vite.config.js
cat > "$SITE_NAME/site/vite.config.js" <<EOF
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: 3000,
    open: true
  }
});
EOF

# Create Dockerfile
cat > "$SITE_NAME/site/Dockerfile" <<EOF
FROM nginx:alpine

# Copy built files to nginx
COPY dist /usr/share/nginx/html

# Create health check endpoint
RUN echo '<!DOCTYPE html><html><body>OK</body></html>' > /usr/share/nginx/html/health

# Expose port
EXPOSE 8080

# Configure nginx to listen on port 8080 (Cloud Run requirement)
RUN sed -i 's/listen       80;/listen       8080;/' /etc/nginx/conf.d/default.conf

CMD ["nginx", "-g", "daemon off;"]
EOF

# Create .gitignore
cat > "$SITE_NAME/site/.gitignore" <<EOF
node_modules
dist
.DS_Store
EOF

echo "✓ Created site boilerplate"

# ==================== Step 3: Create tests boilerplate ====================
echo "Step 3/6: Creating tests boilerplate..."

# Create tests package.json
cat > "$SITE_NAME/tests/package.json" <<EOF
{
  "name": "@commons/${SITE_NAME}-tests",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "test:deployed": "DEPLOYED=true playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.40.0"
  }
}
EOF

# Create playwright.config.js
cat > "$SITE_NAME/tests/playwright.config.js" <<EOF
import { defineConfig, devices } from '@playwright/test';

const isDeployed = process.env.DEPLOYED === 'true';
const baseURL = isDeployed
  ? process.env.DEPLOYED_URL
  : 'http://localhost:3000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: isDeployed ? undefined : {
    command: 'npm run dev --workspace=${SITE_NAME}/site',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
EOF

# Create sample test
mkdir -p "$SITE_NAME/tests/tests"
cat > "$SITE_NAME/tests/tests/basic.spec.js" <<EOF
import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Welcome to ${SITE_NAME^}');
});

test('health check endpoint', async ({ page }) => {
  const response = await page.goto('/health');
  expect(response.status()).toBe(200);
});
EOF

echo "✓ Created tests boilerplate"

# ==================== Step 4: Update package.json workspaces ====================
echo "Step 4/6: Updating root package.json..."

# Add workspace to package.json
if ! grep -q "\"${SITE_NAME}/site\"" package.json; then
  # Use jq if available, otherwise use sed
  if command -v jq &> /dev/null; then
    jq ".workspaces += [\"${SITE_NAME}/site\", \"${SITE_NAME}/tests\"]" package.json > package.json.tmp
    mv package.json.tmp package.json
  else
    # Fallback: manual addition (requires workspaces array to exist)
    sed -i "s|\"fellspiral/tests\"|\"fellspiral/tests\",\n    \"${SITE_NAME}/site\",\n    \"${SITE_NAME}/tests\"|" package.json
  fi
  echo "✓ Updated package.json workspaces"
else
  echo "✓ Workspace already exists in package.json"
fi

# Add npm scripts
if command -v jq &> /dev/null; then
  jq ".scripts[\"dev:${SITE_NAME}\"] = \"npm run dev --workspace=${SITE_NAME}/site\" | \
      .scripts[\"build:${SITE_NAME}\"] = \"npm run build --workspace=${SITE_NAME}/site\" | \
      .scripts[\"test:${SITE_NAME}\"] = \"npm test --workspace=${SITE_NAME}/tests\" | \
      .scripts[\"test:${SITE_NAME}:deployed\"] = \"npm run test:deployed --workspace=${SITE_NAME}/tests\"" \
    package.json > package.json.tmp
  mv package.json.tmp package.json
  echo "✓ Added npm scripts to package.json"
fi

# ==================== Step 5: Create manual deploy workflow ====================
echo "Step 5/6: Creating manual deploy workflow..."

cat > ".github/workflows/deploy-${SITE_NAME}-manual.yml" <<'WORKFLOW_EOF'
name: Manual Deploy - SITE_NAME_CAPITALIZED

on:
  workflow_dispatch:
    inputs:
      branch:
        description: 'Branch to deploy'
        required: true
        default: 'main'
        type: string
      skip_tests:
        description: 'Skip tests (use with caution)'
        required: false
        default: false
        type: boolean

env:
  GCP_PROJECT_ID: chalanding
  GCP_REGION: us-central1
  SITE_NAME: SITE_NAME_PLACEHOLDER

permissions:
  contents: write
  id-token: write
  pull-requests: write
  issues: write
  actions: read

jobs:
  # ==================== Step 1: Local Tests ====================
  local-tests:
    name: Run Local Tests
    runs-on: ubuntu-latest
    timeout-minutes: 10
    if: ${{ !inputs.skip_tests }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.branch }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm install

      - name: Run local tests
        run: ./infrastructure/scripts/run-local-tests.sh ${{ env.SITE_NAME }}

  # ==================== Step 2: Deploy Site ====================
  deploy:
    name: Deploy SITE_NAME_CAPITALIZED
    runs-on: ubuntu-latest
    timeout-minutes: 15
    needs: local-tests
    if: ${{ always() && (needs.local-tests.result == 'success' || needs.local-tests.result == 'skipped') }}
    outputs:
      service-url: ${{ steps.get-url.outputs.url }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.branch }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker for Artifact Registry
        run: |
          gcloud auth configure-docker ${{ env.GCP_REGION }}-docker.pkg.dev

      - name: Deploy SITE_NAME_CAPITALIZED
        run: ./infrastructure/scripts/deploy-site.sh ${{ env.SITE_NAME }} ${{ inputs.branch }} ${{ github.sha }}

      - name: Get service URL
        id: get-url
        run: |
          URL=$(cat /tmp/deployment-url.txt)
          echo "url=${URL}" >> $GITHUB_OUTPUT
          echo "Deployed to: ${URL}"

      - name: Wait for service to be ready
        run: ./infrastructure/scripts/health-check.sh "${{ steps.get-url.outputs.url }}/health" 60 5

  # ==================== Step 3: Playwright Tests ====================
  playwright-tests:
    name: Run Playwright Tests
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: deploy
    if: ${{ !inputs.skip_tests }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.branch }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm install

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Get Playwright server URL
        id: playwright-server
        run: |
          URL=$(gcloud run services describe playwright-server \
            --platform managed \
            --region ${{ env.GCP_REGION }} \
            --format 'value(status.url)')
          echo "url=${URL}" >> $GITHUB_OUTPUT
          echo "Playwright Server URL: ${URL}"

      - name: Run Playwright tests
        run: ./infrastructure/scripts/run-playwright-tests.sh ${{ env.SITE_NAME }} "${{ needs.deploy.outputs.service-url }}" "${{ steps.playwright-server.outputs.url }}"
        env:
          PLAYWRIGHT_SERVER_URL: ${{ steps.playwright-server.outputs.url }}
          DEPLOYED_URL: ${{ needs.deploy.outputs.service-url }}
          CI: true

  # ==================== Summary ====================
  summary:
    name: Deployment Summary
    runs-on: ubuntu-latest
    needs: [local-tests, deploy, playwright-tests]
    if: always()

    steps:
      - name: Create summary
        run: |
          echo "# 🚀 Manual Deployment Summary - SITE_NAME_CAPITALIZED" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "**Branch:** ${{ inputs.branch }}" >> $GITHUB_STEP_SUMMARY
          echo "**Commit:** ${{ github.sha }}" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "## Results" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "- Local Tests: ${{ needs.local-tests.result }}" >> $GITHUB_STEP_SUMMARY
          echo "- Deploy: ${{ needs.deploy.result }}" >> $GITHUB_STEP_SUMMARY
          echo "- Playwright Tests: ${{ needs.playwright-tests.result }}" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          if [ "${{ needs.deploy.result }}" == "success" ]; then
            echo "**Deployed URL:** ${{ needs.deploy.outputs.service-url }}" >> $GITHUB_STEP_SUMMARY
          fi
WORKFLOW_EOF

# Replace placeholders
SITE_NAME_CAPITALIZED="$(echo $SITE_NAME | sed 's/.*/\u&/')"
sed -i "s/SITE_NAME_PLACEHOLDER/$SITE_NAME/g" ".github/workflows/deploy-${SITE_NAME}-manual.yml"
sed -i "s/SITE_NAME_CAPITALIZED/$SITE_NAME_CAPITALIZED/g" ".github/workflows/deploy-${SITE_NAME}-manual.yml"

echo "✓ Created manual deploy workflow"

# ==================== Step 6: Instructions for updating workflows ====================
echo "Step 6/6: Next steps..."
echo ""
echo "=== ✅ Site scaffolding complete! ==="
echo ""
echo "Created:"
echo "  - ${SITE_NAME}/site/           (site source code)"
echo "  - ${SITE_NAME}/tests/          (Playwright tests)"
echo "  - .github/workflows/deploy-${SITE_NAME}-manual.yml"
echo ""
echo "Updated:"
echo "  - package.json (workspaces and scripts)"
echo ""
echo "⚠️  MANUAL STEPS REQUIRED:"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. Update .github/workflows/push-main.yml:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   a) Add local test step (line ~53):"
echo "      - name: Test ${SITE_NAME_CAPITALIZED}"
echo "        run: ./infrastructure/scripts/run-local-tests.sh ${SITE_NAME}"
echo ""
echo "   b) Add ${SITE_NAME} to matrix array (line ~133):"
echo "      matrix:"
echo "        site: [fellspiral, videobrowser, audiobrowser, ${SITE_NAME}]"
echo ""
echo "   c) Add collect-urls output (line ~327):"
echo "      ${SITE_NAME}-url: \${{ steps.get-urls.outputs.${SITE_NAME}-url }}"
echo ""
echo "   d) Add URL retrieval in collect-urls job (line ~360):"
echo "      ${SITE_NAME^^}_URL=\$(gcloud run services describe ${SITE_NAME}-site \\"
echo "        --region=\${{ env.GCP_REGION }} \\"
echo "        --project=\${{ env.GCP_PROJECT_ID }} \\"
echo "        --format='value(status.url)')"
echo "      echo \"${SITE_NAME}-url=\${${SITE_NAME^^}_URL}\" >> \$GITHUB_OUTPUT"
echo ""
echo "   e) Add E2E test step (line ~452):"
echo "      - name: Test ${SITE_NAME_CAPITALIZED}"
echo "        run: ./infrastructure/scripts/run-playwright-tests.sh ${SITE_NAME} \"\${{ needs.collect-urls.outputs.${SITE_NAME}-url }}\" \"\${{ needs.get-playwright-url.outputs.url }}\""
echo "        env:"
echo "          PLAYWRIGHT_SERVER_URL: \${{ needs.get-playwright-url.outputs.url }}"
echo "          DEPLOYED_URL: \${{ needs.collect-urls.outputs.${SITE_NAME}-url }}"
echo "          CI: true"
echo ""
echo "   f) Add rollback step (line ~522):"
echo "      - name: Rollback ${SITE_NAME_CAPITALIZED}"
echo "        run: |"
echo "          PREVIOUS_REVISION=\$(gcloud run services describe ${SITE_NAME}-site \\"
echo "            --region=\${{ env.GCP_REGION }} \\"
echo "            --project=\${{ env.GCP_PROJECT_ID }} \\"
echo "            --format='value(status.traffic[1].revisionName)' 2>/dev/null || echo \"\")"
echo "          if [ -n \"\$PREVIOUS_REVISION\" ]; then"
echo "            echo \"🔄 Rolling back ${SITE_NAME_CAPITALIZED} to: \$PREVIOUS_REVISION\""
echo "            gcloud run services update-traffic ${SITE_NAME}-site \\"
echo "              --to-revisions=\"\${PREVIOUS_REVISION}=100\" \\"
echo "              --region=\${{ env.GCP_REGION }} \\"
echo "              --project=\${{ env.GCP_PROJECT_ID }}"
echo "          fi"
echo ""
echo "   g) (Optional) Add Firebase rules deployment if needed:"
echo "      See lines 235-303 for Firestore or Storage rules examples"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2. Update .github/workflows/push-feature.yml:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   a) Add change detection output (line ~35):"
echo "      ${SITE_NAME}-changed: \${{ steps.check-changes.outputs.${SITE_NAME}-changed }}"
echo ""
echo "   b) Add change check step (line ~81):"
echo "      if git diff --name-only HEAD^ HEAD | grep -q \"^${SITE_NAME}/\"; then"
echo "        echo \"${SITE_NAME}-changed=true\" >> \$GITHUB_OUTPUT"
echo "      else"
echo "        echo \"${SITE_NAME}-changed=false\" >> \$GITHUB_OUTPUT"
echo "      fi"
echo ""
echo "   c) Add local test step (line ~101):"
echo "      - name: Test ${SITE_NAME_CAPITALIZED}"
echo "        if: steps.check-changes.outputs.${SITE_NAME}-changed == 'true'"
echo "        run: ./infrastructure/scripts/run-local-tests.sh ${SITE_NAME}"
echo ""
echo "   d) Add complete deploy-${SITE_NAME} job (copy deploy-fellspiral job and modify):"
echo "      - Update job name, condition, and all references to ${SITE_NAME}"
echo "      - Include Firebase config if needed (remove rules deployment unless required)"
echo ""
echo "   e) Add complete playwright-tests-${SITE_NAME} job (copy existing and modify)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next commands:"
echo "  npm install                     # Install dependencies"
echo "  npm run dev:${SITE_NAME}        # Start dev server"
echo "  npm run build:${SITE_NAME}      # Build for production"
echo "  npm run test:${SITE_NAME}       # Run tests"
echo ""
echo "Manual deploy workflow:"
echo "  Go to Actions → Manual Deploy - ${SITE_NAME_CAPITALIZED} → Run workflow"
echo ""
